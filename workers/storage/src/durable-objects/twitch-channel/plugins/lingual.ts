import { RpcTarget } from 'cloudflare:workers';

import { migrate, type Migrations } from '../../../helpers/migrate';
import { queryRows } from '../../../helpers/query-rows';

/** The translate command a channel starts with. */
export const DEFAULT_TRANSLATE_COMMAND = '!tr';

export interface LingualSettings {
  /** Target language as entered (name or ISO code); null until set. */
  language: string | null;
  /** The chat command that translates on request, `!` included, lowercase. */
  command: string;
  /** Whether chat can use `command`. */
  commandEnabled: boolean;
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
  2: (sql) => {
    sql.exec(
      `ALTER TABLE lingual_config ADD COLUMN command TEXT NOT NULL DEFAULT '${DEFAULT_TRANSLATE_COMMAND}'`
    );
    sql.exec(
      `ALTER TABLE lingual_config ADD COLUMN command_enabled INTEGER NOT NULL DEFAULT 1`
    );
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
    const row = queryRows<{
      language: string | null;
      command: string;
      command_enabled: number;
    }>(
      this.sql,
      `SELECT language, command, command_enabled FROM lingual_config`
    )[0];
    return {
      // eslint-disable-next-line unicorn/no-null -- RPC-serializable absent value
      language: row?.language ?? null,
      command: row?.command ?? DEFAULT_TRANSLATE_COMMAND,
      commandEnabled: row ? row.command_enabled === 1 : true,
    };
  }

  /**
   * Update the given settings and keep the rest. The caller validates them.
   * Partial, so a caller that predates a setting can't reset it.
   */
  setSettings(update: Partial<LingualSettings>): LingualSettings {
    const next = { ...this.getSettings(), ...update };
    // eslint-disable-next-line unicorn/no-null -- SQL NULL clears the language
    const language = next.language?.trim().toLowerCase() || null;
    const command =
      next.command.trim().toLowerCase() || DEFAULT_TRANSLATE_COMMAND;
    this.sql.exec(
      `INSERT INTO lingual_config
         (id, language, command, command_enabled, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         language = excluded.language,
         command = excluded.command,
         command_enabled = excluded.command_enabled,
         updated_at = excluded.updated_at`,
      language,
      command,
      next.commandEnabled ? 1 : 0,
      Date.now()
    );
    return this.getSettings();
  }
}
