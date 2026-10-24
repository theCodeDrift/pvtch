import { z } from 'zod';

import { channelStub } from '../channel';
import {
  AUTHORIZATION_REVOKE_TYPE,
  CHAT_MESSAGE_TYPE,
  subscription,
} from '../eventsub/schemas';
import { ack, retryIn, type Outcome } from '../outcome';
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

/** Chat subscriptions Twitch holds for this broadcaster. */
async function listChatSubscriptions(env: Env, broadcasterId: string) {
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
        item.type === CHAT_MESSAGE_TYPE &&
        item.condition.broadcaster_user_id === broadcasterId
    ),
  };
}

/**
 * Create the broadcaster's `channel.chat.message` subscription for the bot.
 * A 409 means it already exists, so the existing one is recorded instead. A
 * 403 means the broadcaster hasn't granted `channel:bot` (or the bot account
 * hasn't authorized), so the bot is disabled.
 */
export async function subscribe(
  env: Env,
  broadcasterId: string
): Promise<Outcome> {
  const channel = channelStub(env, broadcasterId);
  const bot = await channel.getBot();
  if (!bot.enabled) return ack;

  const response = await helix(env, '/eventsub/subscriptions', {
    method: 'POST',
    body: {
      type: CHAT_MESSAGE_TYPE,
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterId,
        user_id: env.TWITCH_BOT_USER_ID,
      },
      transport: {
        method: 'webhook',
        callback: callbackUrl(env),
        secret: env.TWITCH_EVENTSUB_SECRET,
      },
    },
  });

  if (response.status === 403) {
    console.warn('Bot not authorized for channel; disabling', {
      broadcasterId,
    });
    await channel.disableBot();
    return ack;
  }

  let created: z.infer<typeof subscription> | undefined;
  if (response.status === 409) {
    const existing = await listChatSubscriptions(env, broadcasterId);
    if (!existing.data) return failure(existing.response, 'List subscriptions');
    created = existing.data[0];
  } else if (response.ok) {
    created = subscriptionList.parse(await response.json()).data[0];
  } else {
    return failure(response, 'Create subscription');
  }
  if (!created) return ack;

  // The verification challenge can land before this response does. Don't
  // overwrite its `enabled` with the older pending status.
  const current = await channel.getSubscription(CHAT_MESSAGE_TYPE);
  if (current?.subscriptionId !== created.id || current.status !== 'enabled') {
    await channel.setSubscription(
      CHAT_MESSAGE_TYPE,
      created.id,
      created.status
    );
  }
  return ack;
}

/** Delete every chat subscription for the broadcaster and clear the record. */
export async function unsubscribe(
  env: Env,
  broadcasterId: string
): Promise<Outcome> {
  const channel = channelStub(env, broadcasterId);
  const existing = await listChatSubscriptions(env, broadcasterId);
  if (!existing.data) return failure(existing.response, 'List subscriptions');

  for (const item of existing.data) {
    const response = await helix(
      env,
      `/eventsub/subscriptions?id=${encodeURIComponent(item.id)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 404) {
      return failure(response, 'Delete subscription');
    }
  }
  await channel.clearSubscription(CHAT_MESSAGE_TYPE);
  return ack;
}

/**
 * Make Twitch match the channel's state: no subscription when the bot is
 * off, a healthy one when it's on. Recreates subscriptions Twitch revoked
 * (e.g. `notification_failures_exceeded`).
 */
export async function reconcile(
  env: Env,
  broadcasterId: string
): Promise<Outcome> {
  const channel = channelStub(env, broadcasterId);
  const bot = await channel.getBot();
  if (!bot.enabled) return unsubscribe(env, broadcasterId);

  const record = await channel.getSubscription(CHAT_MESSAGE_TYPE);
  if (!record) return subscribe(env, broadcasterId);

  const response = await helix(
    env,
    `/eventsub/subscriptions?subscription_id=${encodeURIComponent(record.subscriptionId)}`
  );
  if (!response.ok) return failure(response, 'Get subscription');
  const live = subscriptionList.parse(await response.json()).data[0];

  if (live && HEALTHY.has(live.status)) {
    if (live.status !== record.status) {
      await channel.setSubscription(CHAT_MESSAGE_TYPE, live.id, live.status);
    }
    return ack;
  }

  // Missing or failed: remove whatever is left, then subscribe again.
  const cleared = await unsubscribe(env, broadcasterId);
  if (cleared.type !== 'ack') return cleared;
  return subscribe(env, broadcasterId);
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
        secret: env.TWITCH_EVENTSUB_SECRET,
      },
    },
  });
  return {
    ok: response.ok || response.status === 409,
    status: response.status,
  };
}
