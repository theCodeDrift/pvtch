import { ack, type Outcome } from '@pvtch/shared/queue-outcome';
import {
  CHAT_MESSAGE_TYPE,
  chatMessageEvent,
} from '@pvtch/shared/twitch-eventsub';
import type {
  HandlerEventMessage,
  TwitchEventMessage,
} from '@pvtch/shared/twitch-queue';
import {
  SENDER_IDS,
  TWITCH_HANDLERS,
  TWITCH_SENDERS,
  isTrackedEventType,
  senderForUserId,
  type SenderId,
} from '@pvtch/shared/twitch-registry';

import { channelStub } from './channel';
import {
  AUTHORIZATION_REVOKE_TYPE,
  authorizationRevokeEvent,
} from './eventsub/schemas';
import { handleAuthorizationRevoke } from './revoke';

/** Badges that put a sender on Twitch's higher chat rate limit. */
const MODERATOR_BADGES = new Set([
  'moderator',
  'lead_moderator',
  'broadcaster',
]);

const SENDER_USER_IDS = new Set<string>(
  SENDER_IDS.map((id) => TWITCH_SENDERS[id].userId)
);

/** Claim on the first attempt only, so our own retries aren't duplicates. */
function claimKey(message: TwitchEventMessage, attempts: number) {
  // eslint-disable-next-line unicorn/no-null -- RPC: null means "don't claim"
  return attempts === 1 ? message.messageId : null;
}

/**
 * Route one EventSub notification:
 * 1. Does pvtch track this event type at all?
 * 2. Which channel (and, for handler types, which sender) is it for?
 * 3. Does it matter to that channel? `routeEvent` claims the message and
 *    returns the enabled handlers plus the channel's flags.
 * 4. Fan out: one message per handler on its own queue. Channel-level types
 *    run here instead.
 *
 * A failed fan-out throws, so the message retries without claiming; handlers
 * claim `<handlerId>:<messageId>` themselves and absorb the repeat.
 */
export async function routeEvent(
  env: Env,
  message: TwitchEventMessage,
  attempts: number
): Promise<Outcome> {
  if (!isTrackedEventType(message.subscriptionType)) {
    console.warn('Untracked EventSub type', {
      type: message.subscriptionType,
    });
    return ack;
  }

  if (message.subscriptionType === AUTHORIZATION_REVOKE_TYPE) {
    const event = authorizationRevokeEvent.parse(message.event);
    const route = await channelStub(env, event.user_id).routeEvent({
      messageId: claimKey(message, attempts),
      subscriptionType: message.subscriptionType,
      // eslint-disable-next-line unicorn/no-null -- channel-level type
      senderId: null,
    });
    if (!route.fresh) return ack;
    return handleAuthorizationRevoke(env, event, route.handlers);
  }

  const broadcasterId = message.condition.broadcaster_user_id;
  const senderId = senderForUserId(message.condition.user_id ?? '');
  if (!broadcasterId || !senderId) {
    console.warn('EventSub event for an unknown channel or sender', {
      type: message.subscriptionType,
      condition: message.condition,
    });
    return ack;
  }
  const channel = channelStub(env, broadcasterId);

  if (message.subscriptionType === CHAT_MESSAGE_TYPE) {
    const event = chatMessageEvent.parse(message.event);
    if (SENDER_USER_IDS.has(event.chatter_user_id)) {
      if (event.chatter_user_id === TWITCH_SENDERS[senderId].userId) {
        await updateSendTier(channel, senderId, event.badges);
      }
      return ack;
    }
  }

  const route = await channel.routeEvent({
    messageId: claimKey(message, attempts),
    subscriptionType: message.subscriptionType,
    senderId,
  });
  if (!route.fresh || route.handlers.length === 0) return ack;

  await Promise.all(
    route.handlers.map((handlerId) => {
      const routed: HandlerEventMessage = {
        kind: 'handler-event',
        handlerId,
        broadcasterId,
        senderId,
        messageId: message.messageId,
        subscriptionType: message.subscriptionType,
        timestamp: message.timestamp,
        event: message.event,
        flags: route.flags,
      };
      const queue: Queue = env[TWITCH_HANDLERS[handlerId].queue];
      return queue.send(routed);
    })
  );
  return ack;
}

/**
 * A sender sees its own chat messages. Their badges say whether it's a
 * moderator in the channel, which sets its send rate tier.
 */
async function updateSendTier(
  channel: ReturnType<typeof channelStub>,
  senderId: SenderId,
  badges: { set_id: string }[]
): Promise<void> {
  const isModerator = badges.some((badge) =>
    MODERATOR_BADGES.has(badge.set_id)
  );
  await channel.setSendTier(senderId, isModerator ? 'moderator' : 'standard');
}
