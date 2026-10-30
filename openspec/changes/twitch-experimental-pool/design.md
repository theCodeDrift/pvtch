## Context

- **Ingest today**: `POST /eventsub` on `pvtch-twitch` verifies the HMAC and timestamp, answers challenges and revocations inline, and sends notifications to `twitch-events`. `TwitchChannel` also sends `subscribe` / `unsubscribe` / `reconcile` work messages to the same queue.
- **Consumer today** (`consumer.ts`): `consume` → `handleQueueMessage(env, body, attempts)` parses with `twitchQueueMessage`. For `kind: 'event'` it calls `claim()`, which runs `claimMessage(messageId)` only when `attempts === 1`, then dispatches by `subscriptionType`. It returns an `Outcome` (`ack` | `retry`), and `consume` applies it. A thrown error retries, and after `max_retries: 3` the message goes to the DLQ.
- **Shared storage**: both workers bind `TWITCH_CHANNEL` with `script_name: "pvtch-storage"`, so they read and write the same per-channel objects, token bucket included.
- **Cloudflare constraints**: version overrides can't reach RPC calls and hold one of a deployment's two version slots, so this design uses a second worker _name_ instead of a second _version_. RPC over a service binding to a different worker is fully supported, and a plain-object return value crosses it unchanged.

## Goals / Non-Goals

**Goals:**

- Run unreleased Lingual code against real chat for chosen channels while every other channel stays on stable.
- Keep one webhook endpoint, one signing secret, one queue, and one DLQ.
- Switch a channel's pool instantly in either direction, with no deploy.
- Keep the experimental path the same code as stable, deployed from a branch.

**Non-Goals:**

- Isolating `TwitchChannel` state or code between pools.
- Protecting against broken builds (wrangler refuses to deploy code that doesn't build).
- Multiple experimental workers or percentage rollouts.
- Experimenting with ingest (`/eventsub`) itself. That always runs stable.

## Decisions

### 1. Branch in the queue consumer, not at ingest

Everything before the queue (verify, challenge, revocation, enqueue) has nothing to do with features, and Twitch needs a fast 2xx from it, so it stays shared. Everything worth experimenting with (lingo, sends, subscription handling) runs in the consumer. Branching there means one webhook endpoint and one queue, and it leaves retry and DLQ handling with the stable consumer.

_Alternative considered_: in-worker feature flags. Rejected as the main mechanism, because experiments would have to merge and ship through CI. A separate worker lets a branch run without merging.

### 2. Route and claim in one DO call, before dispatch

A new `TwitchChannel.routeMessage(messageId: string | null): { pool, fresh }` returns the pool and, when `messageId` is given, claims it in the same call (same SQL as `claimMessage`). The stable consumer:

1. parses the message (unparseable → log, ack);
2. resolves the channel: `broadcaster_user_id` for `channel.chat.message`, `user_id` for `user.authorization.revoke`, `broadcasterId` for work messages. Events with an unknown type have no channel, so they skip to step 5 (log, ack);
3. calls `routeMessage`, passing `messageId` only for events on their first attempt (`attempts === 1`) and `null` otherwise. That's today's `claim()` rule;
4. acks if `fresh` is false;
5. calls `processQueueMessage(env, message)` locally for `stable`, or `env.TWITCH_NEXT.process(message)` for `experimental`;
6. applies the returned `Outcome`. A thrown error, including one raised over RPC, retries.

Claiming before the forward matters. If prod claimed and the next worker then ran today's `claim()` on a first attempt, it would lose the claim and ack without processing. Moving the claim out of the shared step removes that possibility.

`claimMessage` stays as is, so the old `pvtch-twitch` keeps working between the storage deploy and the twitch deploy. A later change can remove it.

Because the pool is read on every attempt, a retried message follows the channel's _current_ pool. Moving a channel back to stable mid-retry hands the retry to stable.

### 3. Universal harness: `processQueueMessage` + `QueueHarness`

`processQueueMessage(env, message: TwitchQueueMessage): Promise<Outcome>` is today's `handleQueueMessage` minus parsing and claiming. Both workers build from the same `src/`, and `index.ts` exports:

```ts
export class QueueHarness extends WorkerEntrypoint<Env> {
  process(message: TwitchQueueMessage): Promise<Outcome> {
    return processQueueMessage(this.env, message);
  }
}
```

Prod binds it with `{ "binding": "TWITCH_NEXT", "service": "pvtch-twitch-next", "entrypoint": "QueueHarness" }`. `pvtch-twitch-next` has no `TWITCH_NEXT` binding and no consumer, so a forwarded message can't be forwarded again. The next worker re-parses the message with `twitchQueueMessage` before processing, because it may be running a branch whose schema has drifted.

### 4. `pvtch-twitch-next` as a wrangler environment

`env.next` in `workers/twitch/wrangler.jsonc`:

- `name: "pvtch-twitch-next"`, `workers_dev: false`, no `routes`, `observability.enabled: true`.
- The same `vars` as prod. `TWITCH_APP_URL` stays `https://twitch.pvtch.com`, so subscriptions created from the experimental pool call back to the single endpoint.
- The same `secrets_store_secrets`, `kv_namespaces`, `ai`, and `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`).
- No `queues` block (no consumer). Processing never enqueues.

Wrangler environments don't inherit bindings or vars, so `env.next` repeats them. A test compares the two binding sets so they can't drift apart unnoticed.

### 5. Deploy next from a developer machine

`"deploy:next": "wrangler deploy --env next"` in `workers/twitch/package.json`. Turbo's `deploy` task keeps running `wrangler deploy`, so CI deploys only prod. To experiment: check out the branch, run `pnpm --filter @pvtch/twitch deploy:next`, then set a channel to `experimental`. To reset: deploy `next` from `main`, or just set every channel back to `stable`.

Bootstrap: deploy `next` once from `main` before merging the prod `TWITCH_NEXT` binding.

### 6. Pool storage and admin

There's a new single-row `channel_pool` table (`pool TEXT NOT NULL`, `updated_at`). A missing row reads as `stable`. `setPool(pool)` upserts it, and `getPool()` reads it. `/admin/pool` (admin only, GET form + POST, same SameSite=Lax rationale as `/admin/bootstrap`) takes `?broadcaster=<id>`, defaulting to the admin's own id. `/admin/status` adds `pool`.

## Risks / Trade-offs

- **[Generated `Env` with an environment]** → Whether `wrangler types` emits `TWITCH_NEXT` as required or optional when `env.next` lacks it hasn't been checked. If it's optional, the consumer has to handle the missing binding: treat it as an error (retry → DLQ), never as a silent fall back to stable. Confirm during task 3.1.
- **[Experimental code on shared storage]** → Accepted. A branch that needs new `TwitchChannel` methods ships them to storage first, backwards compatible, as usual.
- **[Next lags `main`]** → `pvtch-twitch-next` keeps running whatever was last deployed to it. With no channel set to `experimental` it gets no traffic, so stale code there is harmless.
- **[One extra hop for experimental channels]** → An RPC call inside the account. That's negligible for a handful of channels.

## Migration Plan

1. Ship storage (`channel_pool`, `getPool`, `setPool`, `routeMessage`) through CI.
2. Ship the twitch harness split, `QueueHarness`, `env.next`, and `deploy:next`, with no `TWITCH_NEXT` binding yet. Behavior doesn't change.
3. From `main`, run `pnpm --filter @pvtch/twitch deploy:next` once.
4. Ship the `TWITCH_NEXT` binding, routing in the consumer, and `/admin/pool` through CI.
5. Smoke test: deploy a visibly different branch to `next`, set the admin's channel to `experimental`, chat, then set it back to `stable`.

Rollback: set every channel to `stable`. Removing the feature means reverting step 4, then deleting `pvtch-twitch-next`.
