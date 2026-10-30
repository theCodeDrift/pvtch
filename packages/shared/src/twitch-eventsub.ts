import { z } from 'zod';

// Twitch publishes no TypeScript types or OpenAPI spec for EventSub, so these
// schemas are hand-written from https://dev.twitch.tv/docs/eventsub/. Unknown
// keys are stripped, so new Twitch fields don't break parsing. Shared because
// pvtch-twitch (routing, send tier) and handler workers both read chat events.

export const CHAT_MESSAGE_TYPE = 'channel.chat.message';

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
