import { DurableObject } from 'cloudflare:workers';

import { migrate } from '../helpers/migrate';
import { queryRows } from '../helpers/query-rows';
import { JobScheduler, type ScheduledJob } from '../helpers/job-scheduler';
import { twitchChannelMigrations } from './twitch-channel/migrations';

/** How long a claimed EventSub message id is remembered. Twitch rejects
 * (and we drop) notifications older than 10 minutes, so 15 covers it. */
export const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

export type SendTier = 'standard' | 'moderator';

/** Twitch chat send limits per 30 seconds, by the bot's role in the channel. */
export const SEND_TIERS: Record<
  SendTier,
  { capacity: number; windowMs: number }
> = {
  standard: { capacity: 20, windowMs: 30_000 },
  moderator: { capacity: 100, windowMs: 30_000 },
};

export interface BotState {
  enabled: boolean;
  enabledAt: number | null;
  updatedAt: number | null;
}

export interface SubscriptionRecord {
  type: string;
  subscriptionId: string;
  status: string;
  updatedAt: number;
}

export type SendSlot = { ok: true } | { ok: false; retryAfterMs: number };

const PRUNE_DEDUPE_TASK = 'prune-dedupe';

/**
 * TwitchChannel - SQLite-backed Durable Object for per-broadcaster Twitch
 * state. Keyed by "twitch:{broadcasterId}". Holds bot enablement, the
 * EventSub subscription record, message-id dedupe, and the chat-send token
 * bucket. Makes no Twitch API calls.
 */
export class TwitchChannel extends DurableObject<Env> {
  private sql: SqlStorage;
  private scheduler: JobScheduler;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migrate(this.sql, twitchChannelMigrations, '_twitch_channel_version');
    this.scheduler = new JobScheduler(this.sql, ctx, (job) => this.runJob(job));
  }

  async alarm(): Promise<void> {
    await this.scheduler.processAlarm();
  }

  getBot(): BotState {
    const row = queryRows<{
      enabled: number;
      enabled_at: number | null;
      updated_at: number;
    }>(this.sql, `SELECT enabled, enabled_at, updated_at FROM bot_state`)[0];
    if (!row) {
      // eslint-disable-next-line unicorn/no-null -- RPC-serializable absent value
      return { enabled: false, enabledAt: null, updatedAt: null };
    }
    return {
      enabled: row.enabled === 1,
      enabledAt: row.enabled_at,
      updatedAt: row.updated_at,
    };
  }

  enableBot(): BotState {
    const now = Date.now();
    // Keep the original enabled_at when already enabled.
    this.sql.exec(
      `INSERT INTO bot_state (id, enabled, enabled_at, updated_at)
       VALUES (1, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         enabled_at = CASE WHEN bot_state.enabled = 1 THEN bot_state.enabled_at ELSE excluded.enabled_at END,
         enabled = 1,
         updated_at = excluded.updated_at`,
      now,
      now
    );
    return this.getBot();
  }

  disableBot(): BotState {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO bot_state (id, enabled, enabled_at, updated_at)
       VALUES (1, 0, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = 0, updated_at = excluded.updated_at`,
      now
    );
    return this.getBot();
  }

  getSubscription(type: string): SubscriptionRecord | null {
    const row = queryRows<{
      type: string;
      subscription_id: string;
      status: string;
      updated_at: number;
    }>(
      this.sql,
      `SELECT type, subscription_id, status, updated_at FROM subscriptions WHERE type = ?`,
      type
    )[0];
    // eslint-disable-next-line unicorn/no-null -- RPC-serializable absent value
    if (!row) return null;
    return {
      type: row.type,
      subscriptionId: row.subscription_id,
      status: row.status,
      updatedAt: row.updated_at,
    };
  }

  setSubscription(type: string, subscriptionId: string, status: string): void {
    this.sql.exec(
      `INSERT INTO subscriptions (type, subscription_id, status, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         subscription_id = excluded.subscription_id,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      type,
      subscriptionId,
      status,
      Date.now()
    );
  }

  clearSubscription(type: string): void {
    this.sql.exec(`DELETE FROM subscriptions WHERE type = ?`, type);
  }

  /**
   * Claim an EventSub message id. Returns true the first time an id is seen
   * within the dedupe window, false for every redelivery. A single statement,
   * so concurrent consumers can't both win: an expired claim is overwritten,
   * a live one is left alone and RETURNING yields no row.
   */
  claimMessage(messageId: string): boolean {
    const now = Date.now();
    const claimed = queryRows<{ message_id: string }>(
      this.sql,
      `INSERT INTO message_claims (message_id, claimed_at)
       VALUES (?, ?)
       ON CONFLICT(message_id) DO UPDATE SET claimed_at = excluded.claimed_at
         WHERE message_claims.claimed_at <= ?
       RETURNING message_id`,
      messageId,
      now,
      now - DEDUPE_WINDOW_MS
    );

    // At most one prune is ever queued (pending-only idempotency key).
    this.scheduler.schedule(
      DEDUPE_WINDOW_MS / 1000,
      PRUNE_DEDUPE_TASK,
      {},
      { key: PRUNE_DEDUPE_TASK }
    );

    return claimed.length > 0;
  }

  /**
   * Take one chat-send token. The bucket refills lazily from elapsed time,
   * so no alarm is needed; callers wait `retryAfterMs` when it is empty.
   */
  acquireSendSlot(): SendSlot {
    const now = Date.now();
    const bucket = this.refillBucket(now);
    const { capacity, windowMs } = SEND_TIERS[bucket.tier];

    if (bucket.tokens >= 1) {
      this.writeBucket(bucket.tier, bucket.tokens - 1, now);
      return { ok: true };
    }

    this.writeBucket(bucket.tier, bucket.tokens, now);
    const msPerToken = windowMs / capacity;
    return {
      ok: false,
      retryAfterMs: Math.ceil((1 - bucket.tokens) * msPerToken),
    };
  }

  setSendTier(tier: SendTier): void {
    const now = Date.now();
    const bucket = this.refillBucket(now);
    this.writeBucket(
      tier,
      Math.min(bucket.tokens, SEND_TIERS[tier].capacity),
      now
    );
  }

  private refillBucket(now: number): { tier: SendTier; tokens: number } {
    const row = queryRows<{
      tier: SendTier;
      tokens: number;
      updated_at: number;
    }>(this.sql, `SELECT tier, tokens, updated_at FROM send_bucket`)[0];
    if (!row) {
      return { tier: 'standard', tokens: SEND_TIERS.standard.capacity };
    }
    const { capacity, windowMs } = SEND_TIERS[row.tier];
    const elapsed = Math.max(0, now - row.updated_at);
    return {
      tier: row.tier,
      tokens: Math.min(capacity, row.tokens + (elapsed * capacity) / windowMs),
    };
  }

  private writeBucket(tier: SendTier, tokens: number, now: number): void {
    this.sql.exec(
      `INSERT INTO send_bucket (id, tier, tokens, updated_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tier = excluded.tier,
         tokens = excluded.tokens,
         updated_at = excluded.updated_at`,
      tier,
      tokens,
      now
    );
  }

  private runJob(job: ScheduledJob): Promise<void> {
    switch (job.task) {
      case PRUNE_DEDUPE_TASK: {
        this.pruneClaims();
        break;
      }
      default: {
        console.warn(`Unknown scheduled task: ${job.task}`);
      }
    }
    return Promise.resolve();
  }

  private pruneClaims(): void {
    const now = Date.now();
    this.sql.exec(
      `DELETE FROM message_claims WHERE claimed_at <= ?`,
      now - DEDUPE_WINDOW_MS
    );
    const oldest = queryRows<{ claimed_at: number }>(
      this.sql,
      `SELECT MIN(claimed_at) AS claimed_at FROM message_claims`
    )[0]?.claimed_at;
    if (oldest) {
      // Come back when the oldest remaining claim expires.
      this.scheduler.schedule(
        new Date(oldest + DEDUPE_WINDOW_MS),
        PRUNE_DEDUPE_TASK,
        {},
        { key: PRUNE_DEDUPE_TASK }
      );
    }
  }
}
