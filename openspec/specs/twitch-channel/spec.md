# twitch-channel Specification

## Purpose

Per-broadcaster `TwitchChannel` Durable Object (`twitch:{broadcasterId}`) holding Twitch bot enablement, Lingual's settings, the EventSub subscription record, EventSub message-id dedupe, and the chat-send token bucket. It makes no Twitch API calls; it requests Twitch work through the `twitch-events` queue.

## Requirements

### Requirement: Per-broadcaster TwitchChannel Durable Object

The storage worker SHALL provide a SQLite-backed `TwitchChannel` Durable Object extending `DurableObject<Env>`, addressed by `idFromName("twitch:{broadcasterId}")` where `broadcasterId` is the Twitch user id of the channel owner. It SHALL run its schema via `migrate(sql, twitchChannelMigrations, '_twitch_channel_version')` and construct a `JobScheduler` with a private handler. It SHALL make no outbound Twitch API calls.

#### Scenario: Addressing

- **WHEN** a binder needs state for broadcaster `12345`
- **THEN** it obtains the stub via `env.TWITCH_CHANNEL.get(env.TWITCH_CHANNEL.idFromName("twitch:12345"))`

#### Scenario: Constructor runs migrations

- **WHEN** a `TwitchChannel` is constructed for the first time
- **THEN** its tables and the scheduler's `jobs` table exist

### Requirement: Bot enablement state

`TwitchChannel` SHALL store, per `HandlerId`, whether that handler is enabled for the channel. `getHandler(handlerId)` SHALL return `{ enabled, enabledAt, updatedAt }` (`enabled: false` and `enabledAt: null` when never enabled). `listHandlers()` SHALL return the enabled `HandlerId`s. `enableHandler(handlerId)` SHALL set `enabled` true and record `enabledAt` if previously disabled; `disableHandler(handlerId)` SHALL set `enabled` false. Both SHALL update `updatedAt`. One handler's state SHALL NOT affect another's.

#### Scenario: Default state

- **WHEN** `getHandler('lingual')` is called on a new channel
- **THEN** it returns `{ enabled: false, enabledAt: null, ... }`

#### Scenario: Enable then disable

- **WHEN** `enableHandler('lingual')` then `disableHandler('lingual')` are called
- **THEN** `getHandler('lingual').enabled` is false and `enabledAt` still holds the enable time

### Requirement: EventSub subscription record

`TwitchChannel` SHALL store at most one EventSub subscription record per `(senderId, type)`: `{ senderId, type, subscriptionId, status, updatedAt }`. `setSubscription(senderId, type, subscriptionId, status)` SHALL upsert the record; `getSubscription(senderId, type)` SHALL return it or `null`; `clearSubscription(senderId, type)` SHALL remove it. `status` SHALL be stored as the string Twitch reports (e.g. `enabled`, `webhook_callback_verification_pending`, `authorization_revoked`).

#### Scenario: Record a subscription

- **WHEN** `setSubscription('botlingual', 'channel.chat.message', 'abc', 'webhook_callback_verification_pending')` is called
- **THEN** `getSubscription('botlingual', 'channel.chat.message')` returns that id and status

#### Scenario: Status update

- **WHEN** `setSubscription('botlingual', 'channel.chat.message', 'abc', 'enabled')` is called for an existing record
- **THEN** the status becomes `enabled` and `updatedAt` advances

#### Scenario: Revocation clears

- **WHEN** `clearSubscription('botlingual', 'channel.chat.message')` is called
- **THEN** `getSubscription('botlingual', 'channel.chat.message')` returns `null`

### Requirement: EventSub message dedupe

`TwitchChannel` SHALL provide `claim(key)` that returns `true` the first time a given key is claimed and `false` on every subsequent claim within the dedupe window (15 minutes). The router claims raw EventSub message ids (through `routeEvent`), handlers claim `<handlerId>:<messageId>`, and the send step claims `send:<sendId>` (through `acquireSendSlot`). The claim SHALL be a single atomic statement; a claim older than the window SHALL be treated as new. Each claim SHALL schedule a one-shot `prune-dedupe` job 15 minutes out under the idempotency key `prune-dedupe`, so at most one is ever queued. The job SHALL delete claims older than the window and, if any claims remain, reschedule itself for when the oldest remaining claim expires. A channel with no claims SHALL have no pending prune job (no perpetual alarm).

#### Scenario: First claim

- **WHEN** `claim('m1')` is called for the first time
- **THEN** it returns `true`

#### Scenario: Duplicate delivery

- **WHEN** `claim('m1')` is called again within 15 minutes
- **THEN** it returns `false`

#### Scenario: Independent keys

- **WHEN** `claim('m1')` and then `claim('lingual:m1')` are called
- **THEN** both return `true`

#### Scenario: Expired claim

- **WHEN** `claim('m1')` is called 15 minutes or more after the first claim
- **THEN** it returns `true`

#### Scenario: One prune queued

- **WHEN** several keys are claimed in a row
- **THEN** exactly one pending `prune-dedupe` job exists

#### Scenario: Prune expired ids

- **WHEN** the `prune-dedupe` job runs and a key was claimed more than 15 minutes ago
- **THEN** that key's row is deleted, and no prune job remains if no claims are left

#### Scenario: Prune keeps live ids

- **WHEN** the `prune-dedupe` job runs while a younger claim remains
- **THEN** that claim is kept and the job reschedules for the claim's expiry

### Requirement: Chat-send token bucket

`TwitchChannel` SHALL rate-limit outbound chat sends with a lazily-refilled token bucket per `SenderId`. `acquireSendSlot(senderId, claimKey)` SHALL, when `claimKey` is a string, first `claim(claimKey)` and return `{ ok: false, duplicate: true }` without touching the bucket if the claim fails. It SHALL then refill that sender's tokens by elapsed time at its tier's rate, and either consume one token and return `{ ok: true }`, or return `{ ok: false, retryAfterMs }` with the milliseconds until one token is available, keeping any claim it made. When `claimKey` is `null` it SHALL claim nothing. The default tier SHALL be `standard` (capacity 20, refill 20 per 30 seconds); `setSendTier(senderId, 'moderator')` SHALL switch that sender to capacity 100, refill 100 per 30 seconds; `setSendTier(senderId, 'standard')` SHALL switch back. Switching tier SHALL clamp current tokens to the new capacity. A sender's first bucket SHALL start full.

#### Scenario: Within limit

- **WHEN** `acquireSendSlot('botlingual', null)` is called 20 times in quick succession on a new `standard` channel
- **THEN** all 20 return `{ ok: true }`

#### Scenario: Duplicate send

- **WHEN** `acquireSendSlot('botlingual', 'send:lingual:m1')` is called twice within 15 minutes
- **THEN** the second returns `{ ok: false, duplicate: true }` and consumes no token

#### Scenario: Claim kept while waiting for a slot

- **WHEN** `acquireSendSlot('botlingual', 'send:lingual:m1')` returns `{ ok: false, retryAfterMs }` and the retry calls `acquireSendSlot('botlingual', null)` after the delay
- **THEN** the retry returns `{ ok: true }`, and a later `acquireSendSlot('botlingual', 'send:lingual:m1')` returns `{ ok: false, duplicate: true }`

#### Scenario: Limit exceeded

- **WHEN** a 21st call is made immediately after
- **THEN** it returns `{ ok: false, retryAfterMs }` with `retryAfterMs` approximately 1500

#### Scenario: Refill over time

- **WHEN** 30 seconds elapse after the bucket is emptied
- **THEN** 20 further calls succeed

#### Scenario: Moderator tier

- **WHEN** `setSendTier('botlingual', 'moderator')` is called on a channel with a full bucket
- **THEN** after refill the bucket allows up to 100 sends per 30 seconds

### Requirement: RPC surface is serializable and minimal

Every public method on `TwitchChannel` SHALL return an `Rpc.Serializable` value (plain objects, primitives, `null`). The scheduler handler and internal helpers SHALL NOT be reachable as RPC methods.

#### Scenario: No scheduler on RPC surface

- **WHEN** a binder inspects the `DurableObjectStub<TwitchChannel>` type
- **THEN** no `scheduled`, `alarm`-handler, or job-processing method is available other than the runtime `alarm()` lifecycle method

### Requirement: TwitchChannel requests Twitch work through the queue

`TwitchChannel` SHALL have a queue producer binding `TWITCH_EVENTS` to the `twitch-events` queue and SHALL request all Twitch API work by sending `{ kind: 'sync', broadcasterId, senderId }`. It SHALL continue to make no direct Twitch API calls. The `broadcasterId` SHALL be derived from the DO name (`twitch:{broadcasterId}`).

#### Scenario: No direct Twitch calls

- **WHEN** any `TwitchChannel` method or scheduled job runs
- **THEN** no request is made to `api.twitch.tv` or `id.twitch.tv`

### Requirement: Enable and disable enqueue subscription work

`enableHandler(handlerId)` and `disableHandler(handlerId)` SHALL, when they change state, schedule a one-shot `sync-subscriptions:<senderId>` job for the handler's registry sender (due immediately, idempotency key `sync-subscriptions:<senderId>`). The job SHALL send `{ kind: 'sync', broadcasterId, senderId }` to the queue, retrying with the scheduler's backoff if the send fails. Calls that do not change state SHALL request nothing.

#### Scenario: Enable

- **WHEN** `enableHandler('lingual')` is called on a disabled channel and the alarm runs
- **THEN** one `sync` message for `botlingual` is enqueued

#### Scenario: Repeat enable

- **WHEN** `enableHandler('lingual')` is called on an already-enabled channel
- **THEN** nothing is enqueued

#### Scenario: Enable then disable before the alarm

- **WHEN** `enableHandler('lingual')` then `disableHandler('lingual')` are called before the alarm runs
- **THEN** exactly one `sync` message for `botlingual` is enqueued

#### Scenario: Queue send fails

- **WHEN** the queue send for a sync request fails
- **THEN** the job retries with backoff until the send succeeds

### Requirement: Recurring subscription reconcile

While any enabled handler uses a sender, `TwitchChannel` SHALL run a cron job `reconcile-subscriptions:<senderId>` every 6 hours (`0 */6 * * *`) whose handler enqueues `{ kind: 'sync', broadcasterId, senderId }`. The cron SHALL be cancelled when no enabled handler uses that sender.

#### Scenario: Reconcile fires

- **WHEN** botlingual's reconcile cron fires for a channel with `lingual` enabled
- **THEN** one `sync` message for `botlingual` is enqueued

#### Scenario: Last handler disabled

- **WHEN** `disableHandler('lingual')` leaves no enabled handler using `botlingual`
- **THEN** botlingual's reconcile cron is cancelled

### Requirement: Channel plugins

Handler- and feature-specific state SHALL live in `RpcTarget` plugin classes under `durable-objects/twitch-channel/plugins/`, constructed by `TwitchChannel` with its `SqlStorage`, each running its own migrations under its own version table (`_<plugin>_version`). `TwitchChannel` SHALL expose each through an accessor (`lingual()`, `flags()`), following the core `User` DO's plugin pattern. Generic `TwitchChannel` code SHALL NOT read or write a plugin's tables.

#### Scenario: Plugin accessor

- **WHEN** a binder calls `using lingual = await channel.lingual()` and then `lingual.getSettings()`
- **THEN** it receives the channel's Lingual settings

#### Scenario: Independent migrations

- **WHEN** a `TwitchChannel` is constructed for the first time
- **THEN** the core, scheduler, `Lingual`, and `Flags` tables all exist, each tracked by its own version table

### Requirement: Lingual plugin settings

The `Lingual` plugin SHALL store a target `language` (nullable) and `ignoredChatters` (a JSON array) in its own single-row table. `getSettings()` SHALL return `{ language: null, ignoredChatters: [] }` when nothing is saved. `setSettings()` SHALL replace both values, lowercasing the language (an empty one clears it) and lowercasing, stripping a leading `@` from, and de-duplicating chatter logins. Callers SHALL validate the language.

#### Scenario: Defaults

- **WHEN** `lingual().getSettings()` is called on a channel that never saved settings
- **THEN** it returns `{ language: null, ignoredChatters: [] }`

#### Scenario: Normalization

- **WHEN** `lingual().setSettings({ language: ' Spanish ', ignoredChatters: ['@StreamElements', 'nightbot', 'NIGHTBOT'] })` is called
- **THEN** the stored settings are `{ language: 'spanish', ignoredChatters: ['streamelements', 'nightbot'] }`

### Requirement: Channel feature flags

The `Flags` plugin (`flags()`) SHALL store named flags for the channel. `list()` SHALL return the names that are on; `set(name, on)` SHALL turn one on or off and return the new list. Names SHALL be `<handlerId>.<feature>`. A new channel SHALL have no flags on.

#### Scenario: Toggle

- **WHEN** `flags().set('lingual.reply-threading', true)` and then `flags().set('lingual.reply-threading', false)` are called
- **THEN** `list()` contains the flag after the first call and not after the second

### Requirement: Event routing

`TwitchChannel` SHALL provide `routeEvent({ messageId, subscriptionType, senderId })` returning `{ fresh, handlers, flags }`. When `messageId` is a string it SHALL `claim(messageId)` and `fresh` SHALL be the result; when `null`, `fresh` SHALL be `true`. For a handler event type, `handlers` SHALL list the enabled handlers whose registry `eventTypes` include `subscriptionType` and whose `sender` is `senderId`. For a channel-level type, `handlers` SHALL list every enabled handler. `flags` SHALL be `flags().list()`.

#### Scenario: Enabled handler

- **WHEN** `routeEvent({ messageId: 'm1', subscriptionType: 'channel.chat.message', senderId: 'botlingual' })` is called on a channel with `lingual` enabled
- **THEN** it returns `{ fresh: true, handlers: ['lingual'], flags: [...] }`

#### Scenario: Disabled handler

- **WHEN** the same call is made on a channel with `lingual` disabled
- **THEN** `handlers` is empty

#### Scenario: Redelivery

- **WHEN** `routeEvent` is called again with `messageId: 'm1'` within 15 minutes
- **THEN** `fresh` is `false`

#### Scenario: Retry skips the claim

- **WHEN** `routeEvent` is called with `messageId: null`
- **THEN** `fresh` is `true` and no claim row is written
