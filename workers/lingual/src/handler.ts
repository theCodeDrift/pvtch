import { isKnownBot } from '@pvtch/shared/known-bots';
import { ack, retryIn, type Outcome } from '@pvtch/shared/queue-outcome';
import {
  CHAT_MESSAGE_TYPE,
  chatMessageEvent,
} from '@pvtch/shared/twitch-eventsub';
import type {
  HandlerEventMessage,
  TwitchSendMessage,
} from '@pvtch/shared/twitch-queue';

import { messageKey } from './lingo/message-key';
import { translateChatMessage } from './lingo/pipeline';
import { translateChatMessageV2 } from './lingo/pipeline-v2';

/** A translation this late is noise; chat has moved on. pvtch-twitch checks
 * again before sending. */
export const MAX_REPLY_AGE_MS = 60 * 1000;

/** Wait before retrying a failed model call. Short, so the retry lands well
 * inside MAX_REPLY_AGE_MS. */
export const RETRY_DELAY_SECONDS = 5;

/** `max_retries` of the lingual-events consumer in wrangler.jsonc (a test
 * keeps them equal). The attempt after the last retry is the final one. */
export const MAX_RETRIES = 3;

/** Post as a plain message instead of a threaded reply. */
export const NO_THREAD_FLAG = 'lingual.no-thread';

/** Use the OpenRouter translation flow instead of Workers AI. */
export const TRANSLATE_V2_FLAG = 'lingual.translate-v2';

/** The broadcaster's TwitchChannel Durable Object in pvtch-storage. */
function channelStub(env: Env, broadcasterId: string) {
  return env.TWITCH_CHANNEL.get(
    env.TWITCH_CHANNEL.idFromName(`twitch:${broadcasterId}`)
  );
}

/** The queue message being handled: its id is stable across retries. */
export type Delivery = Pick<Message, 'id' | 'attempts'>;

/**
 * Handle one routed `channel.chat.message`: decide whether Lingual should
 * translate it, translate, and request a threaded reply. pvtch-twitch has
 * already checked that Lingual is enabled and dropped pvtch bots' own
 * messages; sending and rate limits are its job too.
 */
export async function handleLingualEvent(
  env: Env,
  message: HandlerEventMessage,
  delivery: Delivery,
  now = Date.now()
): Promise<Outcome> {
  if (message.subscriptionType !== CHAT_MESSAGE_TYPE) {
    console.warn('Lingual got an unexpected event type', {
      type: message.subscriptionType,
    });
    return ack;
  }

  const channel = channelStub(env, message.broadcasterId);

  // Queues deliver at least once. Every attempt claims as this queue
  // message, so our own retries keep the claim and a redelivered copy (a new
  // queue message) is dropped.
  const fresh = await channel.claim(
    `lingual:${message.messageId}`,
    delivery.id
  );
  if (!fresh) return ack;

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
  if (
    text.length === 0 ||
    text.startsWith('!') ||
    isKnownBot(event.chatter_user_login)
  ) {
    return ack;
  }

  using lingual = await channel.lingual();
  const settings = await lingual.getSettings();
  if (!settings.language) return ack;

  const key = await messageKey(event.message.fragments);

  if (now - message.timestamp > MAX_REPLY_AGE_MS) {
    // A retry that Queues delivered later than planned: this message set the
    // mark and will never reply, so free it as when giving up below.
    if (key && delivery.attempts > 1) {
      await releaseSeen(channel, key, delivery.id);
    }
    return ack;
  }

  // A repeated message is translated once: raids and copypasta would
  // otherwise fill chat with the same reply. As with the claim above, a retry
  // must not count as a repeat of itself. Marking before translating keeps
  // concurrent repeats from all reaching the model; if the translation fails,
  // this message keeps the mark and retries, so the burst still gets its one
  // reply. The mark is this queue message's, so only it can release it.
  if (key && delivery.attempts === 1) {
    using cache = await channel.messageCache();
    if (!(await cache.firstSeen(key, delivery.id))) return ack;
  }

  const translateMessage = message.flags.includes(TRANSLATE_V2_FLAG)
    ? translateChatMessageV2
    : translateChatMessage;
  const result = await translateMessage(env, event, settings.language);
  if (result.kind === 'failed') {
    const outcome = retryWhileFresh(message, now);
    // Giving up without a reply: the retry was skipped as too late, or this
    // was the last attempt (Queues dead-letters it). Release the mark so the
    // next identical message gets its chance instead of staying suppressed.
    if (key && (outcome.type === 'ack' || delivery.attempts > MAX_RETRIES)) {
      await releaseSeen(channel, key, delivery.id);
    }
    return outcome;
  }
  if (result.kind === 'quiet') return ack;

  const send: TwitchSendMessage = {
    kind: 'send',
    sendId: `lingual:${message.messageId}`,
    broadcasterId: message.broadcasterId,
    senderId: message.senderId,
    handlerId: 'lingual',
    message: result.reply,
    replyParentMessageId: message.flags.includes(NO_THREAD_FLAG)
      ? // eslint-disable-next-line unicorn/no-null -- schema: null means no thread
        null
      : event.message_id,
    timestamp: message.timestamp,
  };
  await env.TWITCH_EVENTS.send(send);
  return ack;
}

/** Best effort: if the release fails, the mark just expires on its own. */
async function releaseSeen(
  channel: ReturnType<typeof channelStub>,
  key: string,
  owner: string
): Promise<void> {
  try {
    using cache = await channel.messageCache();
    await cache.release(key, owner);
  } catch (error) {
    console.warn('Lingual could not release a seen message', error);
  }
}

/** Retry a failed translation, unless the retry would land after the reply
 * stopped being worth posting. */
function retryWhileFresh(message: HandlerEventMessage, now: number): Outcome {
  const retryAt = now + RETRY_DELAY_SECONDS * 1000;
  if (retryAt - message.timestamp > MAX_REPLY_AGE_MS) {
    console.warn('Lingual translation failed too late to retry', {
      messageId: message.messageId,
    });
    return ack;
  }
  return retryIn(RETRY_DELAY_SECONDS);
}
