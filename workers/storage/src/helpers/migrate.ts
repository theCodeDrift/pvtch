// Lifted from taskless/taskless `workers/storage/src/helpers/migrate.ts` (MIT).
// `workers/core/do/helpers/migrate.ts` is an older fork used by the core
// `User` DO.

/**
 * SQLite schema migration helper for Durable Objects
 *
 * Tracks schema version in a version table and runs
 * pending migrations sequentially.
 */

import { queryRows } from './query-rows';

export type Migrations = Record<number, (sql: SqlStorage) => void>;

/**
 * Run pending schema migrations.
 *
 * @param sql - SqlStorage instance from DO context
 * @param migrations - Record of version number to migration function
 * @param versionTable - Table name for tracking schema version (default: `_schema_version`).
 *   Use a different name when multiple independent migration sets share the same database
 *   (e.g., a helper library that manages its own tables alongside the host DO's schema).
 *
 * Guidelines for writing migrations:
 * - Additive changes (new columns): Use ALTER TABLE ADD COLUMN
 * - Breaking changes (rename/drop column, change type): Use recreate pattern:
 *   1. CREATE TABLE table_new (...)
 *   2. INSERT INTO table_new SELECT ... FROM table_old
 *   3. DROP TABLE table_old
 *   4. ALTER TABLE table_new RENAME TO table_old
 */
export function migrate(
  sql: SqlStorage,
  migrations: Migrations,
  versionTable = '_schema_version'
): void {
  const targetVersion = Math.max(...Object.keys(migrations).map(Number));
  if (targetVersion <= 0) return;

  // Get current schema version (0 if no migrations have run)
  let currentVersion = 0;
  try {
    const result = queryRows<{ version: number }>(
      sql,
      `SELECT version FROM ${versionTable} LIMIT 1`
    );
    const row = result[0];
    if (row) {
      currentVersion = row.version;
    }
  } catch {
    // Table doesn't exist yet - create it
    sql.exec(`CREATE TABLE ${versionTable} (version INTEGER NOT NULL)`);
    sql.exec(`INSERT INTO ${versionTable} (version) VALUES (0)`);
  }

  // Run pending migrations
  for (let v = currentVersion + 1; v <= targetVersion; v++) {
    const migration = migrations[v];
    if (migration) {
      migration(sql);
      sql.exec(`UPDATE ${versionTable} SET version = ?`, v);
    }
  }
}
