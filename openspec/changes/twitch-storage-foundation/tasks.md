## 1. Workspace scaffolding

- [x] 1.1 Create `workers/storage/` with `package.json` (`@pvtch/storage`, scripts `dev`, `typecheck`, `lint`, `test`, `deploy`), `tsconfig.json`, and `eslint` config, mirroring `workers/core` conventions. Add `cron-parser` as a dependency.
- [x] 1.2 Add `workers/storage/wrangler.jsonc` with `name: "pvtch-storage"`, `nodejs_compat`, observability, the `TWITCH_CHANNEL` DO binding, and migration `v1` (`new_sqlite_classes: ["TwitchChannel"]`). Include Taskless's two-release class-removal comment.
- [x] 1.3 Add `src/index.ts` exporting `TwitchChannel` and a default `fetch` handler returning 404.
- [x] 1.4 Run `pnpm install` and `wrangler types` for storage; confirm `pnpm --filter @pvtch/storage typecheck` passes on the empty skeleton.

## 2. Lift helpers from taskless/taskless

- [x] 2.1 Copy `workers/storage/src/helpers/query-rows.ts` and `migrate.ts` from `taskless/taskless` (via `gh api repos/taskless/taskless/contents/...`), adapting imports to pvtch style.
- [x] 2.2 Copy `job-scheduler.ts` and `job-scheduler/migrations.ts` from Taskless (cron, handler callback, stable ids, reaping).
- [x] 2.3 Change the idempotency-key check to block only `status = 'pending'`, and narrow the `idx_jobs_idempotency` unique partial index to match (`status = 'pending'`), as in pvtch commit `da7c9eb` and taskless/taskless#392. Carry over the explanatory comment from `workers/core/do/helpers/job-scheduler/index.ts`. If Taskless merges #392 first, lift its version instead.
- [x] 2.4 Add header comments to both the core and storage copies noting that they diverge and pointing to each other.
- [x] 2.5 Add `src/rpc-type-checks.ts` (`Expect`, `AssertRPCSerializable`) from Taskless.
- [x] 2.6 Add `cancel(task, cron?)` to the storage `JobScheduler` (deletes `pending`/`running` jobs; a job cancelled mid-handler doesn't re-arm or retry), with workerd-SQL tests. File it upstream with taskless/taskless.

## 3. Test harness

- [x] 3.1 Set up storage tests on workerd SQLite through Miniflare, lifting Taskless's `test/helpers/workerd-sql.ts` (`createWorkerdSql`).
- [x] 3.2 Port or write tests for `migrate`: first run, re-run no-op, appended migration.
- [x] 3.3 Write tests for `JobScheduler`: cron schedule and reschedule with stable id, cron dedupe, one-shot backoff, dead after retries, pending-only idempotency (pending blocks; completed and running do not).

## 4. TwitchChannel Durable Object

- [x] 4.1 Create `src/durable-objects/twitch-channel.ts` and `src/durable-objects/twitch-channel/migrations.ts`, with tables `bot_state`, `subscriptions` (PK `type`), `message_claims` (PK `message_id`, `claimed_at`), and `send_bucket` (`tier`, `tokens`, `updated_at`).
- [x] 4.2 Wire the constructor: `migrate(...)` and `new JobScheduler(sql, ctx, handler)` with a private handler. Make `alarm()` delegate to the scheduler.
- [x] 4.3 Implement `getBot` / `enableBot` / `disableBot`.
- [x] 4.4 Implement `getSubscription` / `setSubscription` / `clearSubscription`.
- [x] 4.5 Implement `claimMessage` (atomic upsert with `RETURNING`; schedules a keyed one-shot `prune-dedupe`) and the self-rescheduling `prune-dedupe` handler.
- [x] 4.6 Implement `acquireSendSlot` and `setSendTier` (lazy refill, clamp on tier change, full bucket on first use).
- [x] 4.7 Add `type _Check = Expect<AssertRPCSerializable<TwitchChannel>>` in `src/index.ts`.
- [x] 4.8 Write tests covering every scenario in `specs/twitch-channel/spec.md`, using an injectable clock for the bucket and the dedupe window.

## 5. Conventions and docs

- [x] 5.1 Rewrite the "Cross-Worker Durable Object Access" section of `.conventions/STYLEGUIDE-CODE.md`: multi-config `wrangler types`, a tsconfig include of `../storage/src/**/*`, and `script_name` bindings. Remove `DurableObjectRPC` and `@taskless/shared/rpc`. Fix the package names in the "Code Quality Checks" filters, which list `@taskless/*`.
- [x] 5.2 Add `workers/storage/README.md` covering purpose, storage-first deploy order, the two-release class-removal rule, and local multi-worker dev (`wrangler dev -c ... -c ... --persist-to ../../.wrangler`).
- [x] 5.3 Add a pointer to the storage deploy order in the root `README.md`.
- [x] 5.4 Update the deploy-your-own guide (`app/routes/howto/deploy-your-own.tsx`): add a "How PVTCH Is Split Up" section explaining why shared DOs live in their own worker and why storage deploys first, deploy storage before core, the GitHub deploy option, and a troubleshooting entry for binding errors.
- [x] 5.5 Remove the abandoned `PVTCH_TRANSLATIONS` KV binding from `workers/core/wrangler.jsonc`, the regenerated types, `workers/core/README.md` and the guide. The guide and the binding have to change together, or a self-hoster's deploy fails on upstream's namespace ID. Deleting the namespace in Cloudflare is a manual step.

## 6. Verify and deploy

- [x] 6.1 Run `pnpm --filter @pvtch/storage typecheck`, `lint`, and `test`. Also run `pnpm --filter @pvtch/core typecheck` and `lint` to confirm core is unaffected.
- [x] 6.2 Run `pnpm --filter @pvtch/storage dev`, then hit `/` to confirm the 404 and that state persists under `.wrangler/`.
- [x] 6.3 Add `turbo` and a root `turbo.json` with `deploy`, `typecheck`, `lint` and `test` tasks, and give each worker a `deploy` script. Do not add a `^deploy` dependency.
- [x] 6.4 Add `.github/workflows/deploy.yml`, lifted from Taskless: affected-scoped, two-phase storage-first, `--dry-run` on pull requests, and skipping with a warning when the token is absent. Extend `ci.yml` to typecheck, lint and test `@pvtch/storage`.
- [ ] 6.5 Add the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. Merge, then confirm phase 1 deployed `pvtch-storage`. Disconnect Workers Builds from `pvtch-api`.
