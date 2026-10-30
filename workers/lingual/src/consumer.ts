import { handlerEventMessage } from '@pvtch/shared/twitch-queue';

import { handleLingualEvent } from './handler';

/** Queue handler: one message per batch (max_batch_size 1). */
export async function consume(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      const parsed = handlerEventMessage.safeParse(message.body);
      if (!parsed.success || parsed.data.handlerId !== 'lingual') {
        console.error('Unrecognized lingual-events message', parsed.error);
        message.ack();
        continue;
      }
      const outcome = await handleLingualEvent(
        env,
        parsed.data,
        message.attempts
      );
      if (outcome.type === 'retry') {
        message.retry({ delaySeconds: outcome.delaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error('lingual-events message failed; retrying', error);
      message.retry();
    }
  }
}
