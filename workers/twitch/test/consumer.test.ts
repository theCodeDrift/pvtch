import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consume, handleQueueMessage } from '../src/consumer';
import { handleAuthorizationRevoke } from '../src/bot/revoke';
import { getAppToken, helix } from '../src/twitch/helix';
import {
  BROADCASTER_ID,
  chatEvent,
  createTestEnv,
  mockFetch,
  type TestEnv,
} from './helpers/fakes';

describe('queue consumer', () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv();
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a duplicate delivery of the same EventSub message', async () => {
    t.channel(BROADCASTER_ID).claimed.add('m-1');
    const message = {
      kind: 'event',
      messageId: 'm-1',
      subscriptionType: 'channel.chat.message',
      timestamp: Date.now(),
      event: chatEvent(),
    };

    expect(await handleQueueMessage(t.env, message, 1)).toEqual({
      type: 'ack',
    });
    expect(t.ai).not.toHaveBeenCalled();
  });

  it('lets our own retry through without re-claiming', async () => {
    t.channel(BROADCASTER_ID).claimed.add('m-1');
    t.channel(BROADCASTER_ID).enabled = false; // stop before translating
    const claim = vi.spyOn(t.channel(BROADCASTER_ID), 'claimMessage');

    await handleQueueMessage(
      t.env,
      {
        kind: 'event',
        messageId: 'm-1',
        subscriptionType: 'channel.chat.message',
        timestamp: Date.now(),
        event: chatEvent(),
      },
      2
    );

    expect(claim).not.toHaveBeenCalled();
  });

  it('logs and acks an unhandled subscription type', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await handleQueueMessage(
      t.env,
      {
        kind: 'event',
        messageId: 'm-2',
        subscriptionType: 'channel.follow',
        timestamp: Date.now(),
        event: {},
      },
      1
    );

    expect(outcome).toEqual({ type: 'ack' });
    expect(warn).toHaveBeenCalled();
  });

  it('acks a message that is not a twitch-events message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await handleQueueMessage(t.env, { kind: 'nope' }, 1)).toEqual({
      type: 'ack',
    });
  });

  it('maps outcomes onto ack, delayed retry, and default retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const make = (body: unknown) => ({
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const ignored = make({ kind: 'nope' });
    const limited = make({ kind: 'reconcile', broadcasterId: BROADCASTER_ID });
    const broken = make({ kind: 'subscribe', broadcasterId: BROADCASTER_ID });
    t.channel(BROADCASTER_ID).enabled = true;
    t.channel(BROADCASTER_ID).setSubscription(
      'channel.chat.message',
      's-1',
      'enabled'
    );
    vi.unstubAllGlobals();
    mockFetch(
      (url) =>
        url.hostname === 'id.twitch.tv'
          ? Response.json({ access_token: 'tok', expires_in: 3600 })
          : undefined,
      (url, init) =>
        url.searchParams.has('subscription_id')
          ? new Response(undefined, {
              status: 429,
              headers: {
                'Ratelimit-Reset': String(Math.ceil(Date.now() / 1000) + 3),
              },
            })
          : init?.method === 'POST'
            ? new Response(undefined, { status: 500 })
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

describe('authorization revoke', () => {
  it('disables the bot and clears recorded scopes', async () => {
    const t = createTestEnv();
    t.channel('u-7').enabled = true;
    await t.accounts.put(
      'twitch-data-u-7',
      JSON.stringify({ id: 'u-7', login: 'someone', scopes: ['channel:bot'] })
    );

    await handleAuthorizationRevoke(t.env, {
      client_id: 'client-id',
      user_id: 'u-7',
    });

    expect(t.channel('u-7').enabled).toBe(false);
    expect(JSON.parse(t.accounts.store.get('twitch-data-u-7') ?? '{}')).toEqual(
      { id: 'u-7', login: 'someone' }
    );
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
