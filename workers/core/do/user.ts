import { DurableObject } from 'cloudflare:workers';
import {
  JobScheduler,
  type ScheduledJob,
  type JobSchedulerHost,
} from './helpers/job-scheduler';
import { Progress } from './plugins/progress';
import { Lingo } from './plugins/lingo';
import { Profile } from './plugins/profile';
import { Board } from './plugins/board';
import { Account, type AccountIdentity } from './plugins/account';
import {
  type TwitchUserData,
  twitchDataKeyPrefix,
} from '../app/lib/account-record';

/** How long the deletion job waits for the channel's EventSub cleanup. */
const PURGE_RECHECK_SECONDS = 60;
/** How long the deletion job waits after a failed step. */
const DELETE_RETRY_SECONDS = 300;

/**
 * User - SQLite-backed Durable Object for per-user storage.
 * Keyed by "twitch:{userId}". Thin shell over plugins.
 */
export class User extends DurableObject<Env> implements JobSchedulerHost {
  private _progress!: Progress;
  private _lingo!: Lingo;
  private _profile!: Profile;
  private _board!: Board;
  private _account!: Account;
  private scheduler!: JobScheduler;
  // Per-instance latch: ensureProfileSync() is called from the lingo translate
  // path on every chat message. The scheduler's idempotency check still costs
  // a row read each time, so gate it behind a memory flag — we only need to
  // re-arm once per DO lifetime. Cold starts naturally re-arm.
  private profileSyncEnsured = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initPlugins();
  }

  /**
   * Construct every plugin, which runs its migrations. Called again after
   * account deletion wipes storage, so this instance keeps working on
   * empty tables instead of missing ones.
   */
  private initPlugins(): void {
    const sql = this.ctx.storage.sql;
    this._progress = new Progress(sql);
    this._lingo = new Lingo(sql);
    this._profile = new Profile(sql);
    this._board = new Board(sql);
    this._account = new Account(sql, this.env.PVTCH_ACCOUNTS);
    this.scheduler = new JobScheduler(sql, this.ctx);
    this.profileSyncEnsured = false;
  }

  progress(): Progress {
    return this._progress;
  }

  lingo(): Lingo {
    return this._lingo;
  }

  profile(): Profile {
    return this._profile;
  }

  board(): Board {
    return this._board;
  }

  /**
   * The account's single writer: first login, scope grants and token
   * rotation all go through these, never straight to KV. See Account.
   */
  ensureAccount(identity: AccountIdentity): Promise<TwitchUserData> {
    return this._account.ensure(identity);
  }

  setAccountScopes(userId: string, scopes: string[]): Promise<TwitchUserData> {
    return this._account.setScopes(userId, scopes);
  }

  /** Forget the account's scopes (Twitch revoke). Called by pvtch-twitch. */
  clearAccountScopes(userId: string): Promise<TwitchUserData | undefined> {
    return this._account.clearScopes(userId);
  }

  async rotateAccountToken(
    userId: string
  ): Promise<{ account: TwitchUserData; previous: string }> {
    const result = await this._account.rotateToken(userId);
    this.scheduleRevocationRetry();
    return result;
  }

  /** Sign out everywhere. The caller re-issues its own session after. */
  endAccountSessions(userId: string): Promise<TwitchUserData> {
    return this._account.endSessions(userId);
  }

  /**
   * Delete the account and everything stored for it. Legacy Lingo config
   * in PvtchBackend is cleared by the caller first: pvtch-twitch also
   * type-checks this class, and its Env has no PVTCH_BACKEND. Marks the account as
   * being deleted, which stops every account write, and schedules the
   * `delete-account` job. A repeat call while deletion runs does nothing.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this._account.beginDeletion(userId);
    this.scheduler.schedule(0, 'delete-account', {}, { key: 'delete-account' });
  }

  isDeletingAccount(): boolean {
    return this._account.isDeleting();
  }

  hasPendingAccountRevocations(): boolean {
    return this._account.hasPendingRevocations();
  }

  /** If an old token's KV delete failed, retry it on the alarm. */
  private scheduleRevocationRetry(delaySeconds = 60): void {
    if (!this._account.hasPendingRevocations()) return;
    this.scheduler.schedule(
      delaySeconds,
      'revoke-tokens',
      {},
      { key: 'revoke-tokens' }
    );
  }

  async alarm(): Promise<void> {
    await this.scheduler.processAlarm(this);
  }

  /** Schedule the daily profile sync if not already scheduled. */
  ensureProfileSync(): void {
    if (this.profileSyncEnsured) return;
    this.profileSyncEnsured = true;
    this.scheduler.schedule(0, 'sync-profile', {}, { key: 'sync-profile' });
  }

  async scheduled(job: ScheduledJob): Promise<void> {
    switch (job.task) {
      case 'sync-profile': {
        const userId = this.ctx.id.name?.replace('twitch:', '');
        if (!userId) break;
        const userData = await this.env.PVTCH_ACCOUNTS.get<TwitchUserData>(
          `${twitchDataKeyPrefix}${userId}`,
          'json'
        );
        if (userData?.display_name) {
          this._profile.setTwitchName(userData.display_name);
        }
        // Reschedule for tomorrow (86400 seconds)
        this.scheduler.schedule(
          86400,
          'sync-profile',
          {},
          {
            key: 'sync-profile',
          }
        );
        break;
      }
      case 'delete-account': {
        await this.runAccountDeletion();
        break;
      }
      case 'revoke-tokens': {
        if (await this._account.retryRevocations()) {
          this.scheduleRevocationRetry(300);
        }
        break;
      }
      default: {
        console.warn(`Unknown scheduled task: ${job.task}`);
      }
    }
  }

  /**
   * One attempt at deleting the account. Every step is idempotent, so each
   * attempt starts from the top. Waiting on the channel's EventSub cleanup
   * or a failed step reschedules the job; it never gives up, because the
   * account is unusable until it finishes.
   */
  private async runAccountDeletion(): Promise<void> {
    const targets = this._account.deletionTargets();
    if (!targets) return;
    try {
      const channel = this.env.TWITCH_CHANNEL.get(
        this.env.TWITCH_CHANNEL.idFromName(`twitch:${targets.userId}`)
      );
      const { done } = await channel.purge();
      if (!done) {
        this.scheduleDeletion(PURGE_RECHECK_SECONDS);
        return;
      }

      await this._account.deleteReadModel();
    } catch (error) {
      // No user data in the log: only that a step failed and why.
      console.error(
        'account deletion step failed:',
        error instanceof Error ? error.message : String(error)
      );
      this.scheduleDeletion(DELETE_RETRY_SECONDS);
      return;
    }

    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.initPlugins();
  }

  private scheduleDeletion(delaySeconds: number): void {
    this.scheduler.schedule(
      delaySeconds,
      'delete-account',
      {},
      { key: 'delete-account' }
    );
  }
}
