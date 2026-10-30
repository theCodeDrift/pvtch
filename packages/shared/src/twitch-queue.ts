import { z } from 'zod';

import {
  HANDLER_IDS,
  SENDER_IDS,
  type HandlerId,
  type SenderId,
} from './twitch-registry';

const senderId = z.enum(SENDER_IDS as [SenderId, ...SenderId[]]);
const handlerId = z.enum(HANDLER_IDS as [HandlerId, ...HandlerId[]]);

/**
 * Messages on the `twitch-events` queue, all consumed by pvtch-twitch:
 * - `event`: produced by the webhook, routed and fanned out to handlers
 * - `sync`: produced by `TwitchChannel`, converges a sender's subscriptions
 * - `send`: produced by handler workers, posted to chat through Helix
 */

export const twitchEventMessage = z.object({
  kind: z.literal('event'),
  /** `Twitch-Eventsub-Message-Id`, the dedupe key */
  messageId: z.string().min(1),
  /** `Twitch-Eventsub-Subscription-Type`, e.g. `channel.chat.message` */
  subscriptionType: z.string().min(1),
  /** The subscription's condition; `user_id` names the sender account */
  condition: z.record(z.string(), z.string()),
  /** `Twitch-Eventsub-Message-Timestamp` as epoch milliseconds */
  timestamp: z.number(),
  /** The notification's `event` object, validated per type by the consumer */
  event: z.unknown(),
});
export type TwitchEventMessage = z.infer<typeof twitchEventMessage>;

export const twitchSyncMessage = z.object({
  kind: z.literal('sync'),
  broadcasterId: z.string().min(1),
  senderId,
});
export type TwitchSyncMessage = z.infer<typeof twitchSyncMessage>;

export const twitchSendMessage = z.object({
  kind: z.literal('send'),
  /** Deterministic per outcome, so a duplicate request carries the same id */
  sendId: z.string().min(1),
  broadcasterId: z.string().min(1),
  senderId,
  handlerId,
  message: z.string().min(1),
  replyParentMessageId: z.string().min(1).nullable(),
  /** The source event's timestamp; stale sends are dropped */
  timestamp: z.number(),
});
export type TwitchSendMessage = z.infer<typeof twitchSendMessage>;

export const twitchQueueMessage = z.discriminatedUnion('kind', [
  twitchEventMessage,
  twitchSyncMessage,
  twitchSendMessage,
]);
export type TwitchQueueMessage = z.infer<typeof twitchQueueMessage>;

/** A routed event on a handler's own queue (e.g. `lingual-events`). */
export const handlerEventMessage = z.object({
  kind: z.literal('handler-event'),
  handlerId,
  broadcasterId: z.string().min(1),
  senderId,
  messageId: z.string().min(1),
  subscriptionType: z.string().min(1),
  timestamp: z.number(),
  event: z.unknown(),
  /** The channel's feature flags when the event was routed */
  flags: z.array(z.string()),
});
export type HandlerEventMessage = z.infer<typeof handlerEventMessage>;
