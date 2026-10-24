import { z } from 'zod';

/**
 * Messages on the `twitch-events` queue. The twitch worker's webhook handler
 * produces `event` messages; `TwitchChannel` (in pvtch-storage) produces the
 * work messages. Only the twitch worker's consumer calls Twitch.
 */

export const twitchWorkKind = z.enum(['subscribe', 'unsubscribe', 'reconcile']);
export type TwitchWorkKind = z.infer<typeof twitchWorkKind>;

export const twitchWorkMessage = z.object({
  kind: twitchWorkKind,
  broadcasterId: z.string().min(1),
});
export type TwitchWorkMessage = z.infer<typeof twitchWorkMessage>;

export const twitchEventMessage = z.object({
  kind: z.literal('event'),
  /** `Twitch-Eventsub-Message-Id`, the dedupe key */
  messageId: z.string().min(1),
  /** `Twitch-Eventsub-Subscription-Type`, e.g. `channel.chat.message` */
  subscriptionType: z.string().min(1),
  /** `Twitch-Eventsub-Message-Timestamp` as epoch milliseconds */
  timestamp: z.number(),
  /** The notification's `event` object, validated per type by the consumer */
  event: z.unknown(),
});
export type TwitchEventMessage = z.infer<typeof twitchEventMessage>;

export const twitchQueueMessage = z.union([
  twitchEventMessage,
  twitchWorkMessage,
]);
export type TwitchQueueMessage = z.infer<typeof twitchQueueMessage>;
