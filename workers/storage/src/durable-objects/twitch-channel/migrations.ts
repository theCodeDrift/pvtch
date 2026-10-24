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
};
