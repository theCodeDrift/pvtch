import { ack, retryIn, type Outcome } from '@pvtch/shared/queue-outcome';
import type { TwitchSendMessage } from '@pvtch/shared/twitch-queue';
import { TWITCH_SENDERS } from '@pvtch/shared/twitch-registry';
import { z } from 'zod';

import { channelStub, disableSenderHandlers } from '../channel';
import { helix, rateLimitResetSeconds } from './helix';

/** A reply this late is noise; chat has moved on. */
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
 * Post a handler's reply to chat as its sender, within the channel's rate
 * limit for that sender. The first attempt claims `send:<sendId>` in the
 * same DO call that takes the token, so a duplicate request posts nothing.
 */
export async function handleSend(
  env: Env,
  message: TwitchSendMessage,
  attempts: number,
  now = Date.now()
): Promise<Outcome> {
  if (now - message.timestamp > MAX_REPLY_AGE_MS) return ack;

  const channel = channelStub(env, message.broadcasterId);
  const slot = await channel.acquireSendSlot(
    message.senderId,
    // eslint-disable-next-line unicorn/no-null -- RPC: null means "don't claim"
    attempts === 1 ? `send:${message.sendId}` : null
  );
  if (!slot.ok) {
    if ('duplicate' in slot) return ack;
    return retryIn(slot.retryAfterMs / 1000);
  }

  const response = await helix(env, '/chat/messages', {
    method: 'POST',
    body: {
      broadcaster_id: message.broadcasterId,
      sender_id: TWITCH_SENDERS[message.senderId].userId,
      message: message.message,
      ...(message.replyParentMessageId
        ? { reply_parent_message_id: message.replyParentMessageId }
        : {}),
    },
  });

  if (response.status === 429) {
    return retryIn(rateLimitResetSeconds(response));
  }
  if (response.status === 403) {
    console.warn('Sender lost permission to chat; disabling its handlers', {
      broadcasterId: message.broadcasterId,
      senderId: message.senderId,
    });
    await disableSenderHandlers(env, message.broadcasterId, message.senderId);
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
      broadcasterId: message.broadcasterId,
      handlerId: message.handlerId,
      code: result.drop_reason?.code,
    });
  }
  return ack;
}
