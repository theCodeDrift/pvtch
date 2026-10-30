import { ack, retryIn, type Outcome } from '@pvtch/shared/queue-outcome';
import { readSecret } from '@pvtch/shared/secrets';
import {
  TWITCH_HANDLERS,
  TWITCH_SENDERS,
  type SenderId,
} from '@pvtch/shared/twitch-registry';
import { z } from 'zod';

import { channelStub, disableSenderHandlers } from '../channel';
import { AUTHORIZATION_REVOKE_TYPE, subscription } from '../eventsub/schemas';
import { helix, rateLimitResetSeconds } from './helix';

const subscriptionList = z.object({ data: z.array(subscription) });

/** Statuses for a subscription that is working or about to be. */
const HEALTHY = new Set(['enabled', 'webhook_callback_verification_pending']);

function callbackUrl(env: Env): string {
  return `${env.TWITCH_APP_URL}/eventsub`;
}

/** Retry on rate limits and server errors; anything else won't improve. */
function failure(response: Response, what: string): Outcome {
  if (response.status === 429) {
    return retryIn(rateLimitResetSeconds(response));
  }
  if (response.status >= 500) {
    throw new Error(`${what} failed: ${response.status}`);
  }
  console.error(`${what} failed`, { status: response.status });
  return ack;
}

type Channel = ReturnType<typeof channelStub>;

/** A sync step is done, or the sync must stop with this outcome. */
type Step = { done: true } | { done: false; outcome: Outcome };
const DONE: Step = { done: true };
const stop = (outcome: Outcome): Step => ({ done: false, outcome });

/** Subscriptions Twitch holds for this broadcaster, sender and type. */
async function listLive(
  env: Env,
  broadcasterId: string,
  senderId: SenderId,
  type: string
) {
  const response = await helix(
    env,
    `/eventsub/subscriptions?user_id=${encodeURIComponent(broadcasterId)}`
  );
  if (!response.ok) return { response, data: undefined };
  const { data } = subscriptionList.parse(await response.json());
  return {
    response,
    data: data.filter(
      (item) =>
        item.type === type &&
        item.condition.broadcaster_user_id === broadcasterId &&
        item.condition.user_id === TWITCH_SENDERS[senderId].userId
    ),
  };
}

/**
 * Create the subscription for this sender and type. A 409 means it already
 * exists, so the existing one is recorded instead. A 403 means the
 * broadcaster hasn't granted `channel:bot` (or the sender account hasn't
 * authorized), so every handler using the sender is disabled.
 */
async function create(
  env: Env,
  channel: Channel,
  broadcasterId: string,
  senderId: SenderId,
  type: string
): Promise<Step> {
  const response = await helix(env, '/eventsub/subscriptions', {
    method: 'POST',
    body: {
      type,
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterId,
        user_id: TWITCH_SENDERS[senderId].userId,
      },
      transport: {
        method: 'webhook',
        callback: callbackUrl(env),
        secret: await readSecret(env.TWITCH_EVENTSUB_SECRET),
      },
    },
  });

  if (response.status === 403) {
    console.warn('Sender not authorized for channel; disabling its handlers', {
      broadcasterId,
      senderId,
    });
    await disableSenderHandlers(env, broadcasterId, senderId);
    // The disable schedules another sync, which removes what's left.
    return stop(ack);
  }

  let created: z.infer<typeof subscription> | undefined;
  if (response.status === 409) {
    const existing = await listLive(env, broadcasterId, senderId, type);
    if (!existing.data) {
      return stop(failure(existing.response, 'List subscriptions'));
    }
    created = existing.data[0];
  } else if (response.ok) {
    created = subscriptionList.parse(await response.json()).data[0];
  } else {
    return stop(failure(response, 'Create subscription'));
  }
  if (!created) return DONE;

  // The verification challenge can land before this response does. Don't
  // overwrite its `enabled` with the older pending status.
  const current = await channel.getSubscription(senderId, type);
  if (current?.subscriptionId !== created.id || current.status !== 'enabled') {
    await channel.setSubscription(senderId, type, created.id, created.status);
  }
  return DONE;
}

/** Delete every subscription Twitch holds for this sender and type, and
 * clear the record. */
async function remove(
  env: Env,
  channel: Channel,
  broadcasterId: string,
  senderId: SenderId,
  type: string
): Promise<Step> {
  const existing = await listLive(env, broadcasterId, senderId, type);
  if (!existing.data) {
    return stop(failure(existing.response, 'List subscriptions'));
  }
  for (const item of existing.data) {
    const response = await helix(
      env,
      `/eventsub/subscriptions?id=${encodeURIComponent(item.id)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 404) {
      return stop(failure(response, 'Delete subscription'));
    }
  }
  await channel.clearSubscription(senderId, type);
  return DONE;
}

/** Keep a wanted subscription healthy: create it when missing, recreate it
 * when Twitch revoked or failed it (e.g. `notification_failures_exceeded`). */
async function ensure(
  env: Env,
  channel: Channel,
  broadcasterId: string,
  senderId: SenderId,
  type: string
): Promise<Step> {
  const record = await channel.getSubscription(senderId, type);
  if (!record) return create(env, channel, broadcasterId, senderId, type);

  const response = await helix(
    env,
    `/eventsub/subscriptions?subscription_id=${encodeURIComponent(record.subscriptionId)}`
  );
  if (!response.ok) return stop(failure(response, 'Get subscription'));
  const live = subscriptionList.parse(await response.json()).data[0];

  if (live && HEALTHY.has(live.status)) {
    if (live.status !== record.status) {
      await channel.setSubscription(senderId, type, live.id, live.status);
    }
    return DONE;
  }

  // Missing or failed: remove whatever is left, then subscribe again.
  const cleared = await remove(env, channel, broadcasterId, senderId, type);
  if (!cleared.done) return cleared;
  return create(env, channel, broadcasterId, senderId, type);
}

/**
 * Make Twitch match the channel for one sender: the wanted subscription
 * types are the union of `eventTypes` over the enabled handlers posting as
 * this sender. Missing or unhealthy ones are created; unwanted ones are
 * deleted. Requested by `TwitchChannel` on handler changes and every 6 hours.
 */
export async function sync(
  env: Env,
  broadcasterId: string,
  senderId: SenderId
): Promise<Outcome> {
  const channel = channelStub(env, broadcasterId);
  const enabled = await channel.listHandlers();
  const wanted = new Set<string>(
    enabled
      .filter((id) => TWITCH_HANDLERS[id].sender === senderId)
      .flatMap((id) => TWITCH_HANDLERS[id].eventTypes)
  );

  for (const record of await channel.listSubscriptions(senderId)) {
    if (wanted.has(record.type)) continue;
    const step = await remove(
      env,
      channel,
      broadcasterId,
      senderId,
      record.type
    );
    if (!step.done) return step.outcome;
  }
  for (const type of wanted) {
    const step = await ensure(env, channel, broadcasterId, senderId, type);
    if (!step.done) return step.outcome;
  }
  return ack;
}

/**
 * Create the app-wide `user.authorization.revoke` subscription, which tells
 * pvtch when a user disconnects it on Twitch. Idempotent: 409 means it
 * already exists.
 */
export async function bootstrapRevokeSubscription(
  env: Env
): Promise<{ ok: boolean; status: number }> {
  const response = await helix(env, '/eventsub/subscriptions', {
    method: 'POST',
    body: {
      type: AUTHORIZATION_REVOKE_TYPE,
      version: '1',
      condition: { client_id: env.TWITCH_CLIENT_ID },
      transport: {
        method: 'webhook',
        callback: callbackUrl(env),
        secret: await readSecret(env.TWITCH_EVENTSUB_SECRET),
      },
    },
  });
  return {
    ok: response.ok || response.status === 409,
    status: response.status,
  };
}
