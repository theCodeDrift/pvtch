import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobScheduler, JOB_LEASE_MS } from '../../do/helpers/job-scheduler';

// Hand-rolled SqlStorage shim over better-sqlite3. Cloudflare's `exec()`
// doesn't distinguish reads from writes; better-sqlite3 does, so we try
// .all() and fall back to .run() if SQLite refuses to return rows.
function createSqlStorage(database: Database.Database): SqlStorage {
  const exec = (query: string, ...bindings: unknown[]) => {
    const stmt = database.prepare(query);
    let rows: Record<string, unknown>[] = [];
    try {
      rows = stmt.all(...bindings) as Record<string, unknown>[];
    } catch {
      stmt.run(...bindings);
    }
    return {
      toArray: () => rows,
      [Symbol.iterator]: () => rows[Symbol.iterator](),
      raw: () => ({ [Symbol.iterator]: () => [][Symbol.iterator]() }),
      columnNames: [],
      rowsRead: rows.length,
      rowsWritten: 0,
    };
  };
  return { exec } as unknown as SqlStorage;
}

interface JobRow {
  id: string;
  status: string;
  scheduled_at: number;
  idempotency_key: string | undefined;
}

let database: Database.Database;
let sql: SqlStorage;
let scheduler: JobScheduler;
let setAlarm: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  database = new Database(':memory:');
  sql = createSqlStorage(database);
  setAlarm = vi.fn();
  const ctx = {
    storage: { sql, setAlarm },
  } as unknown as DurableObjectState;
  scheduler = new JobScheduler(sql, ctx);
});

afterEach(() => {
  vi.useRealTimers();
  database.close();
});

function rowsByKey(key: string): JobRow[] {
  return database
    .prepare(
      `SELECT id, status, scheduled_at, idempotency_key
       FROM jobs WHERE idempotency_key = ?
       ORDER BY scheduled_at ASC`
    )
    .all(key) as JobRow[];
}

describe('JobScheduler — recurring handler re-arm (Bug 2)', () => {
  it('a handler can re-schedule itself with the same idempotency key', async () => {
    const id1 = scheduler.schedule(0, 'recurring', {}, { key: 'recurring' });
    expect(id1).toBeDefined();

    let rescheduledId: string | undefined;
    await scheduler.processAlarm({
      scheduled: () => {
        rescheduledId = scheduler.schedule(
          86400,
          'recurring',
          {},
          { key: 'recurring' }
        );
      },
    });

    // The reschedule from inside the handler must succeed — pre-fix this
    // returned undefined because the handler's own row was 'running' and
    // matched the dedupe gate.
    expect(rescheduledId).toBeDefined();

    const rows = rowsByKey('recurring');
    expect(rows).toHaveLength(2);
    const completed = rows.find((r) => r.status === 'completed');
    const pending = rows.find((r) => r.status === 'pending');
    expect(completed).toBeDefined();
    expect(pending).toBeDefined();
    // Pending row should be scheduled for ~24h later
    expect(pending?.scheduled_at).toBe(Date.now() + 86400 * 1000);
  });

  it('still dedupes a fresh schedule when a pending job already exists', () => {
    const a = scheduler.schedule(60, 't', {}, { key: 'k' });
    const b = scheduler.schedule(60, 't', {}, { key: 'k' });
    expect(a).toBeDefined();
    expect(b).toBeUndefined();
    expect(rowsByKey('k')).toHaveLength(1);
  });
});

describe('JobScheduler — retry / backoff', () => {
  it('schedules a retry with exponential backoff on handler failure', async () => {
    scheduler.schedule(0, 'flaky', { attempt: 'first' });

    let calls = 0;
    await scheduler.processAlarm({
      scheduled: () => {
        calls++;
        throw new Error('boom');
      },
    });
    expect(calls).toBe(1);

    const rows = database
      .prepare(
        `SELECT status, attempt, scheduled_at, last_error
         FROM jobs ORDER BY scheduled_at ASC`
      )
      .all() as {
      status: string;
      attempt: number;
      scheduled_at: number;
      last_error: string;
    }[];
    expect(rows).toHaveLength(1);
    const job = rows[0];
    if (!job) throw new Error('expected job row');
    expect(job.status).toBe('pending');
    expect(job.attempt).toBe(1);
    expect(job.last_error).toBe('boom');
    // Default backoff is 30s base * 2^0 = 30s on first retry.
    expect(job.scheduled_at).toBe(Date.now() + 30 * 1000);
  });

  it('marks the job dead after maxRetries is exceeded', async () => {
    scheduler.schedule(0, 'doomed', {}, { maxRetries: 1 });

    // First attempt fails → schedules retry with backoff.
    await scheduler.processAlarm({
      scheduled: () => {
        throw new Error('first fail');
      },
    });
    // Advance past the backoff so the retry becomes due.
    vi.advanceTimersByTime(60 * 1000);

    // Second attempt fails → maxRetries exhausted, marked dead.
    await scheduler.processAlarm({
      scheduled: () => {
        throw new Error('second fail');
      },
    });

    const rows = database
      .prepare(
        `SELECT status, attempt, last_error FROM jobs ORDER BY status DESC`
      )
      .all() as { status: string; attempt: number; last_error: string }[];
    expect(rows).toHaveLength(1);
    const job = rows[0];
    if (!job) throw new Error('expected job row');
    expect(job.status).toBe('dead');
    expect(job.last_error).toBe('second fail');
  });

  it('respects a custom backoffBaseSeconds', async () => {
    scheduler.schedule(0, 't', {}, { backoffBaseSeconds: 5 });
    await scheduler.processAlarm({
      scheduled: () => {
        throw new Error('x');
      },
    });
    const job = database
      .prepare(`SELECT scheduled_at FROM jobs LIMIT 1`)
      .all() as { scheduled_at: number }[];
    const row = job[0];
    if (!row) throw new Error('expected row');
    // 5 * 2^0 = 5 seconds for first retry.
    expect(row.scheduled_at).toBe(Date.now() + 5 * 1000);
  });

  it('marks completed jobs that succeeded; reaps old completed rows', async () => {
    scheduler.schedule(0, 'ok', {});
    await scheduler.processAlarm({
      scheduled: () => Promise.resolve(),
    });

    const before = database.prepare(`SELECT status FROM jobs`).all() as {
      status: string;
    }[];
    expect(before).toHaveLength(1);
    expect(before[0]?.status).toBe('completed');

    // Advance past 30-day retention; next alarm should reap it.
    vi.setSystemTime(new Date('2026-04-01T00:00:00Z'));
    scheduler.schedule(0, 'next', {});
    await scheduler.processAlarm({ scheduled: () => Promise.resolve() });

    const after = database
      .prepare(`SELECT task FROM jobs ORDER BY task ASC`)
      .all() as { task: string }[];
    // The original 'ok' job is gone; only 'next' (also completed) remains.
    expect(after.map((r) => r.task)).toEqual(['next']);
  });

  it('schedules and fires due jobs in scheduled_at order', async () => {
    scheduler.schedule(60, 'second', {});
    scheduler.schedule(30, 'first', {});

    // Advance past both delays.
    vi.advanceTimersByTime(120 * 1000);

    const seen: string[] = [];
    await scheduler.processAlarm({
      scheduled: (job) => {
        seen.push(job.task);
      },
    });
    expect(seen).toEqual(['first', 'second']);
  });

  it('setAlarm is called with the earliest pending job time', () => {
    scheduler.schedule(120, 'later', {});
    scheduler.schedule(30, 'sooner', {});
    // Both schedule() calls invoke syncAlarm; the latest call wins. The
    // earliest pending job's scheduled_at should be what's set.
    const lastCall = setAlarm.mock.calls.at(-1);
    if (!lastCall) throw new Error('expected setAlarm call');
    expect(lastCall[0]).toBe(Date.now() + 30 * 1000);
  });
});

describe('JobScheduler — reaper index (Bug 3)', () => {
  it('idx_jobs_reaper exists with the expected partial predicate', () => {
    const indexes = database
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_jobs_reaper'`
      )
      .all() as { name: string; sql: string }[];
    expect(indexes).toHaveLength(1);
    const indexSql = indexes[0]?.sql ?? '';
    expect(indexSql).toContain('created_at');
    expect(indexSql).toContain("status IN ('completed', 'dead')");
  });

  it('reaper DELETE uses the partial index (EXPLAIN QUERY PLAN)', () => {
    // Seed a few rows so SQLite has something to plan over.
    scheduler.schedule(60, 't', {});
    const cutoff = Date.now();
    const plan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         DELETE FROM jobs
         WHERE status IN ('completed', 'dead') AND created_at < ?`
      )
      .all(cutoff) as { detail: string }[];
    const detail = plan.map((p) => p.detail).join(' | ');
    expect(detail).toMatch(/idx_jobs_reaper/);
  });
});

interface JobState {
  task: string;
  status: string;
  attempt: number;
  scheduled_at: number;
  last_error: string | null;
}

function allJobs(): JobState[] {
  return database
    .prepare(
      `SELECT task, status, attempt, scheduled_at, last_error FROM jobs ORDER BY created_at, id`
    )
    .all() as JobState[];
}

describe('JobScheduler — idempotency key collision on retry', () => {
  it('lets a newer pending job supersede a failing retry with the same key', async () => {
    scheduler.schedule(
      new Date(Date.now() - 1000),
      'sync-profile',
      {},
      { key: 'sync-profile' }
    );
    scheduler.schedule(0, 'other', {});
    const ran: string[] = [];

    await expect(
      scheduler.processAlarm({
        scheduled: (job) => {
          ran.push(job.task);
          if (job.task !== 'sync-profile') return;
          // A schedule() with the same key lands while the job awaits I/O.
          scheduler.schedule(0, 'sync-profile', {}, { key: 'sync-profile' });
          throw new Error('kv down');
        },
      })
    ).resolves.toBeUndefined();

    expect(ran).toEqual(['sync-profile', 'other']);
    const rows = allJobs().filter((job) => job.task === 'sync-profile');
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'dead', last_error: 'kv down' }),
        expect.objectContaining({ status: 'pending', attempt: 0 }),
      ])
    );
    expect(allJobs().some((job) => job.status === 'running')).toBe(false);
  });
});

describe('JobScheduler — expired leases', () => {
  const noop = { scheduled: () => {} };

  it('tracks schema version at 6 with a started_at column', () => {
    const row = database
      .prepare('SELECT version FROM _job_scheduler_version')
      .get() as { version: number };
    expect(row.version).toBe(6);
    const columns = database.prepare("PRAGMA table_info('jobs')").all() as {
      name: string;
    }[];
    expect(columns.map((c) => c.name)).toContain('started_at');
  });

  it('retries a job left running past the lease', async () => {
    scheduler.schedule(0, 'sync-profile', {}, { key: 'sync-profile' });
    database
      .prepare(`UPDATE jobs SET status = 'running', started_at = ?`)
      .run(Date.now());
    vi.setSystemTime(new Date(Date.now() + JOB_LEASE_MS));

    await scheduler.processAlarm(noop);

    expect(allJobs()[0]).toMatchObject({
      status: 'pending',
      attempt: 1,
      scheduled_at: Date.now() + 30_000,
      last_error: 'lease expired while running',
    });
  });

  it('leaves a job alone while its lease is live', async () => {
    scheduler.schedule(0, 'sync-profile', {});
    database
      .prepare(`UPDATE jobs SET status = 'running', started_at = ?`)
      .run(Date.now());
    vi.setSystemTime(new Date(Date.now() + JOB_LEASE_MS - 1));

    await scheduler.processAlarm(noop);

    expect(allJobs()[0]?.status).toBe('running');
  });

  it('arms the alarm for the lease expiry of a running job', () => {
    scheduler.schedule(0, 'sync-profile', {});
    const startedAt = Date.now();
    void scheduler.processAlarm({ scheduled: () => new Promise(() => {}) });
    setAlarm.mockClear();

    // Any later sync (here a schedule far in the future) keeps the lease covered.
    scheduler.schedule(86400, 'later', {});

    expect(setAlarm).toHaveBeenLastCalledWith(startedAt + JOB_LEASE_MS);
  });
});
