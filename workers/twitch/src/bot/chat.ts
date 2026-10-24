import { knownBots } from '@pvtch/shared/known-bots';
import { z } from 'zod';

import { channelStub } from '../channel';
import type { ChatMessageEvent } from '../eventsub/schemas';
import { translateChatMessage } from '../lingo/pipeline';
import { ack, retryIn, type Outcome } from '../outcome';
import { helix, rateLimitResetSeconds } from '../twitch/helix';

const KNOWN_BOTS = new Set(knownBots.map((name) => name.toLowerCase()));

/** Badges that put the bot on Twitch's higher chat rate limit. */
const MODERATOR_BADGES = new Set([
  'moderator',
  'lead_moderator',
  'broadcaster',
]);

/** A translation this late is noise; chat has moved on. */
export const MAX_REPLY_AGE_MS = 60 * 1000;

const sendResponse = z.object({
  data: z.array(
    z.object({
      message_id: z.string(),
      is_sent: z.boolean(),
      drop_reason: z
        .object({ code: z.string(), message: z.string() })
        .nullish(),
    })
  ),
});

/**
 * Handle one `channel.chat.message` event: decide whether the bot should
 * translate it, translate, and send a threaded reply within the channel's
 * rate limit.
 */
export async function handleChatMessage(
  env: Env,
  event: ChatMessageEvent,
  sentAt: number,
  now = Date.now()
): Promise<Outcome> {
  const broadcasterId = event.broadcaster_user_id;
  const channel = channelStub(env, broadcasterId);

  // The bot sees its own replies. Their badges say whether it's a moderator,
  // which sets the send rate tier; then they're skipped like any self-message.
  if (event.chatter_user_id === env.TWITCH_BOT_USER_ID) {
    const isModerator = event.badges.some((badge) =>
      MODERATOR_BADGES.has(badge.set_id)
    );
    await channel.setSendTier(isModerator ? 'moderator' : 'standard');
    return ack;
  }

  // In Shared Chat every participating channel receives each message; only
  // the channel it was sent in translates it.
  if (
    event.source_broadcaster_user_id &&
    event.source_broadcaster_user_id !== broadcasterId
  ) {
    return ack;
  }

  const text = event.message.text.trim();
  const chatter = event.chatter_user_login.toLowerCase();
  if (text.length === 0 || text.startsWith('!') || KNOWN_BOTS.has(chatter)) {
    return ack;
  }

  const bot = await channel.getBot();
  if (!bot.enabled) return ack;

  const settings = await channel.getLingualSettings();
  if (!settings.language) return ack;
  if (settings.ignoredChatters.includes(chatter)) return ack;

  if (now - sentAt > MAX_REPLY_AGE_MS) return ack;

  const reply = await translateChatMessage(env, event, settings.language);
  if (!reply) return ack;

  return sendReply(env, event, reply, sentAt);
}

async function sendReply(
  env: Env,
  event: ChatMessageEvent,
  reply: string,
  sentAt: number
): Promise<Outcome> {
  const channel = channelStub(env, event.broadcaster_user_id);

  // Re-check staleness: a retry may land well after the message.
  if (Date.now() - sentAt > MAX_REPLY_AGE_MS) return ack;

  const slot = await channel.acquireSendSlot();
  if (!slot.ok) return retryIn(slot.retryAfterMs / 1000);

  const response = await helix(env, '/chat/messages', {
    method: 'POST',
    body: {
      broadcaster_id: event.broadcaster_user_id,
      sender_id: env.TWITCH_BOT_USER_ID,
      message: reply,
      reply_parent_message_id: event.message_id,
    },
  });

  if (response.status === 429) {
    return retryIn(rateLimitResetSeconds(response));
  }
  if (response.status === 403) {
    console.warn('Bot lost permission to chat; disabling', {
      broadcasterId: event.broadcaster_user_id,
    });
    await channel.disableBot();
    return ack;
  }
  if (response.status >= 500) {
    throw new Error(`Send chat message failed: ${response.status}`);
  }
  if (!response.ok) {
    console.error('Send chat message failed', { status: response.status });
    return ack;
  }

  // A 200 can still mean "not sent" (AutoMod, duplicate, channel settings).
  // Resending won't change that, so log and move on.
  const [result] = sendResponse.parse(await response.json()).data;
  if (result && !result.is_sent) {
    console.warn('Chat message dropped', {
      broadcasterId: event.broadcaster_user_id,
      code: result.drop_reason?.code,
    });
  }
  return ack;
}
