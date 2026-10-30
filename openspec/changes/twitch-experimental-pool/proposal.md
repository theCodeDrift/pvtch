## Why

Every Lingual change ships straight to every channel that has the bot enabled, so a new feature can't be tried in a real chat without risking everyone's installs. Webhooks have to stay on one endpoint (`twitch.pvtch.com/eventsub`) with one signing secret, so the split can't happen at the edge. It has to happen after ingest, per channel, based on state pvtch already keeps.

## What Changes

- **Channel pool**: `TwitchChannel` stores a `pool` for each channel, `stable` (the default) or `experimental`. An admin flips it, and the change takes effect on the next queue message with no deploy. Sending a channel back to production means setting `pool` to `stable`.
- **One ingest, one queue**: `/eventsub` (signature verification, challenge, revocation, enqueue), the `twitch-events` queue, and its DLQ stay as they are and are shared by both pools.
- **Branch in the consumer, before the claim**: the `twitch-events` consumer in `pvtch-twitch` makes one call, `routeMessage(messageId)`, on the channel's DO. That call both claims the message for dedupe and returns the pool. Stable messages are processed locally. Experimental messages are forwarded over an RPC service binding (`TWITCH_NEXT`) to `pvtch-twitch-next`. The consumer applies the `Outcome` that comes back (ack or retry), so retries and dead-lettering stay in one place.
- **Universal harness**: the claim-free processing step (`processQueueMessage`, returning `Outcome`) is the same code in both workers. Each worker exports a `QueueHarness` `WorkerEntrypoint` around it. Only the stable consumer routes and claims, so the experimental worker never claims a message again (claiming twice would ack it unprocessed).
- **`pvtch-twitch-next`**: a wrangler environment `next` in `workers/twitch/wrangler.jsonc`. It has no routes, `workers_dev: false`, and no queue consumer. Its bindings and vars match prod, including `TWITCH_APP_URL`, so subscriptions it creates still call back to the single endpoint. A developer deploys it from their machine with `pnpm --filter @pvtch/twitch deploy:next`, from whichever branch is under test. CI never deploys it.
- **Bootstrap order**: `pvtch-twitch-next` is deployed once, from `main`, before the prod service binding ships, because prod's `TWITCH_NEXT` binding needs the target worker to exist.
- **Admin**: `GET/POST /admin/pool` reads and sets a channel's pool. `/admin/status` shows the pool.
- **Non-goals**: isolating the Durable Object (`pvtch-storage` is shared, and that's fine), guarding against broken builds (wrangler won't deploy code that fails to build), and separate webhook endpoints or Twitch apps.

## Capabilities

### New Capabilities

- `twitch-experimental-pool`: The `pvtch-twitch-next` worker, the `QueueHarness` entrypoint, the `TWITCH_NEXT` binding, routing by pool in the consumer, and the developer-run deploy.

### Modified Capabilities

- `twitch-channel`: Adds pool storage (`getPool`, `setPool`) and `routeMessage`, which claims and returns the pool in one call.
- `twitch-eventsub-ingest`: The consumer routes and claims through `routeMessage` before dispatching. Adds `/admin/pool`, and `/admin/status` reports the pool.

## Impact

- `workers/storage/src/durable-objects/twitch-channel.ts` and its migrations: a new `channel_pool` table and methods. Ships first, as storage always does.
- `workers/twitch/src/consumer.ts`: split into route (stable only) and `processQueueMessage` (shared).
- `workers/twitch/src/index.ts`: exports `QueueHarness`.
- `workers/twitch/src/routes/admin-pool.ts` (new) and `routes/admin-status.ts`.
- `workers/twitch/wrangler.jsonc`: `env.next`, plus the `TWITCH_NEXT` service binding on the top-level (prod) config.
- `workers/twitch/package.json`: a `deploy:next` script. The CI deploy workflow is unchanged.
- Twitch: no change. Same app, same secret, same callback URL.
