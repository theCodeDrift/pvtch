import { RpcTarget } from 'cloudflare:workers';

import { migrate, type Migrations } from '../../../helpers/migrate';
import { queryRows } from '../../../helpers/query-rows';

export interface LingualSettings {
  /** Target language as entered (name or ISO code); null until set. */
  language: string | null;
}

const lingualMigrations: Migrations = {
  1: (sql) => {
    // Single-row table: `id = 1` gives upserts a stable conflict target.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS lingual_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        language TEXT,
        ignored_chatters TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )
    `);
  },
};

/**
 * Lingual's per-channel state in `TwitchChannel`. Reached through
 * `channel.lingual()`; deliberately separate from core's Lingo config.
 */
export class Lingual extends RpcTarget {
  private sql: SqlStorage;

  constructor(sql: SqlStorage) {
    super();
    this.sql = sql;
    migrate(sql, lingualMigrations, '_lingual_version');
  }

  getSettings(): LingualSettings {
    const row = queryRows<{ language: string | null }>(
      this.sql,
      `SELECT language FROM lingual_config`
    )[0];
    return {
      // eslint-disable-next-line unicorn/no-null -- RPC-serializable absent value
      language: row?.language ?? null,
    };
  }

  /** Replace the settings. The caller validates the language. */
  setSettings(settings: LingualSettings): LingualSettings {
    // eslint-disable-next-line unicorn/no-null -- SQL NULL clears the language
    const language = settings.language?.trim().toLowerCase() || null;
    this.sql.exec(
      `INSERT INTO lingual_config (id, language, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         language = excluded.language,
         updated_at = excluded.updated_at`,
      language,
      Date.now()
    );
    return this.getSettings();
  }
}
