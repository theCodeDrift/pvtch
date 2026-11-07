// Older fork of the scheduler used by the core `User` DO (one-shot only,
// public `scheduled()` host). `workers/storage/src/helpers/job-scheduler.ts`
// is the current version (cron, handler callback); the two diverge
// intentionally until `User` moves to storage.

import { migrate } from '../migrate';
import { jobSchedulerMigrations } from './migrations';

export interface ScheduledJob {
  task: string;
  payload: unknown;
}

export interface JobOptions {
  /** Maximum number of retry attempts on failure (default: 3) */
  maxRetries?: number;
  /** Base delay in seconds for exponential backoff (default: 30) */
  backoffBaseSeconds?: number;
  /** Optional idempotency key. If a job with this key is currently queued (pending), scheduling is skipped. Running, completed, and dead jobs do not block, so a handler can re-schedule itself with the same key for recurring work. */
  key?: string;
}

export interface JobSchedulerHost {
  scheduled(job: ScheduledJob): void | Promise<void>;
}

/** How long to retain completed/dead jobs before reaping (30 days) */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a job may stay `running` before processAlarm() treats its handler
 * as lost (evicted or redeployed mid-await) and fails it. A DO alarm handler
 * gets at most 15 minutes of wall time, so a live handler never outlasts it.
 */
export const JOB_LEASE_MS = 15 * 60 * 1000;

/** The columns processAlarm() reads to run a job and record its outcome. */
interface JobRow {
  id: string;
  task: string;
  payload: string;
  attempt: number;
  max_retries: number;
  backoff_base_seconds: number;
  idempotency_key: string | null;
}

/**
 * Job scheduler for Durable Objects.
 *
 * Multiplexes multiple scheduled jobs over the DO's single alarm slot
 * using a SQLite `jobs` table. Supports one-shot (Date/number) schedules
 * with per-job retry and exponential backoff.
 */
export class JobScheduler {
  private sql: SqlStorage;
  private ctx: DurableObjectState;

  constructor(sql: SqlStorage, ctx: DurableObjectState) {
    this.sql = sql;
    this.ctx = ctx;
    migrate(sql, jobSchedulerMigrations, '_job_scheduler_version');
  }

  /**
   * Schedule a job for future execution.
   * @param when - Date (absolute time) or number (seconds from now)
   * @param task - Discriminator string identifying the job type
   * @param payload - JSON-serializable data passed to the scheduled() callback
   * @param options - Retry and backoff configuration
   */
  schedule<T>(
    when: Date | number,
    task: string,
    payload: T,
    options?: JobOptions
  ): string | undefined {
    const now = Date.now();
    const maxRetries = options?.maxRetries ?? 3;
    const backoffBaseSeconds = options?.backoffBaseSeconds ?? 30;
    const scheduledAt =
      when instanceof Date ? when.getTime() : now + when * 1000;

    // Idempotency key deduplication: skip only if a job with this key is
    // already queued (pending). Running jobs do NOT block — otherwise a
    // handler that reschedules itself with the same key (the recurring-job
    // pattern, e.g. sync-profile re-arming for tomorrow) gets deduped
    // against its own in-flight row and never re-arms. Completed/dead jobs
    // also do not block.
    if (options?.key) {
      const existing = this.sql
        .exec(
          `SELECT id FROM jobs WHERE idempotency_key = ? AND status = 'pending' LIMIT 1`,
          options.key
        )
        .toArray();
      if (existing.length > 0) return undefined;
    }

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO jobs (id, task, payload, scheduled_at, cron, status, attempt, max_retries, backoff_base_seconds, last_error, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, NULL, 'pending', 0, ?, ?, NULL, ?, ?)`,
      id,
      task,
      JSON.stringify(payload),
      scheduledAt,
      maxRetries,
      backoffBaseSeconds,
      // eslint-disable-next-line unicorn/no-null -- SQL requires null for absent values
      options?.key ?? null,
      now
    );

    this.syncAlarm();
    return id;
  }

  /**
   * Called from the DO's alarm() handler. Recovers jobs whose lease expired,
   * then processes all due jobs and invokes host.scheduled() for each.
   *
   * This method never throws. Individual job failures are caught,
   * recorded via last_error on the job row, and retried with exponential
   * backoff. A failure to record one job's outcome is logged and leaves the
   * row `running`, where the lease recovers it; it never skips other jobs.
   */
  async processAlarm(host: JobSchedulerHost): Promise<void> {
    const now = Date.now();
    this.recoverExpiredLeases(now);

    const dueJobs = this.sql
      .exec(
        `SELECT id, task, payload, attempt, max_retries, backoff_base_seconds, idempotency_key
       FROM jobs
       WHERE scheduled_at <= ? AND status = 'pending'
       ORDER BY scheduled_at ASC`,
        now
      )
      .toArray() as unknown as JobRow[];

    for (const job of dueJobs) {
      this.sql.exec(
        `UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`,
        Date.now(),
        job.id
      );

      try {
        await host.scheduled({
          task: job.task,
          payload: JSON.parse(job.payload),
        });

        // Success: mark completed
        this.sql.exec(
          `UPDATE jobs SET status = 'completed' WHERE id = ?`,
          job.id
        );
      } catch (error) {
        try {
          this.recordFailure(
            job,
            error instanceof Error ? error.message : String(error),
            now
          );
        } catch (bookkeepingError) {
          console.error(
            `JobScheduler: could not record failure of job ${job.id}`,
            bookkeepingError
          );
        }
      }
    }

    // Reap old jobs (completed or dead) past retention period
    const cutoff = now - JOB_RETENTION_MS;
    this.sql.exec(
      `DELETE FROM jobs WHERE status IN ('completed', 'dead') AND created_at < ?`,
      cutoff
    );

    this.syncAlarm();
  }

  /**
   * Fail every job that has been `running` longer than the lease: its handler
   * was cut off (eviction, deploy) and its row would otherwise stay `running`
   * forever.
   */
  private recoverExpiredLeases(now: number): void {
    const expired = this.sql
      .exec(
        `SELECT id, task, payload, attempt, max_retries, backoff_base_seconds, idempotency_key
         FROM jobs
         WHERE status = 'running' AND (started_at IS NULL OR started_at <= ?)`,
        now - JOB_LEASE_MS
      )
      .toArray() as unknown as JobRow[];

    for (const job of expired) {
      try {
        this.recordFailure(job, 'lease expired while running', now);
      } catch (error) {
        console.error(`JobScheduler: could not recover job ${job.id}`, error);
      }
    }
  }

  /**
   * Retry a failed job with backoff, or mark it dead once retries run out.
   *
   * Only one pending row may hold an idempotency key, and `schedule()` may
   * have queued a newer one with the same key while this job ran. That newer
   * row supersedes the retry, so this job is marked dead with its error.
   */
  private recordFailure(job: JobRow, errorMessage: string, now: number): void {
    const superseded =
      job.idempotency_key !== null &&
      this.sql
        .exec(
          `SELECT id FROM jobs WHERE idempotency_key = ? AND status = 'pending' AND id != ? LIMIT 1`,
          job.idempotency_key,
          job.id
        )
        .toArray().length > 0;

    if (job.attempt < job.max_retries && !superseded) {
      // Retry with exponential backoff: base * 2^attempt seconds
      const delayMs =
        job.backoff_base_seconds * Math.pow(2, job.attempt) * 1000;
      this.sql.exec(
        `UPDATE jobs SET status = 'pending', attempt = ?, scheduled_at = ?, last_error = ? WHERE id = ?`,
        job.attempt + 1,
        now + delayMs,
        errorMessage,
        job.id
      );
    } else {
      // Retries exhausted or superseded: mark as dead
      this.sql.exec(
        `UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?`,
        errorMessage,
        job.id
      );
    }
  }

  /**
   * Set the DO alarm to the earliest pending job's scheduled_at time, or the
   * earliest lease expiry of a running job if that comes first. If neither
   * exists, do not set an alarm.
   */
  private syncAlarm(): boolean {
    const next = this.sql
      .exec(
        `SELECT MIN(at) as next_at FROM (
           SELECT scheduled_at AS at FROM jobs WHERE status = 'pending'
           UNION ALL
           SELECT COALESCE(started_at, 0) + ? AS at FROM jobs WHERE status = 'running'
         )`,
        JOB_LEASE_MS
      )
      .toArray();

    const nextAt = next[0]?.next_at as number | undefined;
    if (nextAt) {
      void this.ctx.storage.setAlarm(nextAt);
      return true;
    }
    return false;
  }
}
