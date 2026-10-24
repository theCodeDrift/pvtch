/* eslint-disable unicorn/no-null -- mirrors Twitch payloads, which use null */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleChatMessage } from '../src/bot/chat';
import {
  BOT_ID,
  BROADCASTER_ID,
  aiResponse,
  appTokenRoute,
  chatEvent,
  createTestEnv,
  mockFetch,
  type TestEnv,
} from './helpers/fakes';

const NOW = new Date('2026-10-23T12:00:00.000Z').getTime();

function sendRoute(response: () => Response) {
  return (url: URL, init: RequestInit | undefined) =>
    url.pathname === '/helix/chat/messages' && init?.method === 'POST'
      ? response()
      : undefined;
}

const sent = () =>
  Response.json({
    data: [{ message_id: 'reply-1', is_sent: true, drop_reason: null }],
  });

describe('handleChatMessage', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
    t.channel(BROADCASTER_ID).enabled = true;
    t.lingoConfigs.set(BROADCASTER_ID, { bots: [], language: 'english' });
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
    vi.unstubAllGlobals();
  });

  it('posts a threaded reply with the translation', async () => {
    const fetchMock = mockFetch(appTokenRoute, sendRoute(sent));

    const outcome = await handleChatMessage(t.env, chatEvent(), NOW);

    expect(outcome).toEqual({ type: 'ack' });
    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/chat/messages')
    );
    expect(JSON.parse(sendCall?.[1]?.body as string)).toEqual({
      broadcaster_id: BROADCASTER_ID,
      sender_id: BOT_ID,
      message: 'hi friends, how is everyone tonight?',
      reply_parent_message_id: 'msg-1',
    });
  });

  describe('skips without translating', () => {
    beforeEach(() => {
      mockFetch();
    });

    it("the bot's own message", async () => {
      await handleChatMessage(
        t.env,
        chatEvent({ chatter_user_id: BOT_ID, chatter_user_login: 'pvtchbot' }),
        NOW
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a Shared Chat message from another channel', async () => {
      await handleChatMessage(
        t.env,
        chatEvent({ source_broadcaster_user_id: '999' }),
        NOW
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a command', async () => {
      await handleChatMessage(
        t.env,
        chatEvent({
          message: {
            text: '!lurk',
            fragments: [{ type: 'text', text: '!lurk' }],
          },
        }),
        NOW
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a known bot', async () => {
      await handleChatMessage(
        t.env,
        chatEvent({ chatter_user_login: 'Nightbot' }),
        NOW
      );
      expect(t.ai).not.toHaveBeenCalled();
    });

    it("a user on the channel's ignore list", async () => {
      t.lingoConfigs.set(BROADCASTER_ID, {
        bots: ['Viewer'],
        language: 'english',
      });
      await handleChatMessage(t.env, chatEvent(), NOW);
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a channel with the bot disabled', async () => {
      t.channel(BROADCASTER_ID).enabled = false;
      await handleChatMessage(t.env, chatEvent(), NOW);
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a channel with no lingo config', async () => {
      t.lingoConfigs.delete(BROADCASTER_ID);
      await handleChatMessage(t.env, chatEvent(), NOW);
      expect(t.ai).not.toHaveBeenCalled();
    });

    it('a message more than 60 seconds old', async () => {
      await handleChatMessage(t.env, chatEvent(), NOW - 61_000);
      expect(t.ai).not.toHaveBeenCalled();
    });
  });

  describe('send tier from the bot’s own badges', () => {
    beforeEach(() => {
      mockFetch();
    });

    it('moves to moderator when the bot has a moderator badge', async () => {
      await handleChatMessage(
        t.env,
        chatEvent({
          chatter_user_id: BOT_ID,
          badges: [{ set_id: 'moderator', id: '1', info: '' }],
        }),
        NOW
      );
      expect(t.channel(BROADCASTER_ID).tier).toBe('moderator');
    });

    it('drops back to standard without one', async () => {
      t.channel(BROADCASTER_ID).tier = 'moderator';
      await handleChatMessage(
        t.env,
        chatEvent({ chatter_user_id: BOT_ID, badges: [] }),
        NOW
      );
      expect(t.channel(BROADCASTER_ID).tier).toBe('standard');
    });
  });

  describe('sending', () => {
    it('retries later without calling Helix when the bucket is empty', async () => {
      t.channel(BROADCASTER_ID).slot = { ok: false, retryAfterMs: 1500 };
      const fetchMock = mockFetch(appTokenRoute);

      const outcome = await handleChatMessage(t.env, chatEvent(), NOW);

      expect(outcome).toEqual({ type: 'retry', delaySeconds: 2 });
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('/chat/messages')
        )
      ).toBe(false);
    });

    it('retries after Ratelimit-Reset on a 429', async () => {
      mockFetch(
        appTokenRoute,
        sendRoute(
          () =>
            new Response(undefined, {
              status: 429,
              headers: { 'Ratelimit-Reset': String(NOW / 1000 + 5) },
            })
        )
      );

      const outcome = await handleChatMessage(t.env, chatEvent(), NOW);

      expect(outcome).toEqual({ type: 'retry', delaySeconds: 5 });
    });

    it('disables the bot on a 403', async () => {
      mockFetch(
        appTokenRoute,
        sendRoute(() => new Response(undefined, { status: 403 }))
      );

      const outcome = await handleChatMessage(t.env, chatEvent(), NOW);

      expect(outcome).toEqual({ type: 'ack' });
      expect(t.channel(BROADCASTER_ID).enabled).toBe(false);
    });

    it('throws on a 5xx so the queue retries with backoff', async () => {
      mockFetch(
        appTokenRoute,
        sendRoute(() => new Response(undefined, { status: 503 }))
      );

      await expect(handleChatMessage(t.env, chatEvent(), NOW)).rejects.toThrow(
        '503'
      );
    });

    it('logs and acks a message Twitch dropped', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch(
        appTokenRoute,
        sendRoute(() =>
          Response.json({
            data: [
              {
                message_id: '',
                is_sent: false,
                drop_reason: { code: 'msg_rejected', message: 'AutoMod' },
              },
            ],
          })
        )
      );

      const outcome = await handleChatMessage(t.env, chatEvent(), NOW);

      expect(outcome).toEqual({ type: 'ack' });
      expect(warn).toHaveBeenCalledWith(
        'Chat message dropped',
        expect.objectContaining({ code: 'msg_rejected' })
      );
    });

    it('acks a retry that lands more than 60 seconds after the message', async () => {
      mockFetch(appTokenRoute, sendRoute(sent));

      const outcome = await handleChatMessage(
        t.env,
        chatEvent(),
        NOW - 61_000,
        NOW - 1000
      );

      expect(outcome).toEqual({ type: 'ack' });
    });
  });
});
