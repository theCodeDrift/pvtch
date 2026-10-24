## Why

The planned Twitch EventSub bot (follow-up change) runs as its own worker on `twitch.pvtch.com`. It needs per-channel state that both that worker and the existing `pvtch-api` worker can reach. Today every Durable Object lives inside `workers/core` and is bound only there, so pvtch has no way to share a Durable Object across workers. Building that foundation as a separate change keeps the bot change focused on Twitch behavior, and the foundation can be reviewed and deployed on its own.

## What Changes

- Add a new `workers/storage` Cloudflare worker (`pvtch-storage`) whose only job is to host Durable Objects that other workers bind through `script_name`. It serves no public routes.
- Add a `TwitchChannel` Durable Object in `workers/storage`, one instance per broadcaster (`twitch:{broadcasterId}`). It holds:
  - bot enablement state
  - EventSub subscription id and status
  - EventSub message-id dedupe
  - a per-channel chat-send token bucket
- Lift the newer `JobScheduler` and `migrate` helpers from `taskless/taskless` into `workers/storage`. Compared with the copies in `workers/core`, they add:
  - cron schedules
  - a constructor-supplied job handler, so the scheduler is not exposed over RPC
  - stable job ids
  - a `queryRows` helper

  Keep pvtch's existing idempotency fix: only a `pending` job blocks rescheduling under the same key.

- Type cross-worker stubs by generating types for each binder with `wrangler types -c wrangler.jsonc -c ../storage/wrangler.jsonc`. Do not hand-write a `DurableObjectRPC<T>` cast; Taskless has dropped that pattern. Update `.conventions/STYLEGUIDE-CODE.md` to match, since it still describes the `@taskless/shared/rpc` approach that does not exist in pvtch.
- Add a compile-time RPC-serializability assertion for storage DOs (`rpc-type-checks.ts`).
- Run multiple workers locally with `wrangler dev -c ... -c ...` and a shared `--persist-to`.
- Move deploys from Cloudflare Workers Builds to a GitHub Actions workflow with turbo, two-phase and storage-first (lifted from Taskless `deploy.yml`). Workers Builds cannot order deploys across workers.
- Not included: migrating the existing `User` or `PvtchBackend` DOs, which stay in `workers/core` unchanged; a translation cache, which was tried before and rejected; and any Twitch API calls, which belong to the follow-up change.

## Capabilities

### New Capabilities

- `storage-worker`: The standalone `workers/storage` worker. Covers hosting DOs for cross-worker binding, the lifted `migrate` and `JobScheduler` helpers (cron, handler callback, backoff, idempotency), type generation for binders, RPC-serializability checks, local multi-worker dev, and deploy ordering.
- `twitch-channel`: The `TwitchChannel` Durable Object. Covers per-broadcaster bot enablement, EventSub subscription record, message-id dedupe with pruning, and the chat-send token bucket.

### Modified Capabilities

None. The `storage` capability (the `User` DO in `workers/core`) keeps its current behavior.

## Impact

- **New code**: `workers/storage/` (package `@pvtch/storage`), with `wrangler.jsonc`, `src/index.ts`, `src/durable-objects/twitch-channel.ts`, `src/helpers/{migrate,query-rows,job-scheduler}.ts` and tests.
- **New dependency**: `cron-parser` in `@pvtch/storage`.
- **Infrastructure**: a new Cloudflare worker script, `pvtch-storage`, with its first migration tag. No changes to `pvtch-api`'s wrangler migrations.
- **Conventions**: the `STYLEGUIDE-CODE.md` cross-worker DO section is rewritten.
- **Docs**: the deploy-your-own guide explains the multi-worker layout and the storage-first deploy order.
- **Cleanup**: the abandoned `PVTCH_TRANSLATIONS` KV binding (the old non-bot translation cache) is removed from `workers/core`.
- **Tooling**: adds `turbo` with a root `turbo.json`, plus `.github/workflows/deploy.yml`. CI's typecheck, lint and test steps are extended to `@pvtch/storage`.
- **Deploy**: repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Workers Builds is disconnected from `pvtch-api`.
