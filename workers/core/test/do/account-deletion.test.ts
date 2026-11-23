import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../../do/user';
import { signedIn } from '../auth/fake-kv';

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

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
  scopes: ['channel:bot'],
};
const IDENTITY = {
  id: USER.id,
  login: USER.login,
  display_name: USER.display_name,
};

let database: Database.Database;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
  database = new Database(':memory:');
});

afterEach(() => {
  vi.useRealTimers();
  database.close();
});

function tables(): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  )
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));
}

/** A `User` DO whose channel purge answers from `purgeResults` in turn. */
function setup(purgeResults: boolean[] = [true]) {
  const accounts = signedIn(USER, 's-1');
  const purge = vi.fn(() =>
    Promise.resolve({ done: purgeResults.shift() ?? true })
  );
  const deleteAll = vi.fn(() => {
    for (const name of tables()) database.exec(`DROP TABLE "${name}"`);
    return Promise.resolve();
  });
  const ctx = {
    id: { name: `twitch:${USER.id}` },
    storage: {
      sql: createSqlStorage(database),
      setAlarm: vi.fn(),
      deleteAlarm: vi.fn(() => Promise.resolve()),
      deleteAll,
    },
  } as unknown as DurableObjectState;
  const env = {
    PVTCH_ACCOUNTS: accounts,
    TWITCH_CHANNEL: {
      idFromName: (name: string) => name,
      get: () => ({ purge }),
    },
  } as unknown as Env;
  return { user: new User(ctx, env), accounts, purge, deleteAll };
}

function rowCount(table: string): number {
  return (
    database.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as {
      c: number;
    }
  ).c;
}

/** Run the alarm once `seconds` have passed. */
async function runAlarm(user: User, seconds = 0) {
  vi.advanceTimersByTime(seconds * 1000);
  await user.alarm();
}

describe('User.deleteAccount', () => {
  it('deletes the account, its KV records and the DO storage', async () => {
    const { user, accounts, purge, deleteAll } = setup();
    user.progress().set('subs', 5);

    await user.deleteAccount(USER.id);
    await runAlarm(user);

    expect(purge).toHaveBeenCalledOnce();
    expect(accounts.store.has('twitch-data-u-1')).toBe(false);
    expect(accounts.store.has('token-data-tok-1')).toBe(false);
    expect(deleteAll).toHaveBeenCalledOnce();
    expect(rowCount('account')).toBe(0);
    expect(user.progress().get('subs')).toBeUndefined();
    expect(user.isDeletingAccount()).toBe(false);
  });

  it('waits for the channel purge before deleting anything else', async () => {
    const { user, accounts, purge } = setup([false, true]);

    await user.deleteAccount(USER.id);
    await runAlarm(user);
    expect(accounts.store.has('twitch-data-u-1')).toBe(true);
    expect(user.isDeletingAccount()).toBe(true);

    await runAlarm(user, 60);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(accounts.store.has('twitch-data-u-1')).toBe(false);
  });

  it('retries from the top after a failed step', async () => {
    const { user, accounts, purge } = setup();
    const realDelete = accounts.delete.bind(accounts);
    vi.spyOn(accounts, 'delete')
      .mockRejectedValueOnce(new Error('kv down'))
      .mockImplementation(realDelete);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await user.deleteAccount(USER.id);
    await runAlarm(user);
    expect(accounts.store.has('twitch-data-u-1')).toBe(true);

    await runAlarm(user, 300);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(accounts.store.has('twitch-data-u-1')).toBe(false);
    expect(accounts.store.has('token-data-tok-1')).toBe(false);
  });

  it('removes tokens left from an earlier rotation', async () => {
    const { user, accounts } = setup();
    const realDelete = accounts.delete.bind(accounts);
    // The rotation's revocation of tok-1 fails, so it stays pending.
    vi.spyOn(accounts, 'delete')
      .mockRejectedValueOnce(new Error('kv down'))
      .mockImplementation(realDelete);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { account } = await user.rotateAccountToken(USER.id);
    expect(accounts.store.get('token-data-tok-1')).toBe(USER.id);

    await user.deleteAccount(USER.id);
    await runAlarm(user);

    expect(accounts.keys('token-data-')).toEqual([]);
    expect(accounts.store.has(`token-data-${account.token}`)).toBe(false);
  });

  it('schedules one job for repeat calls', async () => {
    const { user } = setup();
    await user.deleteAccount(USER.id);
    await user.deleteAccount(USER.id);

    const pending = database
      .prepare(
        `SELECT COUNT(*) AS c FROM jobs WHERE task = 'delete-account' AND status = 'pending'`
      )
      .get() as { c: number };
    expect(pending.c).toBe(1);
  });

  it('refuses account writes while deleting', async () => {
    const { user } = setup([false]);
    await user.deleteAccount(USER.id);

    await expect(user.ensureAccount(IDENTITY)).rejects.toThrow(
      'account deletion in progress'
    );
    await expect(user.setAccountScopes(USER.id, [])).rejects.toThrow(
      'account deletion in progress'
    );
    await expect(user.rotateAccountToken(USER.id)).rejects.toThrow(
      'account deletion in progress'
    );
    await expect(user.endAccountSessions(USER.id)).rejects.toThrow(
      'account deletion in progress'
    );
    // A late Twitch revoke is a no-op, so its queue message doesn't retry.
    expect(await user.clearAccountScopes(USER.id)).toBeUndefined();
  });

  it('deletes an account that so far exists only in KV', async () => {
    const { user, accounts } = setup();

    await user.deleteAccount(USER.id);
    await runAlarm(user);

    expect(accounts.store.has('token-data-tok-1')).toBe(false);
    expect(accounts.store.has('twitch-data-u-1')).toBe(false);
  });

  it('starts a fresh account when the user signs in afterwards', async () => {
    const { user, accounts } = setup();
    user.progress().set('subs', 5);
    await user.deleteAccount(USER.id);
    await runAlarm(user);

    const account = await user.ensureAccount(IDENTITY);

    expect(account.token).not.toBe(USER.token);
    expect(account.scopes).toBeUndefined();
    expect(accounts.store.get(`token-data-${account.token}`)).toBe(USER.id);
    expect(user.progress().get('subs')).toBeUndefined();
  });
});
