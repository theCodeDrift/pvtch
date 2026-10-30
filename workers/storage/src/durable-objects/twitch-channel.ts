import { DurableObject } from 'cloudflare:workers';
import type { TwitchSyncMessage } from '@pvtch/shared/twitch-queue';
import {
  CHANNEL_EVENT_TYPES,
  HANDLER_IDS,
  TWITCH_HANDLERS,
  isHandlerId,
  isSenderId,
  type HandlerId,
  type SenderId,
} from '@pvtch/shared/twitch-registry';

import { migrate } from '../helpers/migrate';
import type { StorageEnv } from '../storage-env';
import { queryRows } from '../helpers/query-rows';
import { JobScheduler, type ScheduledJob } from '../helpers/job-scheduler';
import { twitchChannelMigrations } from './twitch-channel/migrations';
import { Flags } from './twitch-channel/plugins/flags';
import { Lingual } from './twitch-channel/plugins/lingual';

/** How long a claimed key is remembered. Twitch rejects (and we drop)
 * notifications older than 10 minutes, so 15 covers it. */
export const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

export type SendTier = 'standard' | 'moderator';

/** Twitch chat send limits per 30 seconds, by the sender's role in the
 * channel. */
export const SEND_TIERS: Record<
  SendTier,
  { capacity: number; windowMs: number }
> = {
  standard: { capacity: 20, windowMs: 30_000 },
  moderator: { capacity: 100, windowMs: 30_000 },
};

export interface HandlerState {
  enabled: boolean;
  enabledAt: number | null;
  updatedAt: number | null;
}

export interface SubscriptionRecord {
  senderId: SenderId;
  type: string;
  subscriptionId: string;
  status: string;
  updatedAt: number;
}

export type SendSlot =
  | { ok: true }
  | { ok: false; retryAfterMs: number }
  | { ok: false; duplicate: true };

export interface RouteEventInput {
  /** The EventSub message id to claim, or null on a retry */
  messageId: string | null;
  subscriptionType: string;
  /** The sender whose subscription delivered the event; null for
   * channel-level types */
  senderId: SenderId | null;
}

export interface RouteResult {
  /** False when `messageId` was already claimed */
  fresh: boolean;
  handlers: HandlerId[];
  flags: string[];
}

export { type LingualSettings } from './twitch-channel/plugins/lingual';

const PRUNE_DEDUPE_TASK = 'prune-dedupe';

/** While a sender has an enabled handler, re-check its subscriptions. */
export const RECONCILE_CRON = '0 */6 * * *';

const SYNC_TASK_PREFIX = 'sync-subscriptions:';
const RECONCILE_TASK_PREFIX = 'reconcile-subscriptions:';

/**
 * TwitchChannel - SQLite-backed Durable Object for per-broadcaster Twitch
 * state. Keyed by "twitch:{broadcasterId}".
 *
 * Holds what every handler shares: handler enablement, EventSub
 * subscription records and chat-send token buckets per sender, key claims
 * for dedupe, and the scheduler. Handler- and feature-specific state lives
 * in RpcTarget plugins (`lingual()`, `flags()`).
 *
 * Makes no Twitch API calls: subscription work is requested by sending
 * `sync` messages to the `twitch-events` queue, which pvtch-twitch consumes.
 */
export class TwitchChannel extends DurableObject<StorageEnv> {
  private sql: SqlStorage;
  private scheduler: JobScheduler;
  private _lingual: Lingual;
  private _flags: Flags;

  constructor(ctx: DurableObjectState, env: StorageEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migrate(this.sql, twitchChannelMigrations, '_twitch_channel_version');
    this.scheduler = new JobScheduler(this.sql, ctx, (job) => this.runJob(job));
    this._lingual = new Lingual(this.sql);
    this._flags = new Flags(this.sql);
  }

  async alarm(): Promise<void> {
    await this.scheduler.processAlarm();
  }

  lingual(): Lingual {
    return this._lingual;
  }

  flags(): Flags {
    return this._flags;
  }

  getHandler(handlerId: HandlerId): HandlerState {
    const row = queryRows<{
      enabled: number;
      enabled_at: number | null;
      updated_at: number;
    }>(
      this.sql,
      `SELECT enabled, enabled_at, updated_at FROM handlers WHERE handler_id = ?`,
      assertHandler(handlerId)
    )[0];
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

  /** Enabled handlers, in registry order. */
  listHandlers(): HandlerId[] {
    const enabled = new Set(
      queryRows<{ handler_id: string }>(
        this.sql,
        `SELECT handler_id FROM handlers WHERE enabled = 1`
      ).map((row) => row.handler_id)
    );
    return HANDLER_IDS.filter((id) => enabled.has(id));
  }

  /** Enable a handler. On a disabled-to-enabled transition, requests a
   * subscription sync for its sender and starts the sender's reconcile. */
  enableHandler(handlerId: HandlerId): HandlerState {
    const wasEnabled = this.getHandler(handlerId).enabled;
    const now = Date.now();
    // Keep the original enabled_at when already enabled.
    this.sql.exec(
      `INSERT INTO handlers (handler_id, enabled, enabled_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(handler_id) DO UPDATE SET
         enabled_at = CASE WHEN handlers.enabled = 1 THEN handlers.enabled_at ELSE excluded.enabled_at END,
         enabled = 1,
         updated_at = excluded.updated_at`,
      handlerId,
      now,
      now
    );
    if (!wasEnabled) this.senderChanged(TWITCH_HANDLERS[handlerId].sender);
    return this.getHandler(handlerId);
  }

  /** Disable a handler. On an enabled-to-disabled transition, requests a
   * subscription sync for its sender. */
  disableHandler(handlerId: HandlerId): HandlerState {
    const wasEnabled = this.getHandler(handlerId).enabled;
    this.sql.exec(
      `INSERT INTO handlers (handler_id, enabled, enabled_at, updated_at)
       VALUES (?, 0, NULL, ?)
       ON CONFLICT(handler_id) DO UPDATE SET enabled = 0, updated_at = excluded.updated_at`,
      handlerId,
      Date.now()
    );
    if (wasEnabled) this.senderChanged(TWITCH_HANDLERS[handlerId].sender);
    return this.getHandler(handlerId);
  }

  getSubscription(senderId: SenderId, type: string): SubscriptionRecord | null {
    return (
      this.listSubscriptions(senderId).find((record) => record.type === type) ??
      // eslint-disable-next-line unicorn/no-null -- RPC-serializable absent value
      null
    );
  }

  listSubscriptions(senderId: SenderId): SubscriptionRecord[] {
    return queryRows<{
      type: string;
      subscription_id: string;
      status: string;
      updated_at: number;
    }>(
      this.sql,
      `SELECT type, subscription_id, status, updated_at FROM subscriptions
       WHERE sender_id = ? ORDER BY type`,
      assertSender(senderId)
    ).map((row) => ({
      senderId,
      type: row.type,
      subscriptionId: row.subscription_id,
      status: row.status,
      updatedAt: row.updated_at,
    }));
  }

  setSubscription(
    senderId: SenderId,
    type: string,
    subscriptionId: string,
    status: string
  ): void {
    this.sql.exec(
      `INSERT INTO subscriptions (sender_id, type, subscription_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sender_id, type) DO UPDATE SET
         subscription_id = excluded.subscription_id,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      assertSender(senderId),
      type,
      subscriptionId,
      status,
      Date.now()
    );
  }

  clearSubscription(senderId: SenderId, type: string): void {
    this.sql.exec(
      `DELETE FROM subscriptions WHERE sender_id = ? AND type = ?`,
      assertSender(senderId),
      type
    );
  }

  /**
   * Claim a key. Returns true the first time a key is seen within the
   * dedupe window, false for every repeat. A single statement, so
   * concurrent callers can't both win: an expired claim is overwritten, a
   * live one is left alone and RETURNING yields no row.
   *
   * Keys: raw EventSub message ids (router), `<handlerId>:<messageId>`
   * (handlers), `send:<sendId>` (sends).
   */
  claim(key: string): boolean {
    const now = Date.now();
    const claimed = queryRows<{ message_id: string }>(
      this.sql,
      `INSERT INTO message_claims (message_id, claimed_at)
       VALUES (?, ?)
       ON CONFLICT(message_id) DO UPDATE SET claimed_at = excluded.claimed_at
         WHERE message_claims.claimed_at <= ?
       RETURNING message_id`,
      key,
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
   * The router's one call per event: claim the message, then say which
   * enabled handlers want it and with which flags.
   */
  routeEvent(input: RouteEventInput): RouteResult {
    const fresh = input.messageId === null || this.claim(input.messageId);
    if (!fresh) return { fresh, handlers: [], flags: [] };

    const enabled = this.listHandlers();
    const handlers = CHANNEL_EVENT_TYPES.includes(input.subscriptionType)
      ? enabled
      : enabled.filter((id) => {
          const handler = TWITCH_HANDLERS[id];
          return (
            handler.sender === input.senderId &&
            (handler.eventTypes as readonly string[]).includes(
              input.subscriptionType
            )
          );
        });
    return { fresh, handlers, flags: this._flags.list() };
  }

  /**
   * Take one chat-send token for a sender. With a `claimKey`, the send is
   * claimed first: a repeat returns `{ ok: false, duplicate: true }` without
   * spending a token. The claim is kept when no token is available, so the
   * caller's retry passes `null`. The bucket refills lazily from elapsed
   * time, so no alarm is needed.
   */
  acquireSendSlot(senderId: SenderId, claimKey: string | null): SendSlot {
    assertSender(senderId);
    if (claimKey !== null && !this.claim(claimKey)) {
      return { ok: false, duplicate: true };
    }

    const now = Date.now();
    const bucket = this.refillBucket(senderId, now);
    const { capacity, windowMs } = SEND_TIERS[bucket.tier];

    if (bucket.tokens >= 1) {
      this.writeBucket(senderId, bucket.tier, bucket.tokens - 1, now);
      return { ok: true };
    }

    this.writeBucket(senderId, bucket.tier, bucket.tokens, now);
    const msPerToken = windowMs / capacity;
    return {
      ok: false,
      retryAfterMs: Math.ceil((1 - bucket.tokens) * msPerToken),
    };
  }

  getSendTier(senderId: SenderId): SendTier {
    return this.refillBucket(assertSender(senderId), Date.now()).tier;
  }

  setSendTier(senderId: SenderId, tier: SendTier): void {
    const now = Date.now();
    const bucket = this.refillBucket(assertSender(senderId), now);
    this.writeBucket(
      senderId,
      tier,
      Math.min(bucket.tokens, SEND_TIERS[tier].capacity),
      now
    );
  }

  private refillBucket(
    senderId: SenderId,
    now: number
  ): { tier: SendTier; tokens: number } {
    const row = queryRows<{
      tier: SendTier;
      tokens: number;
      updated_at: number;
    }>(
      this.sql,
      `SELECT tier, tokens, updated_at FROM send_buckets WHERE sender_id = ?`,
      senderId
    )[0];
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

  private writeBucket(
    senderId: SenderId,
    tier: SendTier,
    tokens: number,
    now: number
  ): void {
    this.sql.exec(
      `INSERT INTO send_buckets (sender_id, tier, tokens, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sender_id) DO UPDATE SET
         tier = excluded.tier,
         tokens = excluded.tokens,
         updated_at = excluded.updated_at`,
      senderId,
      tier,
      tokens,
      now
    );
  }

  /** A handler using `senderId` changed state: sync its subscriptions now,
   * and keep the reconcile cron only while some handler still needs it. */
  private senderChanged(senderId: SenderId): void {
    const syncTask = `${SYNC_TASK_PREFIX}${senderId}`;
    this.scheduler.schedule(0, syncTask, {}, { key: syncTask });

    const reconcileTask = `${RECONCILE_TASK_PREFIX}${senderId}`;
    const needed = this.listHandlers().some(
      (id) => TWITCH_HANDLERS[id].sender === senderId
    );
    if (needed) {
      // The scheduler skips a task+cron pair that already exists.
      this.scheduler.schedule(RECONCILE_CRON, reconcileTask, {});
    } else {
      this.scheduler.cancel(reconcileTask, RECONCILE_CRON);
    }
  }

  private async sendSync(senderId: SenderId): Promise<void> {
    const message: TwitchSyncMessage = {
      kind: 'sync',
      broadcasterId: this.broadcasterId(),
      senderId,
    };
    await this.env.TWITCH_EVENTS.send(message);
  }

  private broadcasterId(): string {
    const name = this.ctx.id.name;
    if (!name?.startsWith('twitch:')) {
      throw new Error(`TwitchChannel has unexpected name: ${String(name)}`);
    }
    return name.slice('twitch:'.length);
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    if (job.task === PRUNE_DEDUPE_TASK) {
      this.pruneClaims();
      return;
    }
    for (const prefix of [SYNC_TASK_PREFIX, RECONCILE_TASK_PREFIX]) {
      if (!job.task.startsWith(prefix)) continue;
      const senderId = job.task.slice(prefix.length);
      if (isSenderId(senderId)) {
        await this.sendSync(senderId);
        return;
      }
    }
    console.warn(`Unknown scheduled task: ${job.task}`);
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

/** RPC arguments are untyped at runtime; reject ids not in the registry. */
function assertHandler(handlerId: string): HandlerId {
  if (!isHandlerId(handlerId)) {
    throw new Error(`Unknown handler: ${handlerId}`);
  }
  return handlerId;
}

function assertSender(senderId: string): SenderId {
  if (!isSenderId(senderId)) {
    throw new Error(`Unknown sender: ${senderId}`);
  }
  return senderId;
}
