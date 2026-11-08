import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { createTestEnv, handlerEvent } from './helpers/fakes';

describe('lingual-events-dlq', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs and acks a dead letter without translating it', async () => {
    const t = createTestEnv();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = {
      id: 'q-1',
      timestamp: new Date(),
      attempts: 1,
      body: handlerEvent(),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = {
      queue: 'lingual-events-dlq',
      messages: [message],
    } as unknown as MessageBatch;

    await worker.queue(batch, t.env);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(t.ai).not.toHaveBeenCalled();
    expect(t.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'lingual-events-dlq',
        kind: 'handler-event',
        handlerId: 'lingual',
      })
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('hola amigos');
  });
});
