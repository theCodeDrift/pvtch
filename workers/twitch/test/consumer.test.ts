/* eslint-disable unicorn/no-null -- mirrors Twitch payloads, which use null */
import type { TwitchSendMessage } from '@pvtch/shared/twitch-queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consume, handleQueueMessage } from '../src/consumer';
import { getAppToken, helix } from '../src/twitch/helix';
import {
  BOT_ID,
  BROADCASTER_ID,
  appTokenRoute,
  chatEvent,
  createTestEnv,
  mockFetch,
  type TestEnv,
} from './helpers/fakes';

const NOW = new Date('2026-10-23T12:00:00.000Z').getTime();

function chatMessage(
  event = chatEvent(),
  overrides: Record<string, unknown> = {}
) {
  return {
    kind: 'event',
    messageId: 'm-1',
    subscriptionType: 'channel.chat.message',
    condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
    timestamp: NOW,
    event,
    ...overrides,
  };
}

describe('router', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
    t.channel(BROADCASTER_ID).enableHandler('lingual');
    mockFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fans a chat event out to lingual-events with the channel flags', async () => {
    t.channel(BROADCASTER_ID).flagSet.add('lingual.reply-threading');

    expect(await handleQueueMessage(t.env, chatMessage(), 1)).toEqual({
      type: 'ack',
    });

    expect(t.lingualSend).toHaveBeenCalledOnce();
    expect(t.lingualSend).toHaveBeenCalledWith({
      kind: 'handler-event',
      handlerId: 'lingual',
      broadcasterId: BROADCASTER_ID,
      senderId: 'botlingual',
      messageId: 'm-1',
      subscriptionType: 'channel.chat.message',
      timestamp: NOW,
      event: chatEvent(),
      flags: ['lingual.reply-threading'],
    });
  });

  it('drops a duplicate delivery of the same EventSub message', async () => {
    t.channel(BROADCASTER_ID).claimed.add('m-1');

    await handleQueueMessage(t.env, chatMessage(), 1);

    expect(t.lingualSend).not.toHaveBeenCalled();
  });

  it('fans out again on its own retry without re-claiming', async () => {
    t.channel(BROADCASTER_ID).claimed.add('m-1');

    await handleQueueMessage(t.env, chatMessage(), 2);

    expect(t.lingualSend).toHaveBeenCalledOnce();
  });

  it('sends nothing when the handler is disabled on the channel', async () => {
    t.channel(BROADCASTER_ID).disableHandler('lingual');

    await handleQueueMessage(t.env, chatMessage(), 1);

    expect(t.lingualSend).not.toHaveBeenCalled();
  });

  it('acks an untracked type without asking the channel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routeEvent = vi.spyOn(t.channel(BROADCASTER_ID), 'routeEvent');

    await handleQueueMessage(
      t.env,
      chatMessage(chatEvent(), { subscriptionType: 'channel.follow' }),
      1
    );

    expect(routeEvent).not.toHaveBeenCalled();
  });

  it('acks an event for an unregistered sender', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleQueueMessage(
      t.env,
      chatMessage(chatEvent(), {
        condition: { broadcaster_user_id: BROADCASTER_ID, user_id: '999' },
      }),
      1
    );

    expect(t.lingualSend).not.toHaveBeenCalled();
  });

  it('throws when the fan-out fails so the event retries', async () => {
    t.lingualSend.mockRejectedValueOnce(new Error('queue down'));

    await expect(handleQueueMessage(t.env, chatMessage(), 1)).rejects.toThrow(
      'queue down'
    );
  });

  describe("a sender's own message", () => {
    it('is not fanned out', async () => {
      await handleQueueMessage(
        t.env,
        chatMessage(chatEvent({ chatter_user_id: BOT_ID })),
        1
      );
      expect(t.lingualSend).not.toHaveBeenCalled();
    });

    it('moves to the moderator tier with a moderator badge', async () => {
      await handleQueueMessage(
        t.env,
        chatMessage(
          chatEvent({
            chatter_user_id: BOT_ID,
            badges: [{ set_id: 'moderator', id: '1', info: '' }],
          })
        ),
        1
      );
      expect(t.channel(BROADCASTER_ID).getSendTier('botlingual')).toBe(
        'moderator'
      );
    });

    it('drops back to standard without one', async () => {
      t.channel(BROADCASTER_ID).setSendTier('botlingual', 'moderator');
      await handleQueueMessage(
        t.env,
        chatMessage(chatEvent({ chatter_user_id: BOT_ID, badges: [] })),
        1
      );
      expect(t.channel(BROADCASTER_ID).getSendTier('botlingual')).toBe(
        'standard'
      );
    });
  });

  it('acks a message that is not a twitch-events message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await handleQueueMessage(t.env, { kind: 'nope' }, 1)).toEqual({
      type: 'ack',
    });
  });
});

describe('authorization revoke', () => {
  it('disables every enabled handler and clears recorded scopes', async () => {
    const t = createTestEnv();
    t.channel('u-7').enableHandler('lingual');
    await t.accounts.put(
      'twitch-data-u-7',
      JSON.stringify({ id: 'u-7', login: 'someone', scopes: ['channel:bot'] })
    );

    await handleQueueMessage(
      t.env,
      {
        kind: 'event',
        messageId: 'r-1',
        subscriptionType: 'user.authorization.revoke',
        condition: { client_id: 'client-id' },
        timestamp: Date.now(),
        event: { client_id: 'client-id', user_id: 'u-7', user_login: null },
      },
      1
    );

    expect(t.channel('u-7').listHandlers()).toEqual([]);
    expect(JSON.parse(t.accounts.store.get('twitch-data-u-7') ?? '{}')).toEqual(
      { id: 'u-7', login: 'someone' }
    );
  });
});

function sendMessage(
  overrides: Partial<TwitchSendMessage> = {}
): TwitchSendMessage {
  return {
    kind: 'send',
    sendId: 'lingual:m-1',
    broadcasterId: BROADCASTER_ID,
    senderId: 'botlingual',
    handlerId: 'lingual',
    message: 'hi friends',
    replyParentMessageId: 'msg-1',
    timestamp: NOW,
    ...overrides,
  };
}

const sendRoute =
  (response: () => Response) => (url: URL, init: RequestInit | undefined) =>
    url.pathname === '/helix/chat/messages' && init?.method === 'POST'
      ? response()
      : undefined;

const sent = () =>
  Response.json({
    data: [{ message_id: 'reply-1', is_sent: true, drop_reason: null }],
  });

const helixSends = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/chat/messages')
  );

describe('send', () => {
  let t: TestEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    t = createTestEnv();
    t.channel(BROADCASTER_ID).enableHandler('lingual');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts a threaded reply as the sender', async () => {
    const fetchMock = mockFetch(appTokenRoute, sendRoute(sent));

    expect(await handleQueueMessage(t.env, sendMessage(), 1)).toEqual({
      type: 'ack',
    });
    expect(JSON.parse(helixSends(fetchMock)[0]?.[1]?.body as string)).toEqual({
      broadcaster_id: BROADCASTER_ID,
      sender_id: BOT_ID,
      message: 'hi friends',
      reply_parent_message_id: 'msg-1',
    });
  });

  it('posts once when the same send arrives twice', async () => {
    const fetchMock = mockFetch(appTokenRoute, sendRoute(sent));

    await handleQueueMessage(t.env, sendMessage(), 1);
    await handleQueueMessage(t.env, sendMessage(), 1);

    expect(helixSends(fetchMock)).toHaveLength(1);
  });

  it('retries later without calling Helix when the bucket is empty', async () => {
    t.channel(BROADCASTER_ID).slot = { ok: false, retryAfterMs: 1500 };
    const fetchMock = mockFetch(appTokenRoute);

    expect(await handleQueueMessage(t.env, sendMessage(), 1)).toEqual({
      type: 'retry',
      delaySeconds: 2,
    });
    expect(helixSends(fetchMock)).toHaveLength(0);
  });

  it('does not claim again on its own retry', async () => {
    const fetchMock = mockFetch(appTokenRoute, sendRoute(sent));
    t.channel(BROADCASTER_ID).claimed.add('send:lingual:m-1');

    await handleQueueMessage(t.env, sendMessage(), 2);

    expect(helixSends(fetchMock)).toHaveLength(1);
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

    expect(await handleQueueMessage(t.env, sendMessage(), 1)).toEqual({
      type: 'retry',
      delaySeconds: 5,
    });
  });

  it("disables the sender's handlers on a 403", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch(
      appTokenRoute,
      sendRoute(() => new Response(undefined, { status: 403 }))
    );

    expect(await handleQueueMessage(t.env, sendMessage(), 1)).toEqual({
      type: 'ack',
    });
    expect(t.channel(BROADCASTER_ID).listHandlers()).toEqual([]);
  });

  it('throws on a 5xx so the queue retries with backoff', async () => {
    mockFetch(
      appTokenRoute,
      sendRoute(() => new Response(undefined, { status: 503 }))
    );

    await expect(handleQueueMessage(t.env, sendMessage(), 1)).rejects.toThrow(
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

    expect(await handleQueueMessage(t.env, sendMessage(), 1)).toEqual({
      type: 'ack',
    });
    expect(warn).toHaveBeenCalledWith(
      'Chat message dropped',
      expect.objectContaining({ code: 'msg_rejected', handlerId: 'lingual' })
    );
  });

  it('acks without sending more than 60 seconds after the source message', async () => {
    const fetchMock = mockFetch(appTokenRoute, sendRoute(sent));

    await handleQueueMessage(
      t.env,
      sendMessage({ timestamp: NOW - 61_000 }),
      1
    );

    expect(helixSends(fetchMock)).toHaveLength(0);
  });
});

describe('consume', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps outcomes onto ack, delayed retry, and default retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = createTestEnv();
    t.channel(BROADCASTER_ID).enableHandler('lingual');
    t.channel(BROADCASTER_ID).setSubscription(
      'botlingual',
      'channel.chat.message',
      's-1',
      'enabled'
    );
    const make = (body: unknown) => ({
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const ignored = make({ kind: 'nope' });
    const limited = make({
      kind: 'sync',
      broadcasterId: BROADCASTER_ID,
      senderId: 'botlingual',
    });
    const broken = make(chatMessage());
    t.lingualSend.mockRejectedValueOnce(new Error('queue down'));
    mockFetch(appTokenRoute, (url) =>
      url.searchParams.has('subscription_id')
        ? new Response(undefined, {
            status: 429,
            headers: {
              'Ratelimit-Reset': String(Math.ceil(Date.now() / 1000) + 3),
            },
          })
        : undefined
    );

    await consume(
      { messages: [ignored, limited, broken] } as unknown as MessageBatch,
      t.env
    );

    expect(ignored.ack).toHaveBeenCalled();
    expect(limited.retry).toHaveBeenCalledWith({
      delaySeconds: expect.any(Number) as number,
    });
    expect(broken.retry).toHaveBeenCalledWith();
  });
});

describe('helix', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a cached app token', async () => {
    const t = createTestEnv();
    const fetchMock = mockFetch((url) =>
      url.hostname === 'id.twitch.tv'
        ? Response.json({ access_token: 'tok', expires_in: 3600 })
        : undefined
    );

    await getAppToken(t.env);
    await getAppToken(t.env);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(t.kv.store.get('twitch-app-token')).toBe('tok');
  });

  it('refreshes the token once and retries on a 401', async () => {
    const t = createTestEnv();
    await t.kv.put('twitch-app-token', 'stale');
    const seen: string[] = [];
    mockFetch(
      (url) =>
        url.hostname === 'id.twitch.tv'
          ? Response.json({ access_token: 'fresh', expires_in: 3600 })
          : undefined,
      (url, init) => {
        if (url.hostname !== 'api.twitch.tv') return;
        const auth = new Headers(init?.headers).get('Authorization') ?? '';
        seen.push(auth);
        return new Response(undefined, {
          status: auth === 'Bearer stale' ? 401 : 200,
        });
      }
    );

    const response = await helix(t.env, '/users');

    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(t.kv.store.get('twitch-app-token')).toBe('fresh');
  });
});
