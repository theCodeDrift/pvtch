/* eslint-disable unicorn/no-null -- KV returns null for a missing key */

/** An in-memory PVTCH_ACCOUNTS that records each put's options. */
export class FakeKV {
  store = new Map<string, string>();
  putOptions = new Map<string, unknown>();

  get(key: string, type?: 'json') {
    const value = this.store.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(type === 'json' ? JSON.parse(value) : value);
  }

  put(key: string, value: string, options?: unknown) {
    this.store.set(key, value);
    this.putOptions.set(key, options);
    return Promise.resolve();
  }

  delete(key: string) {
    this.store.delete(key);
    return Promise.resolve();
  }

  /** Keys starting with `prefix`. */
  keys(prefix: string): string[] {
    return [...this.store.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** A KV holding a signed-in user: `session-{sessionToken}` and their record. */
export function signedIn(
  user: { id: string; token: string },
  sessionToken = 's-1'
): FakeKV {
  const accounts = new FakeKV();
  accounts.store.set(`token-data-${user.token}`, user.id);
  accounts.store.set(`twitch-data-${user.id}`, JSON.stringify(user));
  accounts.store.set(
    `session-${sessionToken}`,
    JSON.stringify({ userId: user.id, token: user.token })
  );
  return accounts;
}
