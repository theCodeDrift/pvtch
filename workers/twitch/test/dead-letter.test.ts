/* eslint-disable unicorn/no-null -- mirrors queue payloads, which use null */
import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { createTestEnv } from './helpers/fakes';

function batchOn(queue: string, body: unknown) {
  const message = {
    id: 'q-1',
    timestamp: new Date(),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  return {
    message,
    batch: { queue, messages: [message] } as unknown as MessageBatch,
  };
}

describe('twitch-events-dlq', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs and acks a dead letter without handling it', async () => {
    const t = createTestEnv();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { message, batch } = batchOn('twitch-events-dlq', {
      kind: 'send',
      sendId: 's-1',
      broadcasterId: 'b-1',
      senderId: 'pvtchbot',
      handlerId: 'lingual',
      message: 'hola amigos',
      replyParentMessageId: null,
      timestamp: 1000,
    });

    await worker.queue(batch, t.env);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'twitch-events-dlq',
        kind: 'send',
        sendId: 's-1',
      })
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('hola amigos');
  });
});
