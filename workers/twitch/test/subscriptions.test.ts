import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapRevokeSubscription, sync } from '../src/twitch/subscriptions';
import {
  BOT_ID,
  BROADCASTER_ID,
  appTokenRoute,
  createTestEnv,
  mockFetch,
  type FetchRoute,
  type TestEnv,
} from './helpers/fakes';

const TYPE = 'channel.chat.message';

function sub(id: string, status = 'enabled') {
  return {
    id,
    status,
    type: TYPE,
    version: '1',
    condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
  };
}

const route =
  (method: string, path: string, respond: (url: URL) => Response): FetchRoute =>
  (url, init) =>
    url.pathname === path && (init?.method ?? 'GET') === method
      ? respond(url)
      : undefined;

const CHAT = { senderId: 'botlingual', type: TYPE } as const;

describe('subscription sync', () => {
  let t: TestEnv;

  const record = () =>
    t.channel(BROADCASTER_ID).getSubscription(CHAT.senderId, CHAT.type);

  beforeEach(() => {
    t = createTestEnv();
    t.channel(BROADCASTER_ID).enableHandler('lingual');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('with lingual enabled', () => {
    it('creates the chat subscription for its sender and records it', async () => {
      const fetchMock = mockFetch(
        appTokenRoute,
        route('POST', '/helix/eventsub/subscriptions', () =>
          Response.json(
            { data: [sub('s-1', 'webhook_callback_verification_pending')] },
            { status: 202 }
          )
        )
      );

      expect(await sync(t.env, BROADCASTER_ID, 'botlingual')).toEqual({
        type: 'ack',
      });

      const body: unknown = JSON.parse(
        fetchMock.mock.calls.find(([url]) =>
          String(url).includes('/eventsub/subscriptions')
        )?.[1]?.body as string
      );
      expect(body).toMatchObject({
        type: TYPE,
        version: '1',
        condition: { broadcaster_user_id: BROADCASTER_ID, user_id: BOT_ID },
        transport: {
          method: 'webhook',
          callback: 'https://twitch.example.com/eventsub',
        },
      });
      expect(record()).toMatchObject({
        subscriptionId: 's-1',
        status: 'webhook_callback_verification_pending',
      });
    });

    it('records the existing subscription on a 409', async () => {
      mockFetch(
        appTokenRoute,
        route(
          'POST',
          '/helix/eventsub/subscriptions',
          () => new Response(undefined, { status: 409 })
        ),
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-existing')] })
        )
      );

      await sync(t.env, BROADCASTER_ID, 'botlingual');

      expect(record()?.subscriptionId).toBe('s-existing');
    });

    it("disables the sender's handlers on a 403", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch(
        appTokenRoute,
        route(
          'POST',
          '/helix/eventsub/subscriptions',
          () => new Response(undefined, { status: 403 })
        )
      );

      expect(await sync(t.env, BROADCASTER_ID, 'botlingual')).toEqual({
        type: 'ack',
      });
      expect(t.channel(BROADCASTER_ID).listHandlers()).toEqual([]);
    });

    it('makes no Helix writes for a healthy subscription', async () => {
      t.channel(BROADCASTER_ID).setSubscription(
        CHAT.senderId,
        TYPE,
        's-1',
        'enabled'
      );
      const fetchMock = mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-1')] })
        )
      );

      await sync(t.env, BROADCASTER_ID, 'botlingual');

      const writes = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/helix/') && (init?.method ?? 'GET') !== 'GET'
      );
      expect(writes).toHaveLength(0);
    });

    it('recreates a subscription Twitch revoked', async () => {
      t.channel(BROADCASTER_ID).setSubscription(
        CHAT.senderId,
        TYPE,
        's-old',
        'enabled'
      );
      mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', (url) =>
          url.searchParams.has('subscription_id')
            ? Response.json({
                data: [sub('s-old', 'notification_failures_exceeded')],
              })
            : Response.json({ data: [] })
        ),
        route('POST', '/helix/eventsub/subscriptions', () =>
          Response.json(
            { data: [sub('s-new', 'webhook_callback_verification_pending')] },
            { status: 202 }
          )
        )
      );

      await sync(t.env, BROADCASTER_ID, 'botlingual');

      expect(record()?.subscriptionId).toBe('s-new');
    });

    it('waits for Ratelimit-Reset on a 429', async () => {
      t.channel(BROADCASTER_ID).setSubscription(
        CHAT.senderId,
        TYPE,
        's-1',
        'enabled'
      );
      mockFetch(
        appTokenRoute,
        route(
          'GET',
          '/helix/eventsub/subscriptions',
          () =>
            new Response(undefined, {
              status: 429,
              headers: {
                'Ratelimit-Reset': String(Math.ceil(Date.now() / 1000) + 10),
              },
            })
        )
      );

      const outcome = await sync(t.env, BROADCASTER_ID, 'botlingual');

      expect(outcome.type).toBe('retry');
    });
  });

  describe('with no handler using the sender', () => {
    it('deletes its subscriptions, treating 404 as gone, and clears the record', async () => {
      t.channel(BROADCASTER_ID).disableHandler('lingual');
      t.channel(BROADCASTER_ID).setSubscription(
        CHAT.senderId,
        TYPE,
        's-1',
        'enabled'
      );
      const deleted: string[] = [];
      mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({
            data: [
              sub('s-1'),
              sub('s-2'),
              {
                ...sub('s-other'),
                condition: {
                  broadcaster_user_id: BROADCASTER_ID,
                  user_id: '999',
                },
              },
            ],
          })
        ),
        route('DELETE', '/helix/eventsub/subscriptions', (url) => {
          deleted.push(url.searchParams.get('id') ?? '');
          return new Response(undefined, {
            status: deleted.length === 1 ? 204 : 404,
          });
        })
      );

      expect(await sync(t.env, BROADCASTER_ID, 'botlingual')).toEqual({
        type: 'ack',
      });
      expect(deleted).toEqual(['s-1', 's-2']);
      expect(record()).toBeNull();
    });

    it('makes no Helix calls when nothing is recorded', async () => {
      t.channel(BROADCASTER_ID).disableHandler('lingual');
      const fetchMock = mockFetch();

      await sync(t.env, BROADCASTER_ID, 'botlingual');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('bootstrap', () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('bootstrapRevokeSubscription', () => {
    it('treats 409 as already done', async () => {
      mockFetch(
        appTokenRoute,
        route(
          'POST',
          '/helix/eventsub/subscriptions',
          () => new Response(undefined, { status: 409 })
        )
      );

      expect(await bootstrapRevokeSubscription(t.env)).toEqual({
        ok: true,
        status: 409,
      });
    });
  });
});
