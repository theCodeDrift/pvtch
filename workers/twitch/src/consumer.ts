import { ack, type Outcome } from '@pvtch/shared/queue-outcome';
import { twitchQueueMessage } from '@pvtch/shared/twitch-queue';

import { routeEvent } from './router';
import { handleSend } from './twitch/send';
import { sync } from './twitch/subscriptions';

export async function handleQueueMessage(
  env: Env,
  body: unknown,
  /** The queue message id: stable across retries, so it owns claims. */
  owner: string
): Promise<Outcome> {
  const parsed = twitchQueueMessage.safeParse(body);
  if (!parsed.success) {
    console.error('Unrecognized twitch-events message', parsed.error);
    return ack;
  }
  const message = parsed.data;
  switch (message.kind) {
    case 'event': {
      return routeEvent(env, message, owner);
    }
    case 'sync': {
      return sync(env, message.broadcasterId, message.senderId);
    }
    case 'send': {
      return handleSend(env, message, owner);
    }
  }
}

/** Queue handler: one message per batch (max_batch_size 1). */
export async function consume(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const outcome = await handleQueueMessage(env, message.body, message.id);
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
