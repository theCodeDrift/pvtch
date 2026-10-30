import { RpcTarget } from 'cloudflare:workers';

import { migrate, type Migrations } from '../../../helpers/migrate';
import { queryRows } from '../../../helpers/query-rows';

const flagsMigrations: Migrations = {
  1: (sql) => {
    // A row means the flag is on.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS flags (
        name TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      )
    `);
  },
};

/**
 * Per-channel feature flags, named `<handlerId>.<feature>`. The router copies
 * them onto every handler message; reached through `channel.flags()`.
 */
export class Flags extends RpcTarget {
  private sql: SqlStorage;

  constructor(sql: SqlStorage) {
    super();
    this.sql = sql;
    migrate(sql, flagsMigrations, '_flags_version');
  }

  /** Names of the flags that are on, sorted. */
  list(): string[] {
    return queryRows<{ name: string }>(
      this.sql,
      `SELECT name FROM flags ORDER BY name`
    ).map((row) => row.name);
  }

  set(name: string, on: boolean): string[] {
    if (on) {
      this.sql.exec(
        `INSERT INTO flags (name, updated_at) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
        name,
        Date.now()
      );
    } else {
      this.sql.exec(`DELETE FROM flags WHERE name = ?`, name);
    }
    return this.list();
  }
}
