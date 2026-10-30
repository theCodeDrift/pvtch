## Why

`pvtch-twitch` is both pvtch's Twitch platform layer (EventSub, Helix, the app token) and the Lingual bot, so every Lingual change ships with the webhook endpoint. `TwitchChannel` assumes a single bot: its state tables are single-row, subscriptions are keyed by EventSub type, and Lingual's settings sit in the core schema. pvtch's design calls for purpose-built bots, each focused on one job. They need a shared way to receive the Twitch events they care about and to send chat, without each one reimplementing EventSub, rate limiting and Helix.

Nobody but the maintainer uses Lingual yet, so this change reshapes storage, queue messages and RPC names with no compatibility layer.

## What Changes

- **Fan-out router.** `/eventsub` still only verifies, answers challenges and revocations, and enqueues to `twitch-events` so Twitch gets its 2xx right away. The `pvtch-twitch` consumer then routes each event:
  1. Is this an event pvtch tracks? It checks the type against the handler registry.
  2. Does it matter to this channel? One `TwitchChannel.routeEvent` call claims the message and returns the channel's enabled handlers for this event, plus its feature flags.
  3. Fan out: one message per handler, on that handler's own queue.
- **Handlers are their own workers.** Each handler has a queue and a consumer worker. The first is **`pvtch-lingual`** (`workers/lingual`, queue `lingual-events`), which only translates. It reads its settings from the channel DO and has no Twitch credentials.
- **Sending stays in `pvtch-twitch`.** Handlers reply by enqueuing a `send` request to `twitch-events`. `pvtch-twitch` takes a slot from the channel's per-sender token bucket on the DO and posts through Helix, with today's 429/403/drop handling.
- **Handlers and senders are separate.** A _handler_ is a feature (`lingual`), registered with its event types, queue and sender. A _sender_ is a Twitch bot account (`botlingual`). Subscriptions and send buckets are per `(channel, sender)`, and enablement is per `(channel, handler)`. Several handlers can share one account, or a new bot can bring its own. The registry lives in `@pvtch/shared/twitch-registry` and replaces `TWITCH_BOT_USER_ID` and `LINGUAL_BOT_LOGIN`.
- **Subscription sync per sender.** Enabling or disabling a handler schedules a sync for its sender. The sync computes which subscriptions the enabled handlers need and creates or deletes subscriptions to match. This replaces separate subscribe and unsubscribe work.
- **`TwitchChannel` as a plugin host.** Handler state lives in `RpcTarget` plugins with their own migrations, following the core `User` DO's pattern: `using lingual = await channel.lingual()`. The DO's own schema keeps only shared state: handler enablement, per-sender subscriptions and send buckets, message dedupe, and the scheduler.
- **Feature flags** instead of an experimental worker. A per-channel `Flags` plugin holds names like `lingual.<feature>`. The router copies the flags into each handler message, and admins toggle them at `/admin/flags`.
- **Duplicate deliveries.** Queues deliver at least once and have no idempotency key, so `routeEvent` claims the message for the router, and each handler claims `<handlerId>:<messageId>` before acting. A router retry that fans out again is absorbed by those handler claims.
- **Out of scope.** A second handler, migrating Lingual's existing state (it is reset), and changes to the Lingo helper endpoint on www.

## Capabilities

### New Capabilities

- `twitch-event-fanout`: The handler and sender registry, the router's steps, the handler message format, handler dedupe, and `send` requests.
- `lingual-worker`: The `pvtch-lingual` worker, its queue, bindings and consumer.

### Modified Capabilities

- `twitch-channel`: Handler enablement, per-sender subscriptions and send buckets, per-sender subscription sync, `routeEvent`, generic `claim`, the `Lingual` and `Flags` plugins. Lingual's settings leave the core schema.
- `twitch-eventsub-ingest`: The webhook resolves the sender from `condition.user_id` and enqueues `condition`. The consumer becomes the router plus `send` and `sync` handling. Adds `/admin/flags`; `/admin/status` reports handlers, senders and flags.
- `twitch-chat-bot`: Subscription work becomes per-sender sync. App-level revoke disables every handler. Send tier and loop prevention move to the router, and replies go through `send` requests.
- `lingo-bot`: The pipeline runs in `pvtch-lingual`, reads settings through `channel.lingual()`, and replies by enqueuing `send`.
- `bot-consent`: www enables and disables the `lingual` handler, and bot-account authorization is per sender.

## Impact

- **New:** `workers/lingual` (`pvtch-lingual`), and Cloudflare queues `lingual-events` and `lingual-events-dlq` (created by hand before deploy).
- **`packages/shared`:** new `twitch-registry`, and reshaped `twitch-queue` message types (`event` with `condition`, `sync`, `send`, and the handler message).
- **`workers/storage`:** `TwitchChannel` rework, a new core migration, and `plugins/lingual.ts` and `plugins/flags.ts`.
- **`workers/twitch`:** router consumer, sync, send and webhook changes, `bot-authorize`, admin routes. Gains a `LINGUAL_EVENTS` producer. Loses `bot/chat.ts` and `lingo/` (they move to `workers/lingual`), and `TWITCH_BOT_USER_ID`.
- **`workers/core`:** `/bots/lingual` uses the new RPC names and registry. `LINGUAL_BOT_LOGIN` is removed.
- **Deploy:** storage first (phase 1), then twitch, lingual and core in the same CI run. Lingual is down between deploys and has to be re-enabled afterwards.
