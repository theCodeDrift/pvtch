// Lifted from taskless/taskless `workers/storage/src/helpers/job-scheduler.ts`
// (MIT), with pvtch's pending-only idempotency rule (pvtch da7c9eb,
// taskless/taskless#392). `workers/core/do/helpers/job-scheduler/` is an older
// fork used by the core `User` DO; the two diverge intentionally until `User`
// moves here.

import { v7 as uuidv7 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';

import { migrate } from './migrate';
import { jobSchedulerMigrations } from './job-scheduler/migrations';

export interface ScheduledJob {
  /** The job row's id: stable across a one-shot job's retries */
  id: string;
  task: string;
  payload: unknown;
  /** True for a cron job, whose id stays the same across occurrences */
  recurring: boolean;
}

export interface JobOptions {
  /** Maximum number of retry attempts on failure (default: 3) */
  maxRetries?: number;
  /** Base delay in seconds for exponential backoff (default: 30) */
  backoffBaseSeconds?: number;
  /** Optional idempotency key. If a job with this key is currently queued (pending), scheduling is skipped. Running, completed, and dead jobs do not block, so a handler can re-schedule itself with the same key. */
  key?: string;
}

/**
 * Handler callback for processing scheduled jobs.
 * Passed to JobScheduler at construction time so the host class
 * does not need to expose a public method (which would be visible over RPC).
 */
export type ScheduledJobHandler = (job: ScheduledJob) => Promise<void>;

/** How long to retain completed/dead jobs before reaping (30 days) */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculate the next occurrence of a cron expression after a given timestamp.
 */
function getNextCronTime(cronExpression: string, afterMs: number): number {
  const expression = CronExpressionParser.parse(cronExpression, {
    currentDate: new Date(afterMs),
  });
  return expression.next().toDate().getTime();
}

/**
 * Job scheduler for Durable Objects.
 *
 * Multiplexes multiple scheduled jobs over the DO's single alarm slot
 * using a SQLite `jobs` table. Supports one-shot (Date/number) and
 * recurring (cron string) schedules with per-job retry and exponential backoff.
 *
 * Note: This is an internal helper, not exposed over RPC. If helpers like this
 * ever need to be returned from a DO method and called remotely, they must
 * extend `RpcTarget` from `cloudflare:workers`. See the Cloudflare Workers RPC
 * docs for details on when `RpcTarget` is required.
 */
export class JobScheduler {
  private sql: SqlStorage;
  private ctx: DurableObjectState;
  private handler: ScheduledJobHandler;

  constructor(
    sql: SqlStorage,
    ctx: DurableObjectState,
    handler: ScheduledJobHandler
  ) {
    this.sql = sql;
    this.ctx = ctx;
    this.handler = handler;
    migrate(sql, jobSchedulerMigrations, '_job_scheduler_version');
  }

  /**
   * Schedule a job for future execution.
   * @param when - Date (absolute time), number (seconds from now), or string (cron expression)
   * @param task - Discriminator string identifying the job type
   * @param payload - JSON-serializable data passed to the scheduled() callback
   * @param options - Retry and backoff configuration
   */
  schedule<T>(
    when: Date | number | string,
    task: string,
    payload: T,
    options?: JobOptions
  ): void {
    const now = Date.now();
    const maxRetries = options?.maxRetries ?? 3;
    const backoffBaseSeconds = options?.backoffBaseSeconds ?? 30;
    let scheduledAt: number;
    let cron: string | undefined;

    if (when instanceof Date) {
      scheduledAt = when.getTime();
    } else if (typeof when === 'number') {
      scheduledAt = now + when * 1000;
    } else {
      // Cron expression — calculate next occurrence
      cron = when;
      scheduledAt = getNextCronTime(when, now);
    }

    // Idempotency key deduplication: skip only if a job with this key is
    // already queued (pending). Running jobs do NOT block — otherwise a
    // handler that reschedules itself with the same key (the recurring-job
    // pattern) gets deduped against its own in-flight row and never re-arms.
    // Completed/dead jobs also do not block.
    if (options?.key) {
      const existing = this.sql
        .exec(
          `SELECT id FROM jobs WHERE idempotency_key = ? AND status = 'pending' LIMIT 1`,
          options.key
        )
        .toArray();
      if (existing.length > 0) return;
    }

    // Cron deduplication: skip if a job with same task+cron exists. A cron job
    // is `running` while its handler is awaited, then `pending` again, so a
    // schedule call landing mid-run must count it too; otherwise both rows
    // reschedule themselves and the task runs twice per occurrence.
    if (cron) {
      const existing = this.sql
        .exec(
          `SELECT id FROM jobs WHERE task = ? AND cron = ? AND status IN ('pending', 'running') LIMIT 1`,
          task,
          cron
        )
        .toArray();
      if (existing.length > 0) return;
    }

    const id = uuidv7();
    this.sql.exec(
      `INSERT INTO jobs (id, task, payload, scheduled_at, cron, status, attempt, max_retries, backoff_base_seconds, last_error, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?)`,
      id,
      task,
      JSON.stringify(payload),
      scheduledAt,
      // eslint-disable-next-line unicorn/no-null -- SQL requires null for absent values
      cron ?? null,
      maxRetries,
      backoffBaseSeconds,
      // eslint-disable-next-line unicorn/no-null -- SQL requires null for absent values
      options?.key ?? null,
      now
    );

    this.syncAlarm();
  }

  /**
   * Whether a one-shot job for `task` is queued or running, retries waiting
   * out their backoff included. Recurring jobs are always pending, so they
   * never count.
   */
  hasActive(task: string): boolean {
    return (
      this.sql
        .exec(
          `SELECT id FROM jobs
           WHERE task = ? AND cron IS NULL AND status IN ('pending', 'running')
           LIMIT 1`,
          task
        )
        .toArray().length > 0
    );
  }

  /**
   * Cancel queued and in-flight jobs for `task`. Pass `cron` to cancel only
   * the recurring job with that expression; omit it to cancel every job for
   * the task, one-shot and recurring. Completed and dead rows are history and
   * are left for the reaper.
   *
   * Cancelling a `running` job deletes its row, so when its handler returns,
   * the status update matches nothing: a cron job does not re-arm and a
   * failed one-shot does not retry.
   *
   * @returns the number of jobs cancelled
   */
  cancel(task: string, cron?: string): number {
    const cancelled =
      cron === undefined
        ? this.sql
            .exec(
              `DELETE FROM jobs
               WHERE task = ? AND status IN ('pending', 'running')
               RETURNING id`,
              task
            )
            .toArray()
        : this.sql
            .exec(
              `DELETE FROM jobs
               WHERE task = ? AND cron = ? AND status IN ('pending', 'running')
               RETURNING id`,
              task,
              cron
            )
            .toArray();

    this.syncAlarm();
    return cancelled.length;
  }

  /**
   * Called from the DO's alarm() handler. Processes all due jobs
   * and invokes host.scheduled() for each.
   *
   * This method never throws. Individual job failures are caught,
   * recorded via last_error on the job row, and retried with exponential backoff.
   */
  async processAlarm(): Promise<void> {
    const now = Date.now();
    const dueJobs = this.sql
      .exec(
        `SELECT id, task, payload, cron, attempt, max_retries, backoff_base_seconds
       FROM jobs
       WHERE scheduled_at <= ? AND status = 'pending'
       ORDER BY scheduled_at ASC`,
        now
      )
      .toArray();

    for (const job of dueJobs) {
      this.sql.exec(`UPDATE jobs SET status = 'running' WHERE id = ?`, job.id);

      try {
        await this.handler({
          id: job.id as string,
          task: job.task as string,
          payload: JSON.parse(job.payload as string),
          recurring: Boolean(job.cron),
        });

        // Success
        if (job.cron) {
          // Recurring: calculate next occurrence, reset attempt counter
          const nextTime = getNextCronTime(job.cron as string, now);
          this.sql.exec(
            `UPDATE jobs SET status = 'pending', scheduled_at = ?, attempt = 0 WHERE id = ?`,
            nextTime,
            job.id
          );
        } else {
          // One-shot: mark completed
          this.sql.exec(
            `UPDATE jobs SET status = 'completed' WHERE id = ?`,
            job.id
          );
        }
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
          // Retries exhausted
          if (job.cron) {
            // Cron jobs: log failure, schedule fresh next occurrence with reset attempt
            const nextTime = getNextCronTime(job.cron as string, now);
            this.sql.exec(
              `UPDATE jobs SET status = 'pending', scheduled_at = ?, attempt = 0, last_error = ? WHERE id = ?`,
              nextTime,
              errorMessage,
              job.id
            );
          } else {
            // One-shot: mark as dead
            this.sql.exec(
              `UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?`,
              errorMessage,
              job.id
            );
          }
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
  private syncAlarm(): void {
    const next = this.sql
      .exec(
        `SELECT MIN(scheduled_at) as next_at FROM jobs WHERE status = 'pending'`
      )
      .toArray();

    const nextAt = next[0]?.next_at as number | null;
    if (nextAt) {
      void this.ctx.storage.setAlarm(nextAt);
    }
  }
}
