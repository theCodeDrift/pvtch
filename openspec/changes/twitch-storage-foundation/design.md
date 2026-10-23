## Context

pvtch is a single worker today: `workers/core`, deployed as `pvtch-api`. It owns two Durable Objects, the legacy `PvtchBackend` and the plugin-based `User` (Progress, Lingo, Profile, Board), and both are bound only inside that worker. `workers/core/do/helpers/` holds a `migrate` helper and a `JobScheduler`. These were originally lifted from Taskless, and the two copies have since diverged:

|                           | pvtch (`workers/core/do/helpers`)                                 | Taskless (`workers/storage/src/helpers`)                                          |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Schedules                 | one-shot only                                                     | one-shot + cron (`cron-parser`)                                                   |
| Handler                   | host implements public `scheduled()`, which is reachable over RPC | handler callback passed to the constructor, not reachable over RPC                |
| Job identity              | not exposed                                                       | stable `id`, plus a `recurring` flag                                              |
| Idempotency key blocks on | `pending` only, so self-rescheduling works                        | any non-`dead` status, so a completed job blocks its key until it is reaped (30d) |
| SQL reads                 | inline `.toArray() as unknown as`                                 | `queryRows<T>()` helper                                                           |

The follow-up `twitch-eventsub-bot` change adds a `twitch.pvtch.com` worker that needs per-channel state. `pvtch-api` also needs that state, to show the "enable bot" settings. Taskless (`taskless/taskless`) already runs this shape: a `storage` worker hosts every DO, and the `webhooks`, `dashboard` and `generator` workers bind those DOs with `script_name`.

## Goals / Non-Goals

**Goals:**

- A deployable `workers/storage` worker that other workers can bind DOs from, with correct types and no hand-written casts.
- A `TwitchChannel` DO that holds the state the bot change needs (enablement, subscription record, dedupe, send rate), with no Twitch API calls inside it.
- A single up-to-date `JobScheduler` and `migrate` for new DOs, with cron support.
- Local development that runs storage alongside a binder.

**Non-Goals:**

- Moving or migrating `User` or `PvtchBackend`. They stay in `workers/core` and keep their copies of the helpers.
- Any Twitch HTTP calls, OAuth, EventSub handling or queues. Those belong to the follow-up change.
- A `packages/shared` workspace. Nothing needs sharing yet. The follow-up change creates it if the EventSub payload schemas need it.
- A translation cache.

## Decisions

### 1. A separate `pvtch-storage` worker, not DOs exported from `pvtch-api`

Other workers could bind DOs out of `pvtch-api` with `script_name: "pvtch-api"`. That would tie DO availability to deploys of the React Router app, and every binder would compile against `workers/core`'s whole source tree. A small storage-only worker keeps the bound surface narrow and matches Taskless.

_Alternative considered:_ move `User` into storage now. Rejected: it carries real risk (a DO class transfer across scripts) and gives the bot nothing.

### 2. Lift Taskless's `JobScheduler`, keep pvtch's idempotency rule

From Taskless we take cron support, the constructor handler callback, which removes the public `scheduled()` from the DO's RPC surface, the stable job ids, and `queryRows`.

From pvtch we keep the rule that the idempotency check counts only `pending` jobs. Taskless's `status != 'dead'` makes a completed one-shot job block its key until the 30-day reap. pvtch already found and fixed that problem (see `workers/core/do/helpers/job-scheduler/index.ts`).

Recurring work in `TwitchChannel` uses cron schedules rather than self-rescheduling. Cron deduplicates on `task + cron` over `pending|running`.

The scheduler's `jobs` table schema follows Taskless's migrations, so behavior stays aligned for future lifts.

### 3. `wrangler types` with multiple configs instead of `DurableObjectRPC<T>`

Taskless retired its `DurableObjectRPC<T>` cast. Running `wrangler types -c wrangler.jsonc -c ../storage/wrangler.jsonc` makes the binder's `Env` contain `DurableObjectNamespace<import("../storage/src/index").TwitchChannel>`, so `env.TWITCH_CHANNEL.get(id)` is already a correctly typed `DurableObjectStub<TwitchChannel>`. Each binder's tsconfig must include `../storage/src/**/*`.

pvtch's `STYLEGUIDE-CODE.md` still points at `@taskless/shared/rpc`, which pvtch does not have. That section gets rewritten as part of this change.

### 4. `TwitchChannel` exposes methods directly, no plugins

The surface is small: about 10 methods across four concerns. pvtch's `User` DO uses plugin accessors because it hosts several unrelated features. If `TwitchChannel` grows a second feature area later, we can extract `RpcTarget` plugins then, as Taskless did in `2026-03-09-rpc-target-plugins`.

### 5. Dedupe lives in DO SQLite with a time-bounded window

Twitch drops any notification whose `Twitch-Eventsub-Message-Timestamp` is more than 10 minutes old, and the handler will reject such messages too. So remembering a message id for a little longer than that, 15 minutes, is enough.

`claimMessage(id)` is a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired ... RETURNING`, and it returns whether this call wrote the row. Each claim schedules a one-shot `prune-dedupe` job under an idempotency key, so at most one is queued (this relies on the pending-only key rule). The job reschedules itself only while claims remain. A `*/15` cron registered in the constructor would wake every channel ever touched every 15 minutes, forever.

_Alternative considered:_ KV with a TTL. Rejected: KV is eventually consistent, so two queue consumers could both see "absent". The DO is single-threaded per channel, which makes the claim atomic.

### 6. The token bucket is computed on demand, not refilled by a timer

The DO stores `tokens` and `updated_at`. `acquireSendSlot()` first refills by elapsed time × rate, then either takes a token or returns `retryAfterMs`. Capacity defaults to 20 per 30 seconds (Twitch's non-mod limit); `setSendTier('moderator')` raises it to 100 per 30 seconds.

No alarms are needed. The caller in the follow-up change decides whether to wait or re-enqueue.

### 7. Migration tags start fresh in the new script

`pvtch-storage`'s `wrangler.jsonc` starts its own migration list at `v1` with `new_sqlite_classes: ["TwitchChannel"]`. `pvtch-api`'s migration list is not touched.

## Risks / Trade-offs

- [Two diverging copies of `JobScheduler` and `migrate`, in core and in storage] → This is accepted as the cost of not migrating. Comments at the top of both files point to each other. When `User` eventually moves, core's copy is deleted.
- [A binder deployed before storage fails to deploy, because `script_name` cannot be found] → Deploy storage first. Document the order in the storage README and the root README's deploy section.
- [Removing a DO class later deadlocks deploys, as in Taskless `v5`] → Copy Taskless's comment into the storage wrangler config: removing a class takes two releases (binders drop the binding first, then storage deletes the class).
- [Cross-worker type resolution makes a binder's tsconfig pull in storage sources] → Binders get only types from it (`import type`). The runtime goes through the binding, so no storage code is bundled into binders.
- [The dedupe table grows if the prune job stops firing] → The prune job retries with backoff, and every new claim queues it again if none is pending.

## Migration Plan

1. Add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, then land `deploy.yml`. Check that a pull-request dry run builds both `@pvtch/storage` and `@pvtch/core`.
2. Merge. Phase 1 deploys `pvtch-storage`, which creates the `TwitchChannel` class. Phase 2 deploys `pvtch-api` if it is affected.
3. Disconnect Workers Builds from `pvtch-api` so it isn't deployed twice.
4. No binder is added in this change, so nothing else deploys. The follow-up change adds `TWITCH_CHANNEL` bindings with `script_name: "pvtch-storage"` to the twitch worker and `pvtch-api`.
5. Rollback: delete the `pvtch-storage` script. Nothing binds it yet, so this is safe until the follow-up ships.

### 8. Deploy through GitHub Actions and turbo, not Workers Builds

Workers Builds starts a separate build for each worker whose watch paths changed, and it cannot order one worker's deploy after another's. Storage-first therefore can't be guaranteed there, so pvtch moves to a GitHub `deploy.yml` modeled on Taskless's:

- `turbo run deploy` on `main`, scoped to affected workers.
- `--dry-run` on pull requests.
- Two phases: `@pvtch/storage` first if it is affected, then every other affected worker.
- No `^deploy` task dependency, so a binder change doesn't redeploy storage.

This adds `turbo` (with a root `turbo.json`) and the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets. Workers Builds is disconnected from `pvtch-api` once the workflow is live.

### 9. Storage tests run on workerd SQLite

Tests follow Taskless's `createWorkerdSql()` pattern: Miniflare gives each test a fresh database on workerd's own SQLite. The Durable Object's SQLite limits (no foreign keys, no explicit transactions) don't reproduce in Node's SQLite, so a query that only passes locally would otherwise reach production.

## Resolved Questions

- **Deploy mechanism:** Workers Builds can't guarantee the storage-first order, so deploys move to GitHub Actions with turbo (Decision 8).
- **Storage tests:** workerd SQLite through Miniflare (Decision 9).
