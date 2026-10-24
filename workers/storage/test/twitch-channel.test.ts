import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  TwitchChannel,
  DEDUPE_WINDOW_MS,
  RECONCILE_CRON,
} from '../src/durable-objects/twitch-channel';
import { createWorkerdSql } from './helpers/workerd-sql';

function drain(channel: TwitchChannel, count: number) {
  return Array.from({ length: count }, () => channel.acquireSendSlot());
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
    it('creates its tables and the scheduler jobs table', () => {
      const tables = sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
        .toArray()
        .map((row) => row.name);
      expect(tables).toEqual(
        expect.arrayContaining([
          'bot_state',
          'subscriptions',
          'message_claims',
          'send_bucket',
          'jobs',
        ])
      );
    });

    it('re-constructing an existing channel keeps its state', () => {
      channel.enableBot();

      const again = construct();

      expect(again.getBot().enabled).toBe(true);
    });
  });

  describe('bot state', () => {
    it('defaults to disabled', () => {
      const state = channel.getBot();
      expect(state.enabled).toBe(false);
      expect(state.enabledAt).toBeNull();
      expect(state.updatedAt).toBeNull();
    });

    it('enable then disable keeps the enable time', () => {
      const enabledAt = Date.now();
      channel.enableBot();
      vi.advanceTimersByTime(5000);

      const state = channel.disableBot();

      expect(state).toEqual({
        enabled: false,
        enabledAt,
        updatedAt: enabledAt + 5000,
      });
    });

    it('enabling an enabled bot keeps the original enable time', () => {
      const enabledAt = Date.now();
      channel.enableBot();
      vi.advanceTimersByTime(5000);

      expect(channel.enableBot().enabledAt).toBe(enabledAt);
    });

    it('re-enabling after a disable records the new enable time', () => {
      channel.enableBot();
      channel.disableBot();
      vi.advanceTimersByTime(5000);

      expect(channel.enableBot().enabledAt).toBe(Date.now());
    });
  });

  describe('Twitch work requests', () => {
    it('enable requests one subscribe and starts the reconcile cron', async () => {
      channel.enableBot();

      expect(pendingJobs('reconcile-subscription')).toEqual([
        expect.objectContaining({ cron: RECONCILE_CRON }),
      ]);
      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith({
        kind: 'subscribe',
        broadcasterId: '123',
      });
    });

    it('a repeat enable requests nothing', async () => {
      channel.enableBot();
      await channel.alarm();
      send.mockClear();

      channel.enableBot();
      await channel.alarm();

      expect(send).not.toHaveBeenCalled();
      expect(pendingJobs('reconcile-subscription')).toHaveLength(1);
    });

    it('disable requests one unsubscribe and stops the reconcile cron', async () => {
      channel.enableBot();
      await channel.alarm();
      send.mockClear();

      channel.disableBot();
      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith({
        kind: 'unsubscribe',
        broadcasterId: '123',
      });
      expect(pendingJobs('reconcile-subscription')).toHaveLength(0);
    });

    it('disabling a disabled bot requests nothing', async () => {
      channel.disableBot();
      await channel.alarm();

      expect(send).not.toHaveBeenCalled();
    });

    it('enable then disable before the alarm only unsubscribes', async () => {
      channel.enableBot();
      channel.disableBot();

      await channel.alarm();

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'unsubscribe' })
      );
    });

    it('retries a failed queue send with backoff', async () => {
      send.mockRejectedValueOnce(new Error('queue unavailable'));
      channel.enableBot();

      await channel.alarm();
      expect(pendingJobs('request-subscribe')).toHaveLength(1);

      vi.advanceTimersByTime(31_000);
      await channel.alarm();

      expect(send).toHaveBeenCalledTimes(2);
      expect(pendingJobs('request-subscribe')).toHaveLength(0);
    });

    it('the reconcile cron requests a reconcile', async () => {
      channel.enableBot();
      await channel.alarm();
      send.mockClear();

      vi.setSystemTime(new Date('2026-10-23T18:00:00Z'));
      await channel.alarm();

      expect(send).toHaveBeenCalledWith({
        kind: 'reconcile',
        broadcasterId: '123',
      });
    });
  });

  describe('subscriptions', () => {
    const type = 'channel.chat.message';

    it('records a subscription', () => {
      channel.setSubscription(
        type,
        'abc',
        'webhook_callback_verification_pending'
      );

      expect(channel.getSubscription(type)).toEqual({
        type,
        subscriptionId: 'abc',
        status: 'webhook_callback_verification_pending',
        updatedAt: Date.now(),
      });
    });

    it('updates status and advances updatedAt', () => {
      channel.setSubscription(
        type,
        'abc',
        'webhook_callback_verification_pending'
      );
      vi.advanceTimersByTime(1000);

      channel.setSubscription(type, 'abc', 'enabled');

      expect(channel.getSubscription(type)).toMatchObject({
        status: 'enabled',
        updatedAt: Date.now(),
      });
    });

    it('clears a subscription', () => {
      channel.setSubscription(type, 'abc', 'enabled');

      channel.clearSubscription(type);

      expect(channel.getSubscription(type)).toBeNull();
    });

    it('returns null for an unknown type', () => {
      expect(channel.getSubscription('nope')).toBeNull();
    });
  });

  describe('claimMessage', () => {
    it('returns true for the first claim', () => {
      expect(channel.claimMessage('m1')).toBe(true);
    });

    it('returns false for a redelivery within the window', () => {
      channel.claimMessage('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS - 1);

      expect(channel.claimMessage('m1')).toBe(false);
    });

    it('treats an expired claim as new', () => {
      channel.claimMessage('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS);

      expect(channel.claimMessage('m1')).toBe(true);
    });

    it('queues at most one prune job', () => {
      channel.claimMessage('m1');
      channel.claimMessage('m2');
      channel.claimMessage('m3');

      const prunes = sql
        .exec(
          "SELECT id FROM jobs WHERE task = 'prune-dedupe' AND status = 'pending'"
        )
        .toArray();
      expect(prunes).toHaveLength(1);
    });

    it('prunes expired ids and stops once none remain', async () => {
      channel.claimMessage('m1');
      vi.advanceTimersByTime(DEDUPE_WINDOW_MS);

      await channel.alarm();

      expect(
        sql.exec('SELECT message_id FROM message_claims').toArray()
      ).toHaveLength(0);
      expect(
        sql
          .exec(
            "SELECT id FROM jobs WHERE task = 'prune-dedupe' AND status = 'pending'"
          )
          .toArray()
      ).toHaveLength(0);
    });

    it('keeps live ids and comes back when the oldest expires', async () => {
      channel.claimMessage('m1');
      vi.advanceTimersByTime(10 * 60 * 1000);
      const secondAt = Date.now();
      channel.claimMessage('m2');
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

  describe('send bucket', () => {
    it('allows 20 sends in quick succession on a new channel', () => {
      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
    });

    it('refuses the 21st with about 1500ms to wait', () => {
      drain(channel, 20);

      expect(channel.acquireSendSlot()).toEqual({
        ok: false,
        retryAfterMs: 1500,
      });
    });

    it('refills fully after 30 seconds', () => {
      drain(channel, 20);
      vi.advanceTimersByTime(30_000);

      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
      expect(channel.acquireSendSlot().ok).toBe(false);
    });

    it('allows up to 100 per 30 seconds on the moderator tier', () => {
      channel.setSendTier('moderator');
      vi.advanceTimersByTime(30_000);

      expect(drain(channel, 100).every((slot) => slot.ok)).toBe(true);
      expect(channel.acquireSendSlot().ok).toBe(false);
    });

    it('clamps tokens when dropping back to standard', () => {
      channel.setSendTier('moderator');
      vi.advanceTimersByTime(30_000);

      channel.setSendTier('standard');

      expect(drain(channel, 20).every((slot) => slot.ok)).toBe(true);
      expect(channel.acquireSendSlot().ok).toBe(false);
    });
  });
});
