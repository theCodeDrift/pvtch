## Context

- **Ingest today**: `pvtch-twitch` `/eventsub` verifies the HMAC and timestamp, answers challenges and revocations inline, and sends `{ kind: 'event', messageId, subscriptionType, timestamp, event }` to `twitch-events`. The consumer claims `messageId` on the broadcaster's `TwitchChannel`, then runs Lingual's chat pipeline (`bot/chat.ts`, `lingo/`) or the authorization-revoke handler in-process. That includes the Helix send.
- **`TwitchChannel` today** (`workers/storage`): single-bot tables (`bot_state`, `subscriptions` keyed by `type`, `send_bucket`, `lingual_settings`) and `message_claims`. A `JobScheduler` runs `request-subscribe`, `request-unsubscribe`, `prune-dedupe` and the `reconcile-subscription` cron. It makes no Twitch API calls; it sends work to `twitch-events`.
- **Plugin pattern in use**: the core `User` DO builds `RpcTarget` plugins (`Lingo`, `Board`, …). Each takes `sql` and runs its own `migrate(..., '_<plugin>_version')`, and is reached through an accessor (`using lingo = await stub.lingo()`). An `RpcTarget` passes the `AssertRPCSerializable` check.
- **Platform facts**:
  - A Cloudflare queue has a single consumer worker, so "one worker per handler" means one queue per handler.
  - Queue delivery is at least once, and `send` takes no idempotency key.
  - A `channel.chat.message` subscription's condition is `{ broadcaster_user_id, user_id }`, where `user_id` is the reading/sending account. Twitch delivers each chat line once per subscription. The event body doesn't name the account; `subscription.condition` does.
  - Twitch chat rate limits apply per sending account per channel.

## Goals / Non-Goals

**Goals:**

- The webhook answers Twitch as fast as possible: verify, enqueue, 2xx.
- Adding a bot feature means a registry entry, a queue, a worker and an optional DO plugin, with no changes to ingest, routing or sending.
- Handler workers hold no Twitch credentials and make no Helix calls.
- Exactly-once _effects_ per handler, even though queues deliver at least once.
- Per-channel feature flags for trying unreleased behavior.

**Non-Goals:**

- A second handler.
- Preserving Lingual's current DO state or old RPC names.
- Routing inside the webhook request.

## Decisions

### 1. Registry: handlers and senders (`@pvtch/shared/twitch-registry`)

```ts
export const TWITCH_SENDERS = {
  botlingual: { userId: '1591556954', login: 'botlingual' },
} as const satisfies Record<string, TwitchSender>;

export const TWITCH_HANDLERS = {
  lingual: {
    sender: 'botlingual',
    eventTypes: ['channel.chat.message'],
    queue: 'LINGUAL_EVENTS', // producer binding on pvtch-twitch
  },
} as const satisfies Record<string, TwitchHandler>;

export const CHANNEL_EVENT_TYPES = ['user.authorization.revoke'] as const;
export function senderForUserId(userId: string): SenderId | undefined;
export function handlersFor(type: string): HandlerId[];
```

User ids and logins are public, so they live in code that storage, twitch, lingual and core all import. Sender `userId`s must be unique; a unit test enforces it.

### 2. Keep the router behind the queue

The webhook doesn't route. It enqueues and returns. The `pvtch-twitch` consumer routes, because only a queue retry can safely repeat a fan-out. If routing happened in the webhook, a claim followed by a failed enqueue would lose the event: Twitch's redelivery reuses the `message_id`, and the claim would reject it.

Router, for `kind: 'event'`:

1. **Tracked?** If `subscriptionType` is neither in `handlersFor(type)` nor in `CHANNEL_EVENT_TYPES`, log and ack.
2. **Who for?** The channel comes from the event (`broadcaster_user_id`; `user_id` for revoke). The sender comes from `senderForUserId(condition.user_id)` for handler types; an unknown sender is logged and acked.
3. **Own-sender messages.** A `channel.chat.message` whose `chatter_user_id` is a registered sender is never fanned out. If it's that sender's own subscription, the router first sets the send tier from its badges (decision 7), then acks.
4. **Matters to the channel?** Call `routeEvent({ messageId: attempts === 1 ? messageId : null, subscriptionType, senderId })` → `{ fresh, handlers, flags }`. Ack if `!fresh` or `handlers` is empty.
5. **Fan out.** Send one handler message per handler to `env[TWITCH_HANDLERS[h].queue]`, all sends together. Channel-level types run in-process instead (revoke). A failed send throws, the router message retries without claiming, and every handler gets the message again (decision 4).

Handler message:

```ts
{ kind: 'handler-event', handlerId, broadcasterId, senderId, messageId,
  subscriptionType, timestamp, event, flags: string[] }
```

### 3. Handler workers

A handler worker consumes its queue with `max_batch_size: 1`, its own `max_retries` and its own DLQ. It binds `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`) to read its plugin and claim, plus a `TWITCH_EVENTS` producer for `send`. It has no Twitch secrets.

`pvtch-lingual` (`workers/lingual`): queue `lingual-events`, DLQ `lingual-events-dlq`, bindings `TWITCH_CHANNEL`, `TWITCH_EVENTS` (producer) and `AI`, with `workers_dev: false` and no routes. It takes today's `bot/chat.ts` filtering (minus send tier and own-message handling, which move to the router) and the `lingo/` pipeline.

### 4. Dedupe at every hop with one DO primitive

Cloudflare Queues have no idempotency key, and KV's eventual consistency can't back an atomic claim. A single global dedupe DO would serialize every event across all channels. So claims live on the per-channel `TwitchChannel`, which is sharded by broadcaster and already on every hop's path. By the time a claim runs, the router has already dropped untracked and unwanted events, so a channel only contends with its own traffic.

`TwitchChannel.claim(key)` is today's atomic claim, generalized to any key, with the same 15-minute window and prune job. Each hop claims only on its first attempt (`attempts === 1`), so its own retries are never rejected:

- **Router:** `routeEvent` claims the raw `messageId`, so a Twitch delivery is fanned out at most once.
- **Handler:** claims `<handlerId>:<messageId>` before acting. A repeated fan-out, or a duplicate on the handler queue, fails the claim and is acked.
- **Send:** `acquireSendSlot(senderId, 'send:<sendId>')` claims the send in the same call that takes the token (decision 5). A duplicate `send` fails the claim and is acked.

None of these claims costs an extra round trip; each folds into a call the hop already makes to the channel DO.

### 5. Sending through `pvtch-twitch`

Handlers enqueue `{ kind: 'send', sendId, broadcasterId, senderId, handlerId, message, replyParentMessageId, timestamp }` to `twitch-events`. `sendId` is chosen by the handler and must be deterministic for a given outcome. Lingual uses `lingual:<messageId>`. A handler that someday posts several messages for one event adds a suffix. The `pvtch-twitch` consumer then:

1. skips if `timestamp` is more than 60 seconds old;
2. calls `acquireSendSlot(senderId, attempts === 1 ? 'send:<sendId>' : null)`:
   - `{ ok: false, duplicate: true }`: the send was already claimed. Ack without sending and without taking a token.
   - `{ ok: false, retryAfterMs }`: no slot is free. The claim is kept, and the queue message retries after `retryAfterMs`. The retry passes `null`, so it isn't rejected as a duplicate.
   - `{ ok: true }`: claimed and a token taken.
3. calls `POST /helix/chat/messages` with `sender_id: TWITCH_SENDERS[senderId].userId` and the reply parent;
4. on 429 retries per `Ratelimit-Reset`; on 5xx uses the default retry; on 403 disables every handler on the channel that uses `senderId`; on `is_sent: false` logs `drop_reason` and acks.

Folding the claim into `acquireSendSlot` keeps sending at one DO call. The claim runs before the token check in the same transaction, so a duplicate never spends a token.

### 6. `TwitchChannel`: generic state, plugins and sync

A new core migration drops `bot_state`, `subscriptions`, `send_bucket` and `lingual_settings`, and creates:

- `handlers (handler_id PK, enabled, enabled_at, updated_at)`
- `subscriptions (sender_id, type, subscription_id, status, updated_at, PK (sender_id, type))`
- `send_buckets (sender_id PK, tier, tokens, updated_at)`

RPC methods:

- handlers: `getHandler(h)`, `listHandlers()`, `enableHandler(h)`, `disableHandler(h)`
- subscriptions: `get/set/clearSubscription(senderId, type)`
- sending: `acquireSendSlot(senderId, claimKey)`, `setSendTier(senderId, tier)`
- routing and dedupe: `routeEvent(...)`, `claim(key)`
- plugins: `lingual()`, `flags()`

`claimMessage` and the bot-named methods are removed.

**Sync, not subscribe/unsubscribe.** The _desired_ subscriptions for a sender are the union of `eventTypes` over the enabled handlers that use it.

- `enableHandler` and `disableHandler` (on a state change) schedule `sync-subscriptions:<senderId>`: due now, idempotency key, retried by the scheduler. That job enqueues `{ kind: 'sync', broadcasterId, senderId }`.
- While any handler using a sender is enabled, a `reconcile-subscriptions:<senderId>` cron (`0 */6 * * *`) enqueues the same message. It is cancelled once none are.
- The `pvtch-twitch` consumer reads the desired set from the registry plus `listHandlers()`. It creates missing or unhealthy subscriptions (409 → look up and record; 403 → disable that sender's handlers) and deletes ones that are no longer wanted (404 counts as success).

Two handlers sharing a sender and an event type therefore share one subscription. That subscription stays as long as either handler is enabled.

**Plugins.** `plugins/lingual.ts` (`_lingual_version`; `getSettings` / `setSettings` with today's normalization) and `plugins/flags.ts` (`_flags_version`; `list` / `set`). Generic DO code never touches plugin tables.

### 7. Send tier stays with the platform

Moderator status belongs to the sending account in a channel, so the router sets it. When a sender's own chat message arrives on that sender's subscription, the router calls `setSendTier(senderId, 'moderator' | 'standard')` based on the badges. Handlers never see the sender's own messages.

### 8. Webhook and admin

- Callback verification and revocation resolve the sender with `senderForUserId(condition.user_id)`, then record or clear the subscription for `(senderId, type)`. On authorization loss they disable every handler that uses that sender.
- `/bot/authorize?sender=<senderId>` checks against that sender's `userId`.
- `/admin/flags` (GET/POST) toggles flags. `/admin/status` reports each handler's state, each sender's subscriptions and tier, Lingual's settings, and the flags.

## Risks / Trade-offs

- **[Latency]** → A reply now takes three queue hops: ingest, handler, send. Each adds up to `max_batch_timeout` (1 s) plus delivery time. Accepted for a translation bot. The 60-second staleness cutoff still applies at send time.
- **[Duplicate deliveries]** → Absorbed by the claims at each hop (decision 4), with no extra DO calls.
- **[Ambiguous Helix outcome]** → If Helix posts the message but the response is lost (a timeout or a 5xx after the post went through), the retry posts again. A claim can't detect this, because the retry holds the claim. Twitch offers no idempotency key on `POST /chat/messages`, so this is accepted.
- **[Retry budget on `twitch-events`]** → `send` retries for an empty bucket share `max_retries: 3` with event routing, as they do today. A busy channel can still dead-letter replies; raising the limit later only touches config.
- **[Deploy gap]** → The old twitch worker calls removed RPC methods after storage deploys. Accepted, because only the maintainer's channel is affected. Ship everything in one CI run.
- **[Forward-only rollback]** → The migration drops the old tables, so reverting the workers won't restore Lingual. Fix forward instead.

## Migration Plan

1. Create the queues: `wrangler queues create lingual-events` and `wrangler queues create lingual-events-dlq`.
2. Merge. CI deploys storage first, then twitch, lingual and core.
3. Re-enable Lingual on `/bots/lingual` and re-enter its settings. The existing Twitch subscription is picked up again through the 409 lookup.
4. Check `/admin/status`: `lingual` is enabled, `botlingual`'s `channel.chat.message` subscription is `enabled`, and a chat line gets a reply.

## Open Questions

- Should `pvtch-lingual` scale through `max_concurrency` on its own queue now, or wait for real traffic? Proposed: start at 10, as `twitch-events` does.
