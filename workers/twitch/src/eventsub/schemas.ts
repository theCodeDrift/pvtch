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

/** `user.authorization.revoke` v1 event */
export const authorizationRevokeEvent = z.object({
  client_id: z.string(),
  user_id: z.string(),
  user_login: z.string().nullish(),
});
export type AuthorizationRevokeEvent = z.infer<typeof authorizationRevokeEvent>;
