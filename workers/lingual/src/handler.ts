import { knownBots } from '@pvtch/shared/known-bots';
import { ack, type Outcome } from '@pvtch/shared/queue-outcome';
import {
  CHAT_MESSAGE_TYPE,
  chatMessageEvent,
} from '@pvtch/shared/twitch-eventsub';
import type {
  HandlerEventMessage,
  TwitchSendMessage,
} from '@pvtch/shared/twitch-queue';

import { translateChatMessage } from './lingo/pipeline';

const KNOWN_BOTS = new Set(knownBots.map((name) => name.toLowerCase()));

/** A translation this late is noise; chat has moved on. pvtch-twitch checks
 * again before sending. */
export const MAX_REPLY_AGE_MS = 60 * 1000;

/** The broadcaster's TwitchChannel Durable Object in pvtch-storage. */
function channelStub(env: Env, broadcasterId: string) {
  return env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${broadcasterId}`)
  );
}

/**
 * Handle one routed `channel.chat.message`: decide whether Lingual should
 * translate it, translate, and request a threaded reply. pvtch-twitch has
 * already checked that Lingual is enabled and dropped pvtch bots' own
 * messages; sending and rate limits are its job too.
 */
export async function handleLingualEvent(
  env: Env,
  message: HandlerEventMessage,
  attempts: number,
  now = Date.now()
): Promise<Outcome> {
  if (message.subscriptionType !== CHAT_MESSAGE_TYPE) {
    console.warn('Lingual got an unexpected event type', {
      type: message.subscriptionType,
    });
    return ack;
  }

  const channel = channelStub(env, message.broadcasterId);

  // Queues deliver at least once; claim on the first attempt only so our
  // own retries aren't mistaken for duplicates.
  if (attempts === 1) {
    const fresh = await channel.claim(`lingual:${message.messageId}`);
    if (!fresh) return ack;
  }

  const event = chatMessageEvent.parse(message.event);

  // In Shared Chat every participating channel receives each message; only
  // the channel it was sent in translates it.
  if (
    event.source_broadcaster_user_id &&
    event.source_broadcaster_user_id !== event.broadcaster_user_id
  ) {
    return ack;
  }

  const text = event.message.text.trim();
  const chatter = event.chatter_user_login.toLowerCase();
  if (text.length === 0 || text.startsWith('!') || KNOWN_BOTS.has(chatter)) {
    return ack;
  }

  using lingual = await channel.lingual();
  const settings = await lingual.getSettings();
  if (!settings.language) return ack;
  if (settings.ignoredChatters.includes(chatter)) return ack;

  if (now - message.timestamp > MAX_REPLY_AGE_MS) return ack;

  const reply = await translateChatMessage(env, event, settings.language);
  if (!reply) return ack;

  const send: TwitchSendMessage = {
    kind: 'send',
    sendId: `lingual:${message.messageId}`,
    broadcasterId: message.broadcasterId,
    senderId: message.senderId,
    handlerId: 'lingual',
    message: reply,
    replyParentMessageId: event.message_id,
    timestamp: message.timestamp,
  };
  await env.TWITCH_EVENTS.send(send);
  return ack;
}
