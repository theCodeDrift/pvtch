// Lifted from taskless/taskless `workers/storage/test/job-scheduler.test.ts`
// (MIT), with pvtch's pending-only idempotency cases.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobScheduler, JOB_RETENTION_MS } from '../src/helpers/job-scheduler';
import type { ScheduledJobHandler } from '../src/helpers/job-scheduler';

import { createWorkerdSql } from './helpers/workerd-sql';

describe('JobScheduler', () => {
  let sql: SqlStorage;
  let setAlarm: ReturnType<typeof vi.fn>;
  let handler: ReturnType<typeof vi.fn<ScheduledJobHandler>>;
  let scheduler: JobScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    sql = createWorkerdSql();
    setAlarm = vi.fn();
    handler = vi.fn<ScheduledJobHandler>(() => Promise.resolve());
    const ctx = {
      storage: { sql, setAlarm },
    } as unknown as DurableObjectState;
    scheduler = new JobScheduler(sql, ctx, handler);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getJobs() {
    return sql.exec('SELECT * FROM jobs').toArray();
  }

  describe('migrations', () => {
    it('creates the jobs table with expected schema', () => {
      const columns = sql
        .exec<{ name: string }>("PRAGMA table_info('jobs')")
        .toArray();
      const names = columns.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id',
          'task',
          'payload',
          'scheduled_at',
          'cron',
          'status',
          'attempt',
          'max_retries',
          'backoff_base_seconds',
          'last_error',
          'idempotency_key',
          'created_at',
        ])
      );
    });

    it('tracks schema version at 4', () => {
      const row = sql
        .exec<{ version: number }>('SELECT version FROM _job_scheduler_version')
        .one();
      expect(row.version).toBe(4);
    });
  });

  describe('schedule()', () => {
    it('inserts a one-shot job with Date', () => {
      const future = new Date('2026-01-15T13:00:00Z');
      scheduler.schedule(future, 'test-task', { data: 1 });

      const jobs = getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].task).toBe('test-task');
      expect(jobs[0].payload).toBe('{"data":1}');
      expect(jobs[0].scheduled_at).toBe(future.getTime());
      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].cron).toBeNull();
    });

    it('inserts a one-shot job with seconds offset', () => {
      const now = Date.now();
      scheduler.schedule(60, 'test-task', {});

      const jobs = getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].scheduled_at).toBe(now + 60_000);
    });

    it('inserts a cron job with next occurrence', () => {
      scheduler.schedule('0 */6 * * *', 'cron-task', {});

      const jobs = getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].cron).toBe('0 */6 * * *');
      expect(jobs[0].scheduled_at as number).toBeGreaterThan(Date.now());
    });

    it('skips scheduling when a pending job holds the idempotency key', () => {
      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });
      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });

      expect(getJobs()).toHaveLength(1);
    });

    it('allows scheduling when idempotency key only exists in dead state', () => {
      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });
      sql.exec("UPDATE jobs SET status = 'dead'");

      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });

      const jobs = getJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.filter((job) => job.status === 'pending')).toHaveLength(1);
    });

    it('allows scheduling when idempotency key only exists in completed state', async () => {
      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });
      await scheduler.processAlarm();
      expect(getJobs()[0].status).toBe('completed');

      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });

      const jobs = getJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.filter((job) => job.status === 'pending')).toHaveLength(1);
    });

    it('lets a running job reschedule itself under its own key', async () => {
      scheduler.schedule(0, 'self-task', {}, { key: 'self-key' });
      handler.mockImplementation(() => {
        scheduler.schedule(60, 'self-task', {}, { key: 'self-key' });
        return Promise.resolve();
      });

      await scheduler.processAlarm();

      const jobs = getJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs.filter((job) => job.status === 'completed')).toHaveLength(1);
      const pending = jobs.filter((job) => job.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].scheduled_at).toBe(Date.now() + 60_000);
    });

    it('deduplicates cron jobs with same task and expression', () => {
      scheduler.schedule('0 0 * * *', 'cron-task', {});
      scheduler.schedule('0 0 * * *', 'cron-task', {});

      expect(getJobs()).toHaveLength(1);
    });

    it('deduplicates a cron job scheduled while its occurrence is running', async () => {
      scheduler.schedule('0 0 * * *', 'cron-task', {});
      // Past the next midnight in any timezone, so the occurrence is due.
      vi.setSystemTime(new Date('2026-01-17T00:00:00Z'));
      handler.mockImplementation(() => {
        // A schedule call lands while the occurrence's handler is awaited.
        scheduler.schedule('0 0 * * *', 'cron-task', {});
        return Promise.resolve();
      });

      await scheduler.processAlarm();

      expect(handler).toHaveBeenCalledOnce();
      expect(getJobs()).toHaveLength(1);
    });

    it('sets alarm to the scheduled time', () => {
      scheduler.schedule(5, 'test-task', {});

      const alarmTime = setAlarm.mock.calls.at(-1)?.[0] as number;
      expect(alarmTime).toBe(Date.now() + 5000);
    });

    it('stores idempotency key as null when not provided', () => {
      scheduler.schedule(0, 'test-task', {});
      expect(getJobs()[0].idempotency_key).toBeNull();
    });

    it('stores idempotency key when provided', () => {
      scheduler.schedule(0, 'test-task', {}, { key: 'my-key' });
      expect(getJobs()[0].idempotency_key).toBe('my-key');
    });
  });

  describe('processAlarm()', () => {
    it('calls handler for due jobs', async () => {
      scheduler.schedule(0, 'my-task', { foo: 'bar' });

      await scheduler.processAlarm();

      expect(handler).toHaveBeenCalledWith({
        id: getJobs()[0].id,
        task: 'my-task',
        payload: { foo: 'bar' },
        recurring: false,
      });
    });

    it('marks a cron job recurring', async () => {
      scheduler.schedule('* * * * *', 'my-cron', {});
      vi.advanceTimersByTime(61_000);

      await scheduler.processAlarm();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'my-cron', recurring: true })
      );
    });

    it('marks one-shot jobs as completed on success', async () => {
      scheduler.schedule(0, 'my-task', {});

      await scheduler.processAlarm();

      expect(getJobs()[0].status).toBe('completed');
    });

    it('reschedules cron jobs for next occurrence on success', async () => {
      scheduler.schedule('0 */6 * * *', 'cron-task', {});
      const originalAt = getJobs()[0].scheduled_at as number;

      // Advance to make the job due
      vi.setSystemTime(new Date(originalAt));
      await scheduler.processAlarm();

      const job = getJobs()[0];
      expect(job.status).toBe('pending');
      expect(job.attempt).toBe(0);
      expect(job.scheduled_at as number).toBeGreaterThan(originalAt);
    });

    it('retries failed jobs with exponential backoff', async () => {
      handler.mockRejectedValue(new Error('transient failure'));
      scheduler.schedule(0, 'fail-task', {});

      await scheduler.processAlarm();

      const job = getJobs()[0];
      expect(job.status).toBe('pending');
      expect(job.attempt).toBe(1);
      // Backoff: 30 * 2^0 = 30 seconds
      expect(job.scheduled_at).toBe(Date.now() + 30_000);
      expect(job.last_error).toBe('transient failure');
    });

    it('increases backoff on subsequent retries', async () => {
      handler.mockRejectedValue(new Error('still failing'));
      scheduler.schedule(0, 'fail-task', {});

      // First failure: backoff = 30 * 2^0 = 30s
      await scheduler.processAlarm();
      expect(getJobs()[0].attempt).toBe(1);

      // Advance past retry
      vi.setSystemTime(new Date(Date.now() + 31_000));

      // Second failure: backoff = 30 * 2^1 = 60s
      await scheduler.processAlarm();
      const job = getJobs()[0];
      expect(job.attempt).toBe(2);
      expect(job.scheduled_at).toBe(Date.now() + 60_000);
    });

    it('marks one-shot jobs as dead after max retries exhausted', async () => {
      handler.mockRejectedValue(new Error('permanent failure'));
      scheduler.schedule(
        0,
        'dead-task',
        {},
        {
          maxRetries: 1,
          backoffBaseSeconds: 1,
        }
      );

      // First failure: attempt 0 → 1
      await scheduler.processAlarm();
      expect(getJobs()[0].status).toBe('pending');

      vi.setSystemTime(new Date(Date.now() + 2000));

      // Second failure: attempt 1 >= maxRetries 1 → dead
      await scheduler.processAlarm();
      expect(getJobs()[0].status).toBe('dead');
      expect(getJobs()[0].last_error).toBe('permanent failure');
    });

    it('reschedules cron jobs even after max retries exhausted', async () => {
      handler.mockRejectedValue(new Error('cron failure'));
      scheduler.schedule('0 */6 * * *', 'cron-task', {}, { maxRetries: 0 });
      const originalAt = getJobs()[0].scheduled_at as number;

      vi.setSystemTime(new Date(originalAt));
      await scheduler.processAlarm();

      const job = getJobs()[0];
      expect(job.status).toBe('pending');
      expect(job.attempt).toBe(0);
      expect(job.scheduled_at as number).toBeGreaterThan(originalAt);
    });

    it('does not process future jobs', async () => {
      scheduler.schedule(3600, 'future-task', {});

      await scheduler.processAlarm();

      expect(handler).not.toHaveBeenCalled();
      expect(getJobs()[0].status).toBe('pending');
    });

    it('reaps completed/dead jobs past retention', async () => {
      scheduler.schedule(0, 'old-task', {});
      await scheduler.processAlarm();

      // Backdate created_at past retention
      sql.exec(
        'UPDATE jobs SET created_at = ?',
        Date.now() - JOB_RETENTION_MS - 1
      );

      await scheduler.processAlarm();
      expect(getJobs()).toHaveLength(0);
    });

    it('syncs alarm to the next pending job', async () => {
      scheduler.schedule(0, 'now-task', {});
      scheduler.schedule(300, 'later-task', {});
      setAlarm.mockClear();

      await scheduler.processAlarm();

      const lastAlarm = setAlarm.mock.calls.at(-1)?.[0] as number;
      expect(lastAlarm).toBe(Date.now() + 300_000);
    });
  });

  describe('hasActive', () => {
    it('counts a pending or running one-shot, never a recurring job', () => {
      scheduler.schedule('0 */6 * * *', 'scan', {});
      expect(scheduler.hasActive('scan')).toBe(false);

      scheduler.schedule(0, 'scan', {});
      expect(scheduler.hasActive('scan')).toBe(true);
      expect(scheduler.hasActive('other')).toBe(false);

      sql.exec(`UPDATE jobs SET status = 'running' WHERE cron IS NULL`);
      expect(scheduler.hasActive('scan')).toBe(true);

      sql.exec(`UPDATE jobs SET status = 'completed' WHERE cron IS NULL`);
      expect(scheduler.hasActive('scan')).toBe(false);
    });

    it('counts a one-shot waiting out its retry backoff', async () => {
      handler.mockRejectedValueOnce(new Error('upstream said no'));
      scheduler.schedule(0, 'scan', {});

      await scheduler.processAlarm();

      const [job] = getJobs();
      expect(job).toMatchObject({ status: 'pending', attempt: 1 });
      expect(scheduler.hasActive('scan')).toBe(true);
    });
  });

  describe('cancel()', () => {
    it('cancels a pending cron job by task and expression', () => {
      scheduler.schedule('0 */6 * * *', 'reconcile', {});

      expect(scheduler.cancel('reconcile', '0 */6 * * *')).toBe(1);
      expect(getJobs()).toHaveLength(0);
    });

    it('leaves a cron job with a different expression alone', () => {
      scheduler.schedule('0 */6 * * *', 'reconcile', {});
      scheduler.schedule('0 0 * * *', 'reconcile', {});

      expect(scheduler.cancel('reconcile', '0 */6 * * *')).toBe(1);
      expect(getJobs().map((job) => job.cron)).toEqual(['0 0 * * *']);
    });

    it('cancels every queued job for a task when no cron is given', () => {
      scheduler.schedule('0 */6 * * *', 'reconcile', {});
      scheduler.schedule(60, 'reconcile', {});
      scheduler.schedule(60, 'other', {});

      expect(scheduler.cancel('reconcile')).toBe(2);
      expect(getJobs().map((job) => job.task)).toEqual(['other']);
    });

    it('keeps completed and dead history', async () => {
      scheduler.schedule(0, 'reconcile', {});
      await scheduler.processAlarm();
      scheduler.schedule(0, 'reconcile', {});
      sql.exec("UPDATE jobs SET status = 'dead' WHERE status = 'pending'");

      expect(scheduler.cancel('reconcile')).toBe(0);
      const statuses = getJobs().map((job) => job.status);
      expect(statuses).toHaveLength(2);
      expect(statuses).toEqual(expect.arrayContaining(['completed', 'dead']));
    });

    it('returns 0 when nothing matches', () => {
      expect(scheduler.cancel('nothing')).toBe(0);
    });

    it('stops a running cron job from re-arming', async () => {
      scheduler.schedule('0 0 * * *', 'reconcile', {});
      vi.setSystemTime(new Date('2026-01-17T00:00:00Z'));
      handler.mockImplementation(() => {
        scheduler.cancel('reconcile', '0 0 * * *');
        return Promise.resolve();
      });

      await scheduler.processAlarm();

      expect(handler).toHaveBeenCalledOnce();
      expect(getJobs()).toHaveLength(0);
    });

    it('stops a running one-shot from retrying after it fails', async () => {
      scheduler.schedule(0, 'reconcile', {});
      handler.mockImplementation(() => {
        scheduler.cancel('reconcile');
        return Promise.reject(new Error('gave up'));
      });

      await scheduler.processAlarm();

      expect(getJobs()).toHaveLength(0);
    });

    it('lets a cancelled cron job be scheduled again', () => {
      scheduler.schedule('0 */6 * * *', 'reconcile', {});
      scheduler.cancel('reconcile', '0 */6 * * *');

      scheduler.schedule('0 */6 * * *', 'reconcile', {});

      expect(getJobs()).toHaveLength(1);
    });
  });
});
