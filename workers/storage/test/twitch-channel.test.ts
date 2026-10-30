import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  TwitchChannel,
  DEDUPE_WINDOW_MS,
  RECONCILE_CRON,
} from '../src/durable-objects/twitch-channel';
import { createWorkerdSql } from './helpers/workerd-sql';

const CHAT = 'channel.chat.message';

function drain(channel: TwitchChannel, count: number) {
  return Array.from({ length: count }, () =>
    // eslint-disable-next-line unicorn/no-null -- no claim
    channel.acquireSendSlot('botlingual', null)
  );
}

function routeChat(channel: TwitchChannel, messageId: string | null) {
  return channel.routeEvent({
    messageId,
    subscriptionType: CHAT,
    senderId: 'botlingual',
  });
}

describe('TwitchChannel', () => {
  let sql: SqlStorage;
  let setAlarm: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let channel: TwitchChannel;

  function construct(): TwitchChannel {
    const ctx = {
      id: { name: 'twitch:123' },
      storage: { sql, setAlarm },
    } as unknown as DurableObjectState;
    const env = { TWITCH_EVENTS: { send } } as unknown as Env;
    return new TwitchChannel(ctx, env);
  }

  function pendingJobs(task: string) {
    return sql
      .exec(
        'SELECT id, cron FROM jobs WHERE task = ? AND status = ?',
        task,
        'pending'
      )
      .toArray();
  }

  function tableNames() {
    return sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      )
      .toArray()
      .map((row) => row.name);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
    sql = createWorkerdSql();
    setAlarm = vi.fn();
    send = vi.fn(() => Promise.resolve());
    channel = construct();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('construction', () => {
    it('creates core, scheduler and plugin tables, each versioned', () => {
      expect(tableNames()).toEqual(
        expect.arrayContaining([
          'handlers',
          'subscriptions',
          'send_buckets',
          'message_claims',
          'jobs',
          'lingual_config',
          'flags',
          '_twitch_channel_version',
          '_lingual_version',
          '_flags_version',
        ])
      );
      expect(tableNames()).not.toEqual(
        expect.arrayContaining(['bot_state', 'send_bucket', 'lingual_settings'])
      );
    });

    it('re-constructing an existing channel keeps its state', () => {
      channel.enableHandler('lingual');

      const again = construct();

      expect(again.getHandler('lingual').enabled).toBe(true);
    });
  });

  describe('handler state', () => {
    it('defaults to disabled', () => {
      expect(channel.getHandler('lingual')).toEqual({
        enabled: false,
        // eslint-disable-next-line unicorn/no-null -- RPC returns null
        enabledAt: null,
        // eslint-disable-next-line unicorn/no-null -- RPC returns null
        updatedAt: null,
      });
      expect(channel.listHandlers()).toEqual([]);
    });

    it('enable then disable keeps the enable time', () => {
      const enabledAt = Date.now();
      channel.enableHandler('lingual');
      expect(channel.listHandlers()).toEqual(['lingual']);
      vi.advanceTimersByTime(5000);

      const state = channel.disableHandler('lingual');

      expect(state).toEqual({
        enabled: false,
        enabledAt,
        updatedAt: enabledAt + 5000,
      });
      expect(channel.listHandlers()).toEqual([]);
    });

    it('enabling an enabled handler keeps the original enable time', () => {
      const enabledAt = Date.now();
      channel.enableHandler('lingual');
      vi.advanceTimersByTime(5000);

      expect(channel.enableHandler('lingual').enabledAt).toBe(enabledAt);
    });

    it('rejects an unknown handler', () => {
      expect(() => channel.enableHandler('nope' as 'lingual')).toThrow(
        /Unknown handler/
      );
    });
  });

  describe('subscription sync requests', () => {
    const reconcileTask = 'reconcile-subscriptions:botlingual';

    it('enable requests one sync and starts the reconcile cron', async () => {
      channel.enableHandler('lingual');

      expect(pendingJobs(reconcileTask)).toEqual([
        expect.objectContaining({ cron: RECONCILE_CRON }),
      ]);
      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith({
        kind: 'sync',
        broadcasterId: '123',
        senderId: 'botlingual',
      });
    });

    it('a repeat enable requests nothing', async () => {
      channel.enableHandler('lingual');
      await channel.alarm();
      send.mockClear();

      channel.enableHandler('lingual');
      await channel.alarm();

      expect(send).not.toHaveBeenCalled();
      expect(pendingJobs(reconcileTask)).toHaveLength(1);
    });

    it('disable requests a sync and stops the reconcile cron', async () => {
      channel.enableHandler('lingual');
      await channel.alarm();
      send.mockClear();

      channel.disableHandler('lingual');
      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sync', senderId: 'botlingual' })
      );
      expect(pendingJobs(reconcileTask)).toHaveLength(0);
    });

    it('disabling a disabled handler requests nothing', async () => {
      channel.disableHandler('lingual');
      await channel.alarm();

      expect(send).not.toHaveBeenCalled();
    });

    it('enable then disable before the alarm syncs once', async () => {
      channel.enableHandler('lingual');
      channel.disableHandler('lingual');

      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(pendingJobs(reconcileTask)).toHaveLength(0);
    });

    it('retries a failed queue send with backoff', async () => {
      send.mockRejectedValueOnce(new Error('queue unavailable'));
      channel.enableHandler('lingual');

      await channel.alarm();
      expect(pendingJobs('sync-subscriptions:botlingual')).toHaveLength(1);

      vi.advanceTimersByTime(31_000);
      await channel.alarm();

      expect(send).toHaveBeenCalledTimes(2);
      expect(pendingJobs('sync-subscriptions:botlingual')).toHaveLength(0);
    });

    it('the reconcile cron requests a sync', async () => {
      channel.enableHandler('lingual');
      await channel.alarm();
      send.mockClear();

      vi.setSystemTime(new Date('2026-10-23T18:00:00Z'));
      await channel.alarm();

      expect(send).toHaveBeenCalledWith({
        kind: 'sync',
        broadcasterId: '123',
        senderId: 'botlingual',
      });
    });
  });

  describe('subscriptions', () => {
    it('records a subscription per sender and type', () => {
      channel.setSubscription(
        'botlingual',
        CHAT,
        'abc',
        'webhook_callback_verification_pending'
      );

      expect(channel.getSubscription('botlingual', CHAT)).toEqual({
        senderId: 'botlingual',
        type: CHAT,
        subscriptionId: 'abc',
        status: 'webhook_callback_verification_pending',
        updatedAt: Date.now(),
      });
      expect(channel.listSubscriptions('botlingual')).toHaveLength(1);
    });

    it('updates status and advances updatedAt', () => {
      channel.setSubscription(
        'botlingual',
        CHAT,
        'abc',
        'webhook_callback_verification_pending'
      );
      vi.advanceTimersByTime(1000);

      channel.setSubscription('botlingual', CHAT, 'abc', 'enabled');

      expect(channel.getSubscription('botlingual', CHAT)).toMatchObject({
        status: 'enabled',
        updatedAt: Date.now(),
      });
    });

    it('clears a subscription', () => {
      channel.setSubscription('botlingual', CHAT, 'abc', 'enabled');

      channel.clearSubscription('botlingual', CHAT);

      expect(channel.getSubscription('botlingual', CHAT)).toBeNull();
    });

    it('returns null for an unknown type', () => {
      expect(channel.getSubscription('botlingual', 'nope')).toBeNull();
    });
  });

  describe('claim', () => {
    it('returns true for the first claim', () => {
      expect(channel.claim('m1')).toBe(true);
    });

    it('returns false for a repeat within the window', () => {
      channel.claim('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS - 1);

      expect(channel.claim('m1')).toBe(false);
    });

    it('keeps different keys independent', () => {
      expect(channel.claim('m1')).toBe(true);
      expect(channel.claim('lingual:m1')).toBe(true);
    });

    it('treats an expired claim as new', () => {
      channel.claim('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS);

      expect(channel.claim('m1')).toBe(true);
    });

    it('queues at most one prune job', () => {
      channel.claim('m1');
      channel.claim('m2');
      channel.claim('m3');

      expect(pendingJobs('prune-dedupe')).toHaveLength(1);
    });

    it('prunes expired keys and stops once none remain', async () => {
      channel.claim('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS);

      await channel.alarm();

      expect(
        sql.exec('SELECT message_id FROM message_claims').toArray()
      ).toHaveLength(0);
      expect(pendingJobs('prune-dedupe')).toHaveLength(0);
    });

    it('keeps live keys and comes back when the oldest expires', async () => {
      channel.claim('m1');
      vi.advanceTimersByTime(10 * 60 * 1000);
      const secondAt = Date.now();
      channel.claim('m2');
      vi.advanceTimersByTime(5 * 60 * 1000);

      await channel.alarm();

      const remaining = sql
        .exec<{ message_id: string }>('SELECT message_id FROM message_claims')
        .toArray()
        .map((row) => row.message_id);
      expect(remaining).toEqual(['m2']);
      const next = sql
        .exec<{
          scheduled_at: number;
        }>(
          "SELECT scheduled_at FROM jobs WHERE task = 'prune-dedupe' AND status = 'pending'"
        )
        .one();
      expect(next.scheduled_at).toBe(secondAt + DEDUPE_WINDOW_MS);
    });
  });

  describe('routeEvent', () => {
    it('returns the enabled handler and the flags', () => {
      channel.enableHandler('lingual');
      channel.flags().set('lingual.reply-threading', true);

      expect(routeChat(channel, 'm1')).toEqual({
        fresh: true,
        handlers: ['lingual'],
        flags: ['lingual.reply-threading'],
      });
    });

    it('returns no handlers when the handler is disabled', () => {
      expect(routeChat(channel, 'm1').handlers).toEqual([]);
    });

    it('is not fresh on a redelivery', () => {
      channel.enableHandler('lingual');
      routeChat(channel, 'm1');

      expect(routeChat(channel, 'm1')).toMatchObject({
        fresh: false,
        handlers: [],
      });
    });

    it('skips the claim on a retry', () => {
      // eslint-disable-next-line unicorn/no-null -- retry
      expect(routeChat(channel, null).fresh).toBe(true);
      expect(
        sql.exec('SELECT message_id FROM message_claims').toArray()
      ).toHaveLength(0);
    });

    it('returns every enabled handler for a channel-level type', () => {
      channel.enableHandler('lingual');

      expect(
        channel.routeEvent({
          messageId: 'r1',
          subscriptionType: 'user.authorization.revoke',
          // eslint-disable-next-line unicorn/no-null -- channel-level
          senderId: null,
        }).handlers
      ).toEqual(['lingual']);
    });
  });

  describe('send bucket', () => {
    it('allows 20 sends in quick succession on a new channel', () => {
      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
    });

    it('refuses the 21st with about 1500ms to wait', () => {
      drain(channel, 20);

      expect(drain(channel, 1)[0]).toEqual({
        ok: false,
        retryAfterMs: 1500,
      });
    });

    it('refills fully after 30 seconds', () => {
      drain(channel, 20);
      vi.advanceTimersByTime(30_000);

      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
      expect(drain(channel, 1)[0]?.ok).toBe(false);
    });

    it('allows up to 100 per 30 seconds on the moderator tier', () => {
      channel.setSendTier('botlingual', 'moderator');
      vi.advanceTimersByTime(30_000);

      expect(channel.getSendTier('botlingual')).toBe('moderator');
      expect(drain(channel, 100).every((slot) => slot.ok)).toBe(true);
      expect(drain(channel, 1)[0]?.ok).toBe(false);
    });

    it('clamps tokens when dropping back to standard', () => {
      channel.setSendTier('botlingual', 'moderator');
      vi.advanceTimersByTime(30_000);

      channel.setSendTier('botlingual', 'standard');

      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
      expect(drain(channel, 1)[0]?.ok).toBe(false);
    });

    it('reports a duplicate send without spending a token', () => {
      expect(channel.acquireSendSlot('botlingual', 'send:lingual:m1')).toEqual({
        ok: true,
      });

      expect(channel.acquireSendSlot('botlingual', 'send:lingual:m1')).toEqual({
        ok: false,
        duplicate: true,
      });
      expect(drain(channel, 19).every((slot) => slot.ok)).toBe(true);
      expect(drain(channel, 1)[0]?.ok).toBe(false);
    });

    it('keeps the claim while waiting for a slot', () => {
      drain(channel, 20);
      const first = channel.acquireSendSlot('botlingual', 'send:lingual:m1');
      expect(first).toMatchObject({ ok: false, retryAfterMs: 1500 });
      vi.advanceTimersByTime(1500);

      // eslint-disable-next-line unicorn/no-null -- retry
      expect(channel.acquireSendSlot('botlingual', null)).toEqual({ ok: true });
      expect(channel.acquireSendSlot('botlingual', 'send:lingual:m1')).toEqual({
        ok: false,
        duplicate: true,
      });
    });
  });

  describe('Lingual plugin', () => {
    it('starts with no language and no ignored chatters', () => {
      expect(channel.lingual().getSettings()).toEqual({
        // eslint-disable-next-line unicorn/no-null -- RPC returns null
        language: null,
        ignoredChatters: [],
      });
    });

    it('normalizes and persists settings across instances', () => {
      channel.lingual().setSettings({
        language: ' Spanish ',
        ignoredChatters: ['@StreamElements', 'nightbot', 'NIGHTBOT', ' '],
      });
      expect(construct().lingual().getSettings()).toEqual({
        language: 'spanish',
        ignoredChatters: ['streamelements', 'nightbot'],
      });
    });

    it('clears the language when given an empty one', () => {
      channel
        .lingual()
        .setSettings({ language: 'english', ignoredChatters: [] });
      channel.lingual().setSettings({ language: '', ignoredChatters: [] });
      expect(channel.lingual().getSettings().language).toBeNull();
    });
  });

  describe('Flags plugin', () => {
    it('starts with no flags on', () => {
      expect(channel.flags().list()).toEqual([]);
    });

    it('turns a flag on and off', () => {
      expect(channel.flags().set('lingual.reply-threading', true)).toEqual([
        'lingual.reply-threading',
      ]);
      expect(channel.flags().set('lingual.reply-threading', false)).toEqual([]);
    });
  });
});
