import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consume } from '../src/consumer';
import { handleLingualEvent } from '../src/handler';
import {
  BROADCASTER_ID,
  aiResponse,
  chatEvent,
  createTestEnv,
  handlerEvent,
  type TestEnv,
} from './helpers/fakes';

const NOW = new Date('2026-10-23T12:00:00.000Z').getTime();

describe('handleLingualEvent', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
    t.channel(BROADCASTER_ID).settings = {
      language: 'english',
      ignoredChatters: [],
    };
    t.ai.mockResolvedValue(
      aiResponse({
        detected: 'Spanish',
        detectedCode: 'spa',
        translation: 'hi friends, how is everyone tonight?',
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requests a threaded reply as its sender', async () => {
    const outcome = await handleLingualEvent(t.env, handlerEvent(), 1);

    expect(outcome).toEqual({ type: 'ack' });
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledWith({
      kind: 'send',
      sendId: 'lingual:m-1',
      broadcasterId: BROADCASTER_ID,
      senderId: 'botlingual',
      handlerId: 'lingual',
      message: 'hi friends, how is everyone tonight?',
      replyParentMessageId: 'msg-1',
      timestamp: NOW,
    });
  });

  it('acts once when the same fan-out arrives twice', async () => {
    await handleLingualEvent(t.env, handlerEvent(), 1);
    await handleLingualEvent(t.env, handlerEvent(), 1);

    expect(t.ai).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledOnce();
  });

  it('does not claim again on its own retry', async () => {
    t.channel(BROADCASTER_ID).claimed.add('lingual:m-1');

    await handleLingualEvent(t.env, handlerEvent(), 2);

    expect(t.send).toHaveBeenCalledOnce();
  });

  describe('skips without translating', () => {
    it('a Shared Chat message from another channel', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent({ source_broadcaster_user_id: '999' })),
        1
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a command', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(
          chatEvent({
            message: {
              text: '!lurk',
              fragments: [{ type: 'text', text: '!lurk' }],
            },
          })
        ),
        1
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a known bot', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent({ chatter_user_login: 'Nightbot' })),
        1
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it("a user on the channel's ignore list", async () => {
      t.channel(BROADCASTER_ID).settings.ignoredChatters = ['viewer'];
      await handleLingualEvent(t.env, handlerEvent(), 1);
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a channel with no Lingual language set', async () => {
      // eslint-disable-next-line unicorn/no-null -- RPC returns null
      t.channel(BROADCASTER_ID).settings.language = null;
      await handleLingualEvent(t.env, handlerEvent(), 1);
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a message more than 60 seconds old', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { timestamp: NOW - 61_000 }),
        1
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('an unexpected event type', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { subscriptionType: 'channel.follow' }),
        1
      );
      expect(t.ai).not.toHaveBeenCalled();
    });
  });

  it('sends nothing when the translation is empty', async () => {
    t.ai.mockResolvedValue(
      aiResponse({ detected: 'Spanish', detectedCode: 'spa', translation: '' })
    );

    await handleLingualEvent(t.env, handlerEvent(), 1);

    expect(t.send).not.toHaveBeenCalled();
  });
});

function batch(body: unknown) {
  const message = {
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  return { message, batch: { messages: [message] } as unknown as MessageBatch };
}

describe('lingual consumer', () => {
  it('acks an unrecognized message', async () => {
    const t = createTestEnv();
    const { message, batch: b } = batch({ kind: 'nope' });

    await consume(b, t.env);

    expect(message.ack).toHaveBeenCalled();
    expect(t.send).not.toHaveBeenCalled();
  });

  it('retries when handling throws', async () => {
    const t = createTestEnv();
    t.channel(BROADCASTER_ID).settings.language = 'english';
    t.ai.mockResolvedValue(
      aiResponse({
        detected: 'Spanish',
        detectedCode: 'spa',
        translation: 'hi friends',
      })
    );
    t.send.mockRejectedValueOnce(new Error('queue down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { message, batch: b } = batch(handlerEvent());

    await consume(b, t.env);

    expect(message.retry).toHaveBeenCalled();
  });
});
