## 1. Pool and routing on TwitchChannel (workers/storage)

- [ ] 1.1 Add a `twitchChannelMigrations` entry that creates the single-row `channel_pool` table (`pool TEXT NOT NULL`, `updated_at INTEGER NOT NULL`).
- [ ] 1.2 Add `ChannelPool = 'stable' | 'experimental'`, plus `getPool()` (default `'stable'`) and `setPool(pool)`.
- [ ] 1.3 Add `routeMessage(messageId: string | null): { pool, fresh }`, sharing the claim statement and prune scheduling with `claimMessage` through a private helper. Leave `claimMessage` unchanged.
- [ ] 1.4 Write tests for each scenario in `specs/twitch-channel/spec.md`, and confirm the `AssertRPCSerializable` check still passes.
- [ ] 1.5 Ship storage through CI before any twitch change below.

## 2. Harness split (workers/twitch, no behavior change)

- [ ] 2.1 In `consumer.ts`, extract `processQueueMessage(env, message: TwitchQueueMessage): Promise<Outcome>` from `handleQueueMessage`, with no parsing and no `claim()`.
- [ ] 2.2 Add a `resolveChannel(message)` helper that returns the broadcaster id for chat events, `user_id` for `user.authorization.revoke`, `broadcasterId` for work messages, and `null` for unknown event types.
- [ ] 2.3 Rewrite `consume` as parse → `resolveChannel` → `routeMessage` (with `messageId` only for first-attempt events) → ack if `!fresh` → `processQueueMessage` → apply `Outcome`. Everything runs on stable in this step.
- [ ] 2.4 Export `QueueHarness extends WorkerEntrypoint<Env>` from `src/index.ts`. Its `process(message)` re-parses with `twitchQueueMessage` (unparseable → `ack`) and calls `processQueueMessage`.
- [ ] 2.5 Update `test/consumer.test.ts` for the new claim path: duplicates acked, retries not claimed, and unknown types acked.

## 3. The next environment

- [ ] 3.1 Add `env.next` to `workers/twitch/wrangler.jsonc` as specified (name `pvtch-twitch-next`, no routes, `workers_dev: false`, no queues, same vars and bindings). Run `cf-typegen`, then check the generated `Env` and record how `TWITCH_NEXT` comes out (required or optional). See the design's risks.
- [ ] 3.2 Add `"deploy:next": "wrangler deploy --env next"` to `workers/twitch/package.json`. Confirm turbo's `deploy` task and `.github/workflows/deploy.yml` still run only `deploy`.
- [ ] 3.3 Add a test that compares the binding names of the top-level config and `env.next` (ignoring `routes`, `queues` and `TWITCH_NEXT`).
- [ ] 3.4 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`, then merge sections 2 and 3 through CI.

## 4. Bootstrap next (manual, from a developer machine)

- [ ] 4.1 On an up-to-date `main`, run `pnpm --filter @pvtch/twitch deploy:next`.
- [ ] 4.2 In the dashboard, confirm `pvtch-twitch-next` exists with no routes, no `workers.dev` URL, and no queue consumer.

## 5. Route experimental channels (workers/twitch)

- [ ] 5.1 Add `"services": [{ "binding": "TWITCH_NEXT", "service": "pvtch-twitch-next", "entrypoint": "QueueHarness" }]` to the top-level config only.
- [ ] 5.2 In `consume`, call `env.TWITCH_NEXT.process(message)` when `pool === 'experimental'`. A missing binding or a thrown error retries; never fall back to stable.
- [ ] 5.3 Add `routes/admin-pool.ts` (`GET` form, `POST pool=stable|experimental`, 400 for anything else, `?broadcaster=` override, admin only) and register `GET|POST /admin/pool` in `src/index.ts`.
- [ ] 5.4 Add `pool` to the `/admin/status` channel block.
- [ ] 5.5 Write tests for each scenario in `specs/twitch-eventsub-ingest/spec.md` and `specs/twitch-experimental-pool/spec.md`, using a mock `TWITCH_NEXT`.
- [ ] 5.6 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`, then ship through CI. Section 4 must already be done.

## 6. Smoke test

- [ ] 6.1 On a scratch branch, make a visible change to the processing code (for example, a log line in `processQueueMessage`), then run `deploy:next`.
- [ ] 6.2 POST `pool=experimental` to `/admin/pool` for the admin's channel, then chat. Confirm the reply comes through and the log line shows up in `pvtch-twitch-next`'s logs.
- [ ] 6.3 POST `pool=stable`, then chat again. Confirm the reply comes through and the message is handled by `pvtch-twitch` with nothing in `pvtch-twitch-next`'s logs.
- [ ] 6.4 Redeploy `next` from `main`.
