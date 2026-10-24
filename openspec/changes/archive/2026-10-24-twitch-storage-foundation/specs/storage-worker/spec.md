## ADDED Requirements

### Requirement: Standalone storage worker hosts cross-worker Durable Objects

The system SHALL provide a Cloudflare worker at `workers/storage` (package `@pvtch/storage`, script name `pvtch-storage`) whose purpose is hosting Durable Object classes that other workers bind via `script_name: "pvtch-storage"`. Its `fetch` handler SHALL return HTTP 404 for every request; it SHALL expose no public routes. Its wrangler migrations SHALL be independent of `pvtch-api`'s.

#### Scenario: Storage worker exports DO classes

- **WHEN** `workers/storage/src/index.ts` is loaded
- **THEN** it exports the `TwitchChannel` class and a default handler

#### Scenario: Direct HTTP request to storage worker

- **WHEN** any HTTP request reaches the `pvtch-storage` worker
- **THEN** it responds with HTTP 404

#### Scenario: Initial migration tag

- **WHEN** `workers/storage/wrangler.jsonc` is deployed for the first time
- **THEN** its migrations include `{ "tag": "v1", "new_sqlite_classes": ["TwitchChannel"] }` and `pvtch-api`'s migrations are unchanged

### Requirement: Existing Durable Objects are not migrated

The `User` and `PvtchBackend` Durable Objects SHALL remain defined and bound in `workers/core` with their existing behavior and helpers. This change SHALL NOT add `deleted_classes`, `transferred_classes`, or binding changes for them.

#### Scenario: Core DOs untouched

- **WHEN** this change is deployed
- **THEN** `workers/core/wrangler.jsonc` durable object bindings and migrations are identical to before

### Requirement: Versioned SQLite migration helper

The storage worker SHALL provide `migrate(sql, migrations, versionTable)` in `src/helpers/migrate.ts` that records the applied version in `versionTable` and applies only migrations whose index is greater than the recorded version, in order. Reads SHALL use a `queryRows<T>(sql, query, ...bindings)` helper from `src/helpers/query-rows.ts`. Migrations SHALL be written to be safe to partially re-run (`IF NOT EXISTS`).

#### Scenario: First run applies all migrations

- **WHEN** `migrate()` runs against an empty database with 2 migrations
- **THEN** both migrations are applied and the version table records 2

#### Scenario: Re-run is a no-op

- **WHEN** `migrate()` runs again with the same 2 migrations
- **THEN** no migration is re-applied

#### Scenario: New migration appended

- **WHEN** `migrate()` runs with 3 migrations against a database at version 2
- **THEN** only the third migration is applied and the version becomes 3

### Requirement: JobScheduler with cron, handler callback, and backoff

The storage worker SHALL provide a `JobScheduler` in `src/helpers/job-scheduler.ts` constructed as `new JobScheduler(sql, ctx, handler)`, where `handler: (job: ScheduledJob) => Promise<void>` is supplied at construction so the host DO need not expose a public scheduling method over RPC. It SHALL multiplex jobs over the DO's single alarm using a SQLite `jobs` table. `schedule(when, task, payload, options)` SHALL accept a `Date` (absolute), `number` (seconds from now), or `string` (cron expression). `ScheduledJob` SHALL include `id`, `task`, `payload`, and `recurring`. Failed jobs SHALL retry with exponential backoff (`backoffBaseSeconds * 2^attempt`, default base 30s, default `maxRetries` 3); one-shot jobs exceeding retries SHALL be marked `dead` with `last_error`. Completed and dead one-shot jobs SHALL be reaped after 30 days.

#### Scenario: Schedule a cron job

- **WHEN** `schedule('*/15 * * * *', 'prune-dedupe', {})` is called
- **THEN** a job is stored with `cron` set, `scheduled_at` at the next 15-minute boundary, and the alarm is synced

#### Scenario: Cron job reschedules after running

- **WHEN** a cron job's handler completes
- **THEN** the same job row (same `id`) returns to `pending` with `scheduled_at` set to the next cron occurrence

#### Scenario: Duplicate cron schedule is ignored

- **WHEN** `schedule` is called with a `task` and `cron` matching an existing `pending` or `running` job
- **THEN** no new job row is created

#### Scenario: One-shot job retries with backoff

- **WHEN** a one-shot job's handler throws on attempt 0 with default options
- **THEN** the job is rescheduled 30 seconds later with `attempt` 1

#### Scenario: One-shot job exhausts retries

- **WHEN** a one-shot job fails and `attempt >= maxRetries`
- **THEN** the job is marked `dead` and `last_error` holds the error message

#### Scenario: Alarm processing invokes handler

- **WHEN** the DO alarm fires with a due job
- **THEN** the constructor-supplied handler is called with that job's `ScheduledJob`

### Requirement: Cancelling scheduled jobs

`JobScheduler` SHALL provide `cancel(task, cron?)` that deletes jobs for `task` in status `pending` or `running` and returns how many it removed. With `cron`, only the recurring job with that expression SHALL be cancelled; without it, every job for the task SHALL be. `completed` and `dead` jobs SHALL be left for the reaper. A job cancelled while its handler runs SHALL NOT re-arm (cron) or retry (one-shot) when the handler returns. After cancelling, the alarm SHALL be re-synced.

#### Scenario: Cancel a recurring job

- **WHEN** `cancel('reconcile', '0 */6 * * *')` is called with that cron job pending
- **THEN** it returns 1 and no `reconcile` job remains

#### Scenario: Other cron expressions untouched

- **WHEN** `reconcile` has jobs on two cron expressions and one is cancelled by expression
- **THEN** the other remains

#### Scenario: Cancel all jobs for a task

- **WHEN** `cancel('reconcile')` is called with a cron job and a one-shot pending
- **THEN** it returns 2 and jobs for other tasks remain

#### Scenario: History kept

- **WHEN** `cancel` is called and the task has only `completed` and `dead` jobs
- **THEN** it returns 0 and those rows remain

#### Scenario: Cancel from inside the running handler

- **WHEN** a cron job's handler cancels its own task
- **THEN** after the handler returns no job row remains

#### Scenario: Reschedule after cancel

- **WHEN** a cancelled cron job is scheduled again
- **THEN** exactly one job exists

### Requirement: Idempotency key blocks only pending jobs

When `schedule` is called with `options.key`, scheduling SHALL be skipped only if a job with the same `idempotency_key` has status `pending`. Jobs that are `running`, `completed`, or `dead` SHALL NOT block, so a handler may reschedule itself under its own key.

#### Scenario: Pending job blocks duplicate

- **WHEN** a `pending` job with key `k` exists and `schedule(..., { key: 'k' })` is called
- **THEN** no new job is created

#### Scenario: Completed job does not block

- **WHEN** the only job with key `k` is `completed` and `schedule(..., { key: 'k' })` is called
- **THEN** a new pending job is created

#### Scenario: Running job does not block self-reschedule

- **WHEN** a handler for a `running` job with key `k` calls `schedule(..., { key: 'k' })`
- **THEN** a new pending job is created

### Requirement: Typed cross-worker bindings via multi-config typegen

Any worker binding a storage DO SHALL generate its `Env` with `wrangler types -c wrangler.jsonc -c ../storage/wrangler.jsonc` and include `../storage/src/**/*` in its tsconfig, so `env.<BINDING>.get(id)` returns a typed `DurableObjectStub<T>` without casts. `.conventions/STYLEGUIDE-CODE.md` SHALL document this pattern and SHALL NOT reference `DurableObjectRPC` or `@taskless/shared/rpc`.

#### Scenario: Style guide reflects pattern

- **WHEN** a developer reads the cross-worker DO section of `STYLEGUIDE-CODE.md`
- **THEN** it describes multi-config `wrangler types` and `script_name` bindings, with no `DurableObjectRPC` cast

### Requirement: Compile-time RPC serializability check

The storage worker SHALL include `src/rpc-type-checks.ts` exporting `Expect<T>` and `AssertRPCSerializable<T>`, and `src/index.ts` SHALL assert every exported DO class with `type _Check = Expect<AssertRPCSerializable<Class>>`, so a method returning a non-serializable type fails `typecheck`.

#### Scenario: Non-serializable return fails typecheck

- **WHEN** a `TwitchChannel` method is changed to return a value whose type is not `Rpc.Serializable` (for example, an object with a symbol-keyed property)
- **THEN** `pnpm --filter @pvtch/storage typecheck` fails naming that method

#### Scenario: Known gap for class instances

- **WHEN** a method returns an instance of a plain class (not an `RpcTarget`)
- **THEN** typecheck passes, because Workers' `Rpc.Serializable` type treats method-bearing objects as stubbable; such returns SHALL be caught in review, since they fail at runtime

### Requirement: Local multi-worker development

`workers/storage` SHALL provide `dev`, `typecheck`, `lint`, `test`, and `deploy` scripts. Binders SHALL be able to run with storage in one process via `wrangler dev -c wrangler.jsonc -c ../storage/wrangler.jsonc` using a shared `--persist-to` directory at the repo root `.wrangler/`.

#### Scenario: Run storage standalone

- **WHEN** `pnpm --filter @pvtch/storage dev` runs
- **THEN** the storage worker starts locally and DO state persists under the shared `.wrangler/` directory

### Requirement: Storage deploys before binders

Workers SHALL be deployed by a GitHub Actions workflow (`.github/workflows/deploy.yml`) using `turbo run deploy`, not Cloudflare Workers Builds. On pushes to `main` it SHALL deploy in two phases: `@pvtch/storage` first if affected, then all other affected workers. On pull requests it SHALL run the same phases with `--dry-run`. The `deploy` task SHALL NOT declare a `^deploy` dependency. Deploy documentation SHALL state that removing a DO class requires two releases (binders drop the binding first; storage deletes the class second).

#### Scenario: Storage and a binder change together

- **WHEN** a push to `main` changes both `workers/storage` and `workers/core`
- **THEN** `pvtch-storage` finishes deploying before `pvtch-api` starts

#### Scenario: Only a binder changes

- **WHEN** a push to `main` changes only `workers/core`
- **THEN** `pvtch-storage` is not redeployed

#### Scenario: Pull request

- **WHEN** a pull request changes `workers/storage`
- **THEN** the workflow builds with `--dry-run` and nothing is deployed

#### Scenario: Deploy order documented

- **WHEN** a developer reads `workers/storage/README.md`
- **THEN** it states the storage-first deploy order and the two-release class-removal rule
