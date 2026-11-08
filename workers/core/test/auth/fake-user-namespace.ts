import Database from 'better-sqlite3';
import { vi } from 'vitest';
import { User } from '../../do/user';
import type { FakeKV } from './fake-kv';

// Minimal SqlStorage over better-sqlite3, as in test/do/user.test.ts.
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
    };
  };
  return { exec } as unknown as SqlStorage;
}

/**
 * A PVTCH_USER namespace backed by real `User` DOs, one per name, each with
 * its own in-memory SQLite and the given PVTCH_ACCOUNTS. Like the runtime,
 * every `get` for a name reaches the same instance.
 */
export function fakeUserNamespace(accounts: FakeKV) {
  const instances = new Map<string, User>();
  return {
    idFromName: (name: string) => name,
    get: (name: string): User => {
      let user = instances.get(name);
      if (!user) {
        const ctx = {
          id: { name },
          storage: {
            sql: createSqlStorage(new Database(':memory:')),
            setAlarm: vi.fn(),
          },
        } as unknown as DurableObjectState;
        user = new User(ctx, { PVTCH_ACCOUNTS: accounts } as unknown as Env);
        instances.set(name, user);
      }
      return user;
    },
  };
}
