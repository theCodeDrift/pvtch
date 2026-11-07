import type { Migrations } from '../migrate';

export const jobSchedulerMigrations: Migrations = {
  1: (sql) => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        scheduled_at INTEGER NOT NULL,
        cron TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        backoff_base_seconds INTEGER NOT NULL DEFAULT 30,
        last_error TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_jobs_pending
       ON jobs(scheduled_at) WHERE status = 'pending'`
    );
  },
  2: (sql) => {
    sql.exec(`ALTER TABLE jobs ADD COLUMN idempotency_key TEXT`);
    sql.exec(
      `CREATE UNIQUE INDEX idx_jobs_idempotency
       ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND status NOT IN ('dead')`
    );
  },
  // Recurring jobs ("from inside the handler, schedule the next run with
  // the same key") were broken by v2's unique index: it treats `completed`
  // rows as active, so the second run fails with a uniqueness violation.
  // Tighten the partial index to only enforce uniqueness for jobs that are
  // actually queued (pending) or currently executing (running).
  3: (sql) => {
    sql.exec(`DROP INDEX IF EXISTS idx_jobs_idempotency`);
    sql.exec(
      `CREATE UNIQUE INDEX idx_jobs_idempotency
       ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'running')`
    );
  },
  // v3 still broke the recurring-handler case: while a handler is executing
  // its own row is `running`, so an in-handler reschedule with the same key
  // hit the unique index and failed. Narrow the partial index to `pending`
  // only — the matching dedupe SELECT in JobScheduler.schedule() now also
  // checks `status = 'pending'`, so a running job no longer blocks its own
  // successor from being queued.
  4: (sql) => {
    sql.exec(`DROP INDEX IF EXISTS idx_jobs_idempotency`);
    sql.exec(
      `CREATE UNIQUE INDEX idx_jobs_idempotency
       ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL AND status = 'pending'`
    );
  },
  // The reaper at processAlarm() runs DELETE FROM jobs WHERE status IN
  // ('completed', 'dead') AND created_at < ? on every alarm. Without a
  // covering index this scans the full jobs table, and rows_read scales
  // with the cumulative job count over the retention window. Add a partial
  // index over the reapable rows so the DELETE only visits expired rows.
  5: (sql) => {
    sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_jobs_reaper
       ON jobs(created_at) WHERE status IN ('completed', 'dead')`
    );
  },
  // Record when a job started running, so processAlarm() can recover a row
  // left `running` by an eviction or deploy mid-handler. Rows already running
  // get the migration time, so they are recovered one lease from now.
  6: (sql) => {
    sql.exec(`ALTER TABLE jobs ADD COLUMN started_at INTEGER`);
    sql.exec(
      `UPDATE jobs SET started_at = ? WHERE status = 'running'`,
      Date.now()
    );
  },
};
