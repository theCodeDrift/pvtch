import { migrate, type Migrations } from '../helpers/migrate';
import { createToken } from '../../app/lib/create-token';
import {
  tokenDataKeyPrefix,
  twitchDataKeyPrefix,
  type TwitchUserData,
} from '../../app/lib/twitch-data';

/**
 * The account record's source of truth. Every core write to
 * `twitch-data-{id}` / `token-data-{token}` goes through here, inside the
 * user's Durable Object, so first login, scope grants and token rotation are
 * serialized per Twitch user. KV stays the read model for every worker.
 *
 * The DO owns the identity fields (id, login, display_name, token). Other
 * fields on the KV record (`scopes`, which pvtch-twitch also clears on
 * revoke) are carried over from the current KV record when publishing, unless
 * the write sets them.
 *
 * Atomicity: every operation runs inside `exclusive`, an in-memory queue,
 * so a whole read-decide-write-publish completes before the next one
 * starts, including its KV calls. A DO instance is the only writer for its
 * user, so the queue is enough; a restart drops in-flight requests anyway.
 */

const accountMigrations: Migrations = {
  1: (sql) => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY,
        login TEXT NOT NULL,
        display_name TEXT NOT NULL,
        token TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  },
  2: (sql) => {
    // Tokens replaced by a rotation whose `token-data-` entry may still
    // exist. Recorded with the rotation itself, removed once the delete
    // succeeds, so a failed delete is retried rather than left valid.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_revocation (
        token TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);
  },
};

export type AccountIdentity = Pick<
  TwitchUserData,
  'id' | 'login' | 'display_name'
>;

type OwnedFields = Pick<
  TwitchUserData,
  'id' | 'login' | 'display_name' | 'token'
>;

export class Account {
  private sql: SqlStorage;
  private accounts: KVNamespace;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(sql: SqlStorage, accounts: KVNamespace) {
    this.sql = sql;
    this.accounts = accounts;
    migrate(sql, accountMigrations, '_account_version');
  }

  /**
   * Get or create the account for a login. Exactly one overlay token is ever
   * minted per account: concurrent first logins all get the same one. An
   * account that so far exists only in KV is imported with its token. A
   * changed login or display name is updated.
   */
  ensure(identity: AccountIdentity): Promise<TwitchUserData> {
    return this.exclusive(async () => {
      const current = await this.readKV(identity.id);
      const before = this.read() ?? imported(current);
      const owned: OwnedFields = {
        id: identity.id,
        login: identity.login,
        display_name: identity.display_name,
        token: before?.token ?? createToken(),
      };
      this.write(owned);

      let account: TwitchUserData;
      if (current && sameOwned(current, owned)) {
        // Login always re-asserts the reverse index, as before.
        await this.putTokenIndex(owned);
        account = current;
      } else {
        account = await this.publish(owned, current);
      }
      await this.revokePending();
      return account;
    });
  }

  /** Record the granted scopes without touching anything else. */
  setScopes(userId: string, scopes: string[]): Promise<TwitchUserData> {
    return this.exclusive(async () => {
      const current = await this.readKV(userId);
      const owned = this.require(userId, current);
      const account = await this.publish(owned, current, { scopes });
      await this.revokePending();
      return account;
    });
  }

  /**
   * Replace the overlay token. The old `token-data-{old}` entry is deleted,
   * so overlay and API URLs using it stop working. Sessions are tied to the
   * token, so the caller re-issues the current session.
   *
   * The old token is recorded for revocation in the same SQLite write as the
   * new token, so if the KV delete fails (or the DO restarts first) it stays
   * pending: every later account operation and `retryRevocations` try again.
   */
  rotateToken(
    userId: string
  ): Promise<{ account: TwitchUserData; previous: string }> {
    return this.exclusive(async () => {
      const current = await this.readKV(userId);
      const before = this.require(userId, current);
      let token = createToken();
      while (token === before.token) token = createToken();
      const owned = { ...before, token };
      this.write(owned);
      this.sql.exec(
        `INSERT OR IGNORE INTO pending_revocation (token, created_at) VALUES (?, ?)`,
        before.token,
        Date.now()
      );

      const account = await this.publish(owned, current);
      await this.revokePending();
      return { account, previous: before.token };
    });
  }

  /** Retry pending revocations. True if any are still pending. */
  retryRevocations(): Promise<boolean> {
    return this.exclusive(async () => {
      await this.revokePending();
      return this.hasPendingRevocations();
    });
  }

  hasPendingRevocations(): boolean {
    return this.pendingRevocations().length > 0;
  }

  /**
   * Delete `token-data-` for every replaced token. A failure is logged and
   * left pending for the next try; it never fails the caller's operation.
   */
  private async revokePending(): Promise<void> {
    const currentToken = this.read()?.token;
    for (const token of this.pendingRevocations()) {
      if (token === currentToken) {
        this.forgetRevocation(token);
        continue;
      }
      try {
        await this.accounts.delete(`${tokenDataKeyPrefix}${token}`);
        this.forgetRevocation(token);
      } catch (error) {
        console.error('revoking a replaced overlay token failed:', error);
      }
    }
  }

  private pendingRevocations(): string[] {
    const rows = this.sql
      .exec(`SELECT token FROM pending_revocation`)
      .toArray() as unknown as { token: string }[];
    return rows.map((row) => row.token);
  }

  private forgetRevocation(token: string): void {
    this.sql.exec(`DELETE FROM pending_revocation WHERE token = ?`, token);
  }

  /** Run `task` after every earlier account operation has settled. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /** The owned record, imported from KV on first touch. */
  private require(
    userId: string,
    current: TwitchUserData | undefined
  ): OwnedFields {
    const existing = this.read();
    if (existing) return existing;
    const owned = imported(current);
    if (owned?.id !== userId) throw new Error(`no account for ${userId}`);
    this.write(owned);
    return owned;
  }

  /**
   * Write the read model: the reverse index first, so any reader that sees
   * the new token on `twitch-data-{id}` can already resolve it.
   */
  private async publish(
    owned: OwnedFields,
    current: TwitchUserData | undefined,
    changes: Partial<TwitchUserData> = {}
  ): Promise<TwitchUserData> {
    const record: TwitchUserData = { ...current, ...changes, ...owned };
    await this.putTokenIndex(owned);
    await this.accounts.put(
      `${twitchDataKeyPrefix}${owned.id}`,
      JSON.stringify(record)
    );
    return record;
  }

  private putTokenIndex(owned: OwnedFields): Promise<void> {
    return this.accounts.put(`${tokenDataKeyPrefix}${owned.token}`, owned.id);
  }

  private async readKV(userId: string): Promise<TwitchUserData | undefined> {
    const value = await this.accounts.get<TwitchUserData>(
      `${twitchDataKeyPrefix}${userId}`,
      'json'
    );
    return value ?? undefined;
  }

  private read(): OwnedFields | undefined {
    const rows = this.sql
      .exec(`SELECT id, login, display_name, token FROM account LIMIT 1`)
      .toArray() as unknown as OwnedFields[];
    return rows[0];
  }

  private write(owned: OwnedFields): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO account (id, login, display_name, token, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      owned.id,
      owned.login,
      owned.display_name,
      owned.token,
      Date.now()
    );
  }
}

/** The owned fields of a KV-only account, for the lazy import. */
function imported(record: TwitchUserData | undefined): OwnedFields | undefined {
  if (!record) return undefined;
  return {
    id: record.id,
    login: record.login,
    display_name: record.display_name,
    token: record.token,
  };
}

function sameOwned(record: TwitchUserData, owned: OwnedFields): boolean {
  return (
    record.id === owned.id &&
    record.login === owned.login &&
    record.display_name === owned.display_name &&
    record.token === owned.token
  );
}
