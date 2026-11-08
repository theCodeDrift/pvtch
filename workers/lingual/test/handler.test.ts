import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consume } from '../src/consumer';
import {
  MAX_RETRIES,
  NO_THREAD_FLAG,
  RETRY_DELAY_SECONDS,
  TRANSLATE_V2_FLAG,
  handleLingualEvent,
} from '../src/handler';
import { messageKey } from '../src/lingo/message-key';
import { translateChatMessageV2 } from '../src/lingo/pipeline-v2';
import {
  BROADCASTER_ID,
  aiResponse,
  chatEvent,
  createTestEnv,
  handlerEvent,
  type TestEnv,
} from './helpers/fakes';

vi.mock('../src/lingo/pipeline-v2');

const NOW = new Date('2026-10-23T12:00:00.000Z').getTime();

/** One queue message: `id` stays the same across its retries. */
function delivery(attempts: number, id = 'q-1') {
  return { id, attempts };
}

describe('handleLingualEvent', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
    t.channel(BROADCASTER_ID).settings = {
      language: 'english',
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
    const outcome = await handleLingualEvent(
      t.env,
      handlerEvent(),
      delivery(1)
    );

    expect(outcome).toEqual({ type: 'ack' });
    expect(t.send).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledWith({
      kind: 'send',
      sendId: 'lingual:m-1',
      broadcasterId: BROADCASTER_ID,
      senderId: 'pvtchbot',
      handlerId: 'lingual',
      message: 'hi friends, how is everyone tonight?',
      replyParentMessageId: 'msg-1',
      timestamp: NOW,
    });
  });

  it('posts a plain message with the no-thread flag', async () => {
    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { flags: [NO_THREAD_FLAG] }),
      delivery(1)
    );

    expect(t.send).toHaveBeenCalledWith(
      // eslint-disable-next-line unicorn/no-null -- schema: null means no thread
      expect.objectContaining({ replyParentMessageId: null })
    );
  });

  it('uses the OpenRouter flow with the translate-v2 flag', async () => {
    vi.mocked(translateChatMessageV2).mockResolvedValue({
      kind: 'reply',
      reply: 'hi from v2',
    });

    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { flags: [TRANSLATE_V2_FLAG] }),
      delivery(1)
    );

    expect(t.ai).not.toHaveBeenCalled();
    expect(t.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hi from v2' })
    );
  });

  it('acts once when the same fan-out arrives twice', async () => {
    await handleLingualEvent(t.env, handlerEvent(), delivery(1, 'q-1'));
    await handleLingualEvent(t.env, handlerEvent(), delivery(1, 'q-2'));

    expect(t.ai).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledOnce();
  });

  it('translates a repeated message once', async () => {
    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { messageId: 'm-1' }),
      delivery(1)
    );
    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { messageId: 'm-2' }),
      delivery(1)
    );

    expect(t.ai).toHaveBeenCalledOnce();
    expect(t.send).toHaveBeenCalledOnce();
  });

  it('does not count its own retry as a repeat', async () => {
    await handleLingualEvent(t.env, handlerEvent(), delivery(1));
    await handleLingualEvent(t.env, handlerEvent(), delivery(2));

    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it('keeps its claim on its own retry', async () => {
    t.channel(BROADCASTER_ID).claimed.set('lingual:m-1', 'q-1');

    await handleLingualEvent(t.env, handlerEvent(), delivery(2));

    expect(t.send).toHaveBeenCalledOnce();
  });

  it('drops a copy claimed by another queue message', async () => {
    t.channel(BROADCASTER_ID).claimed.set('lingual:m-1', 'q-other');

    await handleLingualEvent(t.env, handlerEvent(), delivery(2));

    expect(t.send).not.toHaveBeenCalled();
  });

  it('finishes the work after a crash past the claim', async () => {
    t.send.mockRejectedValueOnce(new Error('queue down'));
    await expect(
      handleLingualEvent(t.env, handlerEvent(), delivery(1))
    ).rejects.toThrow('queue down');

    const outcome = await handleLingualEvent(
      t.env,
      handlerEvent(),
      delivery(2)
    );

    expect(outcome).toEqual({ type: 'ack' });
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  describe('skips without translating', () => {
    it('a Shared Chat message from another channel', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent({ source_broadcaster_user_id: '999' })),
        delivery(1)
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
        delivery(1)
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a known bot', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent({ chatter_user_login: 'Nightbot' })),
        delivery(1)
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a channel with no Lingual language set', async () => {
      // eslint-disable-next-line unicorn/no-null -- RPC returns null
      t.channel(BROADCASTER_ID).settings.language = null;
      await handleLingualEvent(t.env, handlerEvent(), delivery(1));
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a message more than 60 seconds old', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { timestamp: NOW - 61_000 }),
        delivery(1)
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('an unexpected event type', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { subscriptionType: 'channel.follow' }),
        delivery(1)
      );
      expect(t.ai).not.toHaveBeenCalled();
    });
  });

  it('sends nothing when the translation is empty', async () => {
    t.ai.mockResolvedValue(
      aiResponse({ detected: 'Spanish', detectedCode: 'spa', translation: '' })
    );

    const outcome = await handleLingualEvent(
      t.env,
      handlerEvent(),
      delivery(1)
    );

    expect(outcome).toEqual({ type: 'ack' });
    expect(t.send).not.toHaveBeenCalled();
  });

  describe('when the model call fails', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      t.ai.mockRejectedValueOnce(new Error('AI down'));
    });

    it('retries after a short delay', async () => {
      const outcome = await handleLingualEvent(
        t.env,
        handlerEvent(),
        delivery(1)
      );

      expect(outcome).toEqual({
        type: 'retry',
        delaySeconds: RETRY_DELAY_SECONDS,
      });
      expect(t.send).not.toHaveBeenCalled();
    });

    it('posts the reply from its retry', async () => {
      await handleLingualEvent(t.env, handlerEvent(), delivery(1));
      vi.setSystemTime(NOW + RETRY_DELAY_SECONDS * 1000);

      const outcome = await handleLingualEvent(
        t.env,
        handlerEvent(),
        delivery(2)
      );

      expect(outcome).toEqual({ type: 'ack' });
      expect(t.send).toHaveBeenCalledOnce();
    });

    it('retries with the OpenRouter flow too', async () => {
      vi.mocked(translateChatMessageV2).mockResolvedValue({ kind: 'failed' });

      const outcome = await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { flags: [TRANSLATE_V2_FLAG] }),
        delivery(1)
      );

      expect(outcome).toMatchObject({ type: 'retry' });
    });

    it('leaves a repeat during the retry to the retry', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { messageId: 'm-1' }),
        delivery(1)
      );
      const repeat = await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { messageId: 'm-2' }),
        delivery(1)
      );
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { messageId: 'm-1' }),
        delivery(2)
      );

      expect(repeat).toEqual({ type: 'ack' });
      expect(t.ai).toHaveBeenCalledTimes(2);
      expect(t.send).toHaveBeenCalledOnce();
      expect(t.send).toHaveBeenCalledWith(
        expect.objectContaining({ sendId: 'lingual:m-1' })
      );
    });

    it('gives up when the retry would land too late', async () => {
      const outcome = await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { timestamp: NOW - 56_000 }),
        delivery(1)
      );

      expect(outcome).toEqual({ type: 'ack' });
    });

    it('lets a repeat translate after a too-late give-up', async () => {
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), {
          messageId: 'm-1',
          timestamp: NOW - 56_000,
        }),
        delivery(1, 'q-1')
      );
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { messageId: 'm-2' }),
        delivery(1, 'q-2')
      );

      expect(t.send).toHaveBeenCalledOnce();
      expect(t.send).toHaveBeenCalledWith(
        expect.objectContaining({ sendId: 'lingual:m-2' })
      );
    });

    it('lets a repeat translate after the last attempt fails', async () => {
      t.ai.mockRejectedValue(new Error('AI down'));
      const m1 = handlerEvent(chatEvent(), { messageId: 'm-1' });
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        await handleLingualEvent(t.env, m1, delivery(attempt, 'q-1'));
      }
      const repeat = handlerEvent(chatEvent(), { messageId: 'm-2' });
      await handleLingualEvent(t.env, repeat, delivery(1, 'q-2'));
      expect(t.ai).toHaveBeenCalledTimes(MAX_RETRIES);

      const last = await handleLingualEvent(
        t.env,
        m1,
        delivery(MAX_RETRIES + 1, 'q-1')
      );
      t.ai.mockResolvedValue(
        aiResponse({
          detected: 'Spanish',
          detectedCode: 'spa',
          translation: 'hi friends, how is everyone tonight?',
        })
      );
      await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { messageId: 'm-3' }),
        delivery(1, 'q-3')
      );

      expect(last).toMatchObject({ type: 'retry' });
      expect(t.send).toHaveBeenCalledOnce();
      expect(t.send).toHaveBeenCalledWith(
        expect.objectContaining({ sendId: 'lingual:m-3' })
      );
    });

    it('keeps a mark another queue message set', async () => {
      t.ai.mockRejectedValue(new Error('AI down'));
      const key = await messageKey(chatEvent().message.fragments);
      t.channel(BROADCASTER_ID).seen.set(key!, 'q-newer');

      await handleLingualEvent(
        t.env,
        handlerEvent(),
        delivery(MAX_RETRIES + 1, 'q-1')
      );

      expect(t.channel(BROADCASTER_ID).seen.get(key!)).toBe('q-newer');
    });

    it('still gives up when the release fails', async () => {
      const channel = t.channel(BROADCASTER_ID);
      const messageCache = channel.messageCache.bind(channel);
      vi.spyOn(channel, 'messageCache').mockImplementation(() => ({
        ...messageCache(),
        release: () => {
          throw new Error('no such method');
        },
      }));

      const outcome = await handleLingualEvent(
        t.env,
        handlerEvent(chatEvent(), { timestamp: NOW - 56_000 }),
        delivery(1)
      );

      expect(outcome).toEqual({ type: 'ack' });
      expect(console.warn).toHaveBeenCalledWith(
        'Lingual could not release a seen message',
        expect.any(Error)
      );
    });
  });

  it('keeps the mark after a quiet outcome', async () => {
    t.ai.mockResolvedValue(
      aiResponse({ detected: 'Spanish', detectedCode: 'spa', translation: '' })
    );

    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { messageId: 'm-1' }),
      delivery(1, 'q-1')
    );
    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { messageId: 'm-2' }),
      delivery(1, 'q-2')
    );

    expect(t.ai).toHaveBeenCalledOnce();
  });

  it('keeps the mark after a reply', async () => {
    await handleLingualEvent(
      t.env,
      handlerEvent(chatEvent(), { messageId: 'm-1' }),
      delivery(1, 'q-1')
    );

    const key = await messageKey(chatEvent().message.fragments);
    expect(t.channel(BROADCASTER_ID).seen.get(key!)).toBe('q-1');
  });
});

describe('MAX_RETRIES', () => {
  it('matches max_retries of the lingual-events consumer', () => {
    const path = new URL('../wrangler.jsonc', import.meta.url).pathname;
    const config = readFileSync(path, 'utf8');
    const match =
      /"queue":\s*"lingual-events",[^}]*"max_retries":\s*(\d+)/.exec(config);

    expect(Number(match?.[1])).toBe(MAX_RETRIES);
  });
});

function batch(body: unknown) {
  const message = {
    id: 'q-1',
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

  it('logs why an unrecognized message did not parse', async () => {
    const t = createTestEnv();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { batch: b } = batch({ kind: 'nope' });

    await consume(b, t.env);

    expect(error).toHaveBeenCalledWith(
      'Unrecognized lingual-events message',
      expect.any(Error)
    );
  });

  it('retries with the delay the handler asks for', async () => {
    const t = createTestEnv();
    t.channel(BROADCASTER_ID).settings.language = 'english';
    t.ai.mockRejectedValue(new Error('AI down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { message, batch: b } = batch(handlerEvent());

    await consume(b, t.env);

    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: RETRY_DELAY_SECONDS,
    });
    expect(message.ack).not.toHaveBeenCalled();
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
