import { z } from 'zod';

// Twitch publishes no TypeScript types or OpenAPI spec for EventSub, so these
// schemas are hand-written from https://dev.twitch.tv/docs/eventsub/. Unknown
// keys are stripped, so new Twitch fields don't break parsing.

export const EVENTSUB_HEADERS = {
  messageId: 'twitch-eventsub-message-id',
  timestamp: 'twitch-eventsub-message-timestamp',
  signature: 'twitch-eventsub-message-signature',
  messageType: 'twitch-eventsub-message-type',
  subscriptionType: 'twitch-eventsub-subscription-type',
} as const;

export const CHAT_MESSAGE_TYPE = 'channel.chat.message';
export const AUTHORIZATION_REVOKE_TYPE = 'user.authorization.revoke';

export const subscription = z.object({
  id: z.string(),
  status: z.string(),
  type: z.string(),
  version: z.string(),
  condition: z.record(z.string(), z.string().nullish()),
});
export type EventSubSubscription = z.infer<typeof subscription>;

export const verificationBody = z.object({
  challenge: z.string(),
  subscription,
});

export const revocationBody = z.object({
  subscription,
});

export const notificationBody = z.object({
  subscription,
  event: z.unknown(),
});

const fragment = z.object({
  type: z.enum(['text', 'cheermote', 'emote', 'mention']),
  text: z.string(),
});
export type ChatFragment = z.infer<typeof fragment>;

const badge = z.object({
  set_id: z.string(),
  id: z.string(),
  info: z.string().nullish(),
});

/** `channel.chat.message` v1 event */
export const chatMessageEvent = z.object({
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  chatter_user_id: z.string(),
  chatter_user_login: z.string(),
  message_id: z.string(),
  message: z.object({
    text: z.string(),
    fragments: z.array(fragment),
  }),
  badges: z.array(badge).default([]),
  // Set when the message arrived through a Shared Chat session; the channel
  // it was originally sent in.
  source_broadcaster_user_id: z.string().nullish(),
});
export type ChatMessageEvent = z.infer<typeof chatMessageEvent>;

/** `user.authorization.revoke` v1 event */
export const authorizationRevokeEvent = z.object({
  client_id: z.string(),
  user_id: z.string(),
  user_login: z.string().nullish(),
});
export type AuthorizationRevokeEvent = z.infer<typeof authorizationRevokeEvent>;
