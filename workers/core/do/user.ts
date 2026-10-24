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
import {
  type TwitchUserData,
  twitchDataKeyPrefix,
} from '../app/lib/twitch-data';

/**
 * User - SQLite-backed Durable Object for per-user storage.
 * Keyed by "twitch:{userId}". Thin shell over plugins.
 */
export class User extends DurableObject<Env> implements JobSchedulerHost {
  private _progress: Progress;
  private _lingo: Lingo;
  private _profile: Profile;
  private _board: Board;
  private scheduler: JobScheduler;
  // Per-instance latch: ensureProfileSync() is called from the lingo translate
  // path on every chat message. The scheduler's idempotency check still costs
  // a row read each time, so gate it behind a memory flag — we only need to
  // re-arm once per DO lifetime. Cold starts naturally re-arm.
  private profileSyncEnsured = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this._progress = new Progress(sql);
    this._lingo = new Lingo(sql);
    this._profile = new Profile(sql);
    this._board = new Board(sql);
    this.scheduler = new JobScheduler(sql, ctx);
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
      default: {
        console.warn(`Unknown scheduled task: ${job.task}`);
      }
    }
  }
}
