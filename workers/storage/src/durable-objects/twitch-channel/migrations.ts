import type { Migrations } from '../../helpers/migrate';

export const twitchChannelMigrations: Migrations = {
  1: (sql) => {
    // Single-row tables use `id = 1` so upserts have a stable conflict target.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS bot_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        enabled_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        type TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS message_claims (
        message_id TEXT PRIMARY KEY,
        claimed_at INTEGER NOT NULL
      )
    `);
    sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_message_claims_claimed_at
       ON message_claims(claimed_at)`
    );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS send_bucket (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tier TEXT NOT NULL,
        tokens REAL NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  },
  2: (sql) => {
    // Lingual's own settings. Deliberately separate from core's Lingo config.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS lingual_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        language TEXT,
        ignored_chatters TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )
    `);
  },
  3: (sql) => {
    // Handlers and senders replace the single bot. Old state is dropped,
    // not migrated: Lingual is re-enabled after deploy. Lingual's settings
    // now live in its plugin (`lingual_config`, see plugins/lingual.ts).
    sql.exec(`DROP TABLE IF EXISTS bot_state`);
    sql.exec(`DROP TABLE IF EXISTS subscriptions`);
    sql.exec(`DROP TABLE IF EXISTS send_bucket`);
    sql.exec(`DROP TABLE IF EXISTS lingual_settings`);
    // Pending jobs of the old single-bot tasks would run against the new
    // schema; prune-dedupe is unchanged and stays. The scheduler creates
    // `jobs` after this migration runs, so a new channel has none yet.
    const hasJobs = sql
      .exec(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs'`
      )
      .toArray().length;
    if (hasJobs) {
      sql.exec(
        `DELETE FROM jobs WHERE task IN
           ('request-subscribe', 'request-unsubscribe', 'reconcile-subscription')`
      );
    }
    sql.exec(`
      CREATE TABLE IF NOT EXISTS handlers (
        handler_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        enabled_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        sender_id TEXT NOT NULL,
        type TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (sender_id, type)
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS send_buckets (
        sender_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        tokens REAL NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  },
};
