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
  /** Optional idempotency key. If a job with this key is currently queued or running, scheduling is skipped. Completed/dead jobs do not block, so a handler can re-schedule itself with the same key for recurring work. */
  key?: string;
}

export interface JobSchedulerHost {
  scheduled(job: ScheduledJob): void | Promise<void>;
}

/** How long to retain completed/dead jobs before reaping (30 days) */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
   * Called from the DO's alarm() handler. Processes all due jobs
   * and invokes host.scheduled() for each.
   *
   * This method never throws. Individual job failures are caught,
   * recorded via last_error on the job row, and retried with exponential backoff.
   */
  async processAlarm(host: JobSchedulerHost): Promise<void> {
    const now = Date.now();
    const dueJobs = this.sql
      .exec(
        `SELECT id, task, payload, attempt, max_retries, backoff_base_seconds
       FROM jobs
       WHERE scheduled_at <= ? AND status = 'pending'
       ORDER BY scheduled_at ASC`,
        now
      )
      .toArray();

    for (const job of dueJobs) {
      this.sql.exec(`UPDATE jobs SET status = 'running' WHERE id = ?`, job.id);

      try {
        await host.scheduled({
          task: job.task as string,
          payload: JSON.parse(job.payload as string),
        });

        // Success: mark completed
        this.sql.exec(
          `UPDATE jobs SET status = 'completed' WHERE id = ?`,
          job.id
        );
      } catch (error) {
        const attempt = job.attempt as number;
        const maxRetries = job.max_retries as number;
        const backoffBase = job.backoff_base_seconds as number;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (attempt < maxRetries) {
          // Retry with exponential backoff: base * 2^attempt seconds
          const delayMs = backoffBase * Math.pow(2, attempt) * 1000;
          const nextRetryAt = now + delayMs;

          this.sql.exec(
            `UPDATE jobs SET status = 'pending', attempt = ?, scheduled_at = ?, last_error = ? WHERE id = ?`,
            attempt + 1,
            nextRetryAt,
            errorMessage,
            job.id
          );
        } else {
          // Retries exhausted: mark as dead
          this.sql.exec(
            `UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?`,
            errorMessage,
            job.id
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
   * Set the DO alarm to the earliest pending job's scheduled_at time.
   * If no pending jobs, do not set an alarm.
   */
  private syncAlarm(): boolean {
    const next = this.sql
      .exec(
        `SELECT MIN(scheduled_at) as next_at FROM jobs WHERE status = 'pending'`
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
