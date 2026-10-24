import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapRevokeSubscription,
  reconcile,
  subscribe,
  unsubscribe,
} from '../src/twitch/subscriptions';
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

describe('subscriptions', () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv();
    t.channel(BROADCASTER_ID).enabled = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('subscribe', () => {
    it('creates a chat subscription for the bot and records it', async () => {
      const fetchMock = mockFetch(
        appTokenRoute,
        route('POST', '/helix/eventsub/subscriptions', () =>
          Response.json(
            { data: [sub('s-1', 'webhook_callback_verification_pending')] },
            { status: 202 }
          )
        )
      );

      expect(await subscribe(t.env, BROADCASTER_ID)).toEqual({ type: 'ack' });

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
      expect(t.channel(BROADCASTER_ID).getSubscription(TYPE)).toMatchObject({
        subscriptionId: 's-1',
        status: 'webhook_callback_verification_pending',
      });
    });

    it('keeps an enabled status the challenge already recorded', async () => {
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-1', 'enabled');
      mockFetch(
        appTokenRoute,
        route('POST', '/helix/eventsub/subscriptions', () =>
          Response.json(
            { data: [sub('s-1', 'webhook_callback_verification_pending')] },
            { status: 202 }
          )
        )
      );

      await subscribe(t.env, BROADCASTER_ID);

      expect(t.channel(BROADCASTER_ID).getSubscription(TYPE)?.status).toBe(
        'enabled'
      );
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

      await subscribe(t.env, BROADCASTER_ID);

      expect(
        t.channel(BROADCASTER_ID).getSubscription(TYPE)?.subscriptionId
      ).toBe('s-existing');
    });

    it('disables the bot on a 403', async () => {
      mockFetch(
        appTokenRoute,
        route(
          'POST',
          '/helix/eventsub/subscriptions',
          () => new Response(undefined, { status: 403 })
        )
      );

      expect(await subscribe(t.env, BROADCASTER_ID)).toEqual({ type: 'ack' });
      expect(t.channel(BROADCASTER_ID).enabled).toBe(false);
    });

    it('does nothing when the bot was disabled meanwhile', async () => {
      t.channel(BROADCASTER_ID).enabled = false;
      const fetchMock = mockFetch();

      await subscribe(t.env, BROADCASTER_ID);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('deletes the subscription, treating 404 as gone, and clears the record', async () => {
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-1', 'enabled');
      const deleted: string[] = [];
      mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-1'), sub('s-2')] })
        ),
        route('DELETE', '/helix/eventsub/subscriptions', (url) => {
          deleted.push(url.searchParams.get('id') ?? '');
          return new Response(undefined, {
            status: deleted.length === 1 ? 204 : 404,
          });
        })
      );

      expect(await unsubscribe(t.env, BROADCASTER_ID)).toEqual({
        type: 'ack',
      });
      expect(deleted).toEqual(['s-1', 's-2']);
      expect(t.channel(BROADCASTER_ID).getSubscription(TYPE)).toBeNull();
    });
  });

  describe('reconcile', () => {
    it('makes no Helix writes for a healthy subscription', async () => {
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-1', 'enabled');
      const fetchMock = mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-1')] })
        )
      );

      await reconcile(t.env, BROADCASTER_ID);

      const writes = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/helix/') && (init?.method ?? 'GET') !== 'GET'
      );
      expect(writes).toHaveLength(0);
    });

    it('recreates a subscription Twitch revoked', async () => {
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-old', 'enabled');
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

      await reconcile(t.env, BROADCASTER_ID);

      expect(
        t.channel(BROADCASTER_ID).getSubscription(TYPE)?.subscriptionId
      ).toBe('s-new');
    });

    it('subscribes when an enabled channel has no record', async () => {
      mockFetch(
        appTokenRoute,
        route('POST', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-1', 'enabled')] }, { status: 202 })
        )
      );

      await reconcile(t.env, BROADCASTER_ID);

      expect(t.channel(BROADCASTER_ID).getSubscription(TYPE)).not.toBeNull();
    });

    it('unsubscribes a disabled channel', async () => {
      t.channel(BROADCASTER_ID).enabled = false;
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-1', 'enabled');
      mockFetch(
        appTokenRoute,
        route('GET', '/helix/eventsub/subscriptions', () =>
          Response.json({ data: [sub('s-1')] })
        ),
        route(
          'DELETE',
          '/helix/eventsub/subscriptions',
          () => new Response(undefined, { status: 204 })
        )
      );

      await reconcile(t.env, BROADCASTER_ID);

      expect(t.channel(BROADCASTER_ID).getSubscription(TYPE)).toBeNull();
    });

    it('waits for Ratelimit-Reset on a 429', async () => {
      t.channel(BROADCASTER_ID).setSubscription(TYPE, 's-1', 'enabled');
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

      const outcome = await reconcile(t.env, BROADCASTER_ID);

      expect(outcome.type).toBe('retry');
    });
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
