// Lifted from taskless/taskless `workers/storage/src/helpers/query-rows.ts` (MIT).

/**
 * Typed wrapper around SqlStorage.exec().toArray().
 *
 * SQLite's toArray() returns `Record<string, SqlStorageValue>[]` which
 * doesn't carry column-level type information. Every call site was using
 * `as unknown as T[]` to bridge this gap. This helper centralizes that
 * single assertion so callers get typed rows without double-casts.
 */
export function queryRows<T>(
  sql: SqlStorage,
  query: string,
  ...parameters: unknown[]
): T[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- single centralized cast from untyped SqlStorageValue rows
  return sql.exec(query, ...parameters).toArray() as any;
}
