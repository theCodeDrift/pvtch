import {
  twitchQueueMessage,
  type TwitchEventMessage,
} from '@pvtch/shared/twitch-queue';

import { handleChatMessage } from './bot/chat';
import { handleAuthorizationRevoke } from './bot/revoke';
import { channelStub } from './channel';
import {
  AUTHORIZATION_REVOKE_TYPE,
  CHAT_MESSAGE_TYPE,
  authorizationRevokeEvent,
  chatMessageEvent,
} from './eventsub/schemas';
import { ack, type Outcome } from './outcome';
import { reconcile, subscribe, unsubscribe } from './twitch/subscriptions';

/**
 * Claim an EventSub message on its first delivery only. Twitch redeliveries
 * and duplicate queue deliveries arrive as first attempts and lose the
 * claim; our own retries (attempts > 1) already hold it.
 */
async function claim(
  env: Env,
  broadcasterId: string,
  messageId: string,
  attempts: number
): Promise<boolean> {
  if (attempts > 1) return true;
  return channelStub(env, broadcasterId).claimMessage(messageId);
}

async function handleEvent(
  env: Env,
  message: TwitchEventMessage,
  attempts: number
): Promise<Outcome> {
  switch (message.subscriptionType) {
    case CHAT_MESSAGE_TYPE: {
      const event = chatMessageEvent.parse(message.event);
      const fresh = await claim(
        env,
        event.broadcaster_user_id,
        message.messageId,
        attempts
      );
      if (!fresh) return ack;
      return handleChatMessage(env, event, message.timestamp);
    }
    case AUTHORIZATION_REVOKE_TYPE: {
      const event = authorizationRevokeEvent.parse(message.event);
      const fresh = await claim(
        env,
        event.user_id,
        message.messageId,
        attempts
      );
      if (!fresh) return ack;
      return handleAuthorizationRevoke(env, event);
    }
    default: {
      console.warn('Unhandled EventSub type', {
        type: message.subscriptionType,
      });
      return ack;
    }
  }
}

export async function handleQueueMessage(
  env: Env,
  body: unknown,
  attempts: number
): Promise<Outcome> {
  const parsed = twitchQueueMessage.safeParse(body);
  if (!parsed.success) {
    console.error('Unrecognized twitch-events message', parsed.error);
    return ack;
  }
  const message = parsed.data;
  switch (message.kind) {
    case 'event': {
      return handleEvent(env, message, attempts);
    }
    case 'subscribe': {
      return subscribe(env, message.broadcasterId);
    }
    case 'unsubscribe': {
      return unsubscribe(env, message.broadcasterId);
    }
    case 'reconcile': {
      return reconcile(env, message.broadcasterId);
    }
  }
}

/** Queue handler: one message per batch (max_batch_size 1). */
export async function consume(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const outcome = await handleQueueMessage(
        env,
        message.body,
        message.attempts
      );
      if (outcome.type === 'retry') {
        message.retry({ delaySeconds: outcome.delaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error('twitch-events message failed; retrying', error);
      message.retry();
    }
  }
}
