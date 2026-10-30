## ADDED Requirements

### Requirement: Bot registry

`@pvtch/shared/twitch-bots` SHALL export `TWITCH_BOTS`, a map from `BotId` to `{ userId, login, eventTypes }`, and `botForUserId(userId)` returning the matching `BotId` or `undefined`. `lingual` SHALL be registered with the bot account's user id, login `botlingual`, and `eventTypes: ['channel.chat.message']`. No two bots SHALL share a `userId`.

#### Scenario: Lookup by account

- **WHEN** `botForUserId` is called with Lingual's registered user id
- **THEN** it returns `'lingual'`

#### Scenario: Unknown account

- **WHEN** `botForUserId('999')` is called and no bot has that id
- **THEN** it returns `undefined`

#### Scenario: Duplicate account rejected

- **WHEN** the registry contains two bots with the same `userId`
- **THEN** the registry's unit test fails

### Requirement: Bot plugins

Each bot's own state SHALL live in an `RpcTarget` plugin class under `durable-objects/twitch-channel/plugins/`, constructed by `TwitchChannel` with its `SqlStorage` and running its own migrations under its own version table (`_<botId>_version`). `TwitchChannel` SHALL expose each plugin through an accessor named after the bot (e.g. `lingual()`), following the core `User` DO's plugin pattern. Generic `TwitchChannel` code SHALL NOT read or write a plugin's tables.

#### Scenario: Plugin accessor

- **WHEN** a binder calls `using lingual = await channel.lingual()` and then `lingual.getSettings()`
- **THEN** it receives the channel's Lingual settings

#### Scenario: Independent migrations

- **WHEN** a `TwitchChannel` is constructed for the first time
- **THEN** the core tables, the scheduler's tables, and each plugin's tables exist, each tracked by its own version table

### Requirement: Lingual plugin settings

The `Lingual` plugin SHALL store a target `language` (nullable) and `ignoredChatters` (a JSON array) in its own single-row table. `getSettings()` SHALL return `{ language: null, ignoredChatters: [] }` when nothing is saved. `setSettings()` SHALL replace both values, lowercasing the language (an empty one clears it) and lowercasing, stripping a leading `@` from, and de-duplicating chatter logins. Callers SHALL validate the language.

#### Scenario: Defaults

- **WHEN** `lingual().getSettings()` is called on a channel that never saved settings
- **THEN** it returns `{ language: null, ignoredChatters: [] }`

#### Scenario: Normalization

- **WHEN** `lingual().setSettings({ language: ' Spanish ', ignoredChatters: ['@StreamElements', 'nightbot', 'NIGHTBOT'] })` is called
- **THEN** the stored settings are `{ language: 'spanish', ignoredChatters: ['streamelements', 'nightbot'] }`

### Requirement: Channel feature flags

`TwitchChannel` SHALL expose a `Flags` plugin through `flags()`. `list()` SHALL return the names of the flags that are on. `set(name, on)` SHALL turn a flag on or off and return the new list. Flag names SHALL be `<botId>.<feature>`. A new channel SHALL have no flags on.

#### Scenario: Toggle

- **WHEN** `flags().set('lingual.reply-threading', true)` and then `flags().set('lingual.reply-threading', false)` are called
- **THEN** `list()` contains the flag after the first call and not after the second

### Requirement: Event routing

`TwitchChannel` SHALL provide `routeEvent({ messageId, subscriptionType, botId })` returning `{ fresh, bots, flags }`. When `messageId` is a string it SHALL claim it with the dedupe statement, window, and prune scheduling of the EventSub message dedupe requirement, and `fresh` SHALL be the claim result. When `messageId` is `null`, `fresh` SHALL be `true`. `bots` SHALL list the enabled bots whose registry `eventTypes` include `subscriptionType`, narrowed to `botId` when it is given. When `subscriptionType` is a channel-level type (`user.authorization.revoke`), `bots` SHALL list every enabled bot. `flags` SHALL be `flags().list()`.

#### Scenario: Enabled bot

- **WHEN** `routeEvent({ messageId: 'm1', subscriptionType: 'channel.chat.message', botId: 'lingual' })` is called on a channel with Lingual enabled
- **THEN** it returns `{ fresh: true, bots: ['lingual'], flags: [...] }`

#### Scenario: Disabled bot

- **WHEN** the same call is made on a channel with Lingual disabled
- **THEN** `bots` is empty

#### Scenario: Redelivery

- **WHEN** `routeEvent` is called again with `messageId: 'm1'` within 15 minutes
- **THEN** `fresh` is `false`

#### Scenario: Retry skips the claim

- **WHEN** `routeEvent` is called with `messageId: null`
- **THEN** `fresh` is `true` and no claim row is written

## MODIFIED Requirements

### Requirement: Bot enablement state

`TwitchChannel` SHALL store, per `BotId`, whether that bot is enabled for the channel. `getBot(botId)` SHALL return `{ enabled, enabledAt, updatedAt }` (`enabled: false` and `enabledAt: null` when never enabled). `listBots()` SHALL return the `BotId`s that are enabled. `enableBot(botId)` SHALL set `enabled` true and record `enabledAt` if previously disabled; `disableBot(botId)` SHALL set `enabled` false. Both SHALL update `updatedAt`. One bot's state SHALL NOT affect another's.

#### Scenario: Default state

- **WHEN** `getBot('lingual')` is called on a new channel
- **THEN** it returns `{ enabled: false, enabledAt: null, ... }`

#### Scenario: Enable then disable

- **WHEN** `enableBot('lingual')` then `disableBot('lingual')` are called
- **THEN** `getBot('lingual').enabled` is false and `enabledAt` still holds the enable time

### Requirement: EventSub subscription record

`TwitchChannel` SHALL store at most one EventSub subscription record per `(botId, type)`: `{ botId, type, subscriptionId, status, updatedAt }`. `setSubscription(botId, type, subscriptionId, status)` SHALL upsert the record; `getSubscription(botId, type)` SHALL return it or `null`; `clearSubscription(botId, type)` SHALL remove it. `status` SHALL be stored as the string Twitch reports (e.g. `enabled`, `webhook_callback_verification_pending`, `authorization_revoked`).

#### Scenario: Record a subscription

- **WHEN** `setSubscription('lingual', 'channel.chat.message', 'abc', 'webhook_callback_verification_pending')` is called
- **THEN** `getSubscription('lingual', 'channel.chat.message')` returns that id and status

#### Scenario: Status update

- **WHEN** `setSubscription('lingual', 'channel.chat.message', 'abc', 'enabled')` is called for an existing record
- **THEN** the status becomes `enabled` and `updatedAt` advances

#### Scenario: Revocation clears

- **WHEN** `clearSubscription('lingual', 'channel.chat.message')` is called
- **THEN** `getSubscription('lingual', 'channel.chat.message')` returns `null`

### Requirement: EventSub message dedupe

`TwitchChannel` SHALL claim EventSub message ids through `routeEvent`, which returns `fresh: true` the first time a given id is claimed and `fresh: false` on every subsequent claim within the dedupe window (15 minutes). The claim SHALL be a single atomic statement; a claim older than the window SHALL be treated as new. Each claim SHALL schedule a one-shot `prune-dedupe` job 15 minutes out under the idempotency key `prune-dedupe`, so at most one is ever queued. The job SHALL delete claims older than the window and, if any claims remain, reschedule itself for when the oldest remaining claim expires. A channel with no claims SHALL have no pending prune job (no perpetual alarm). There SHALL be no separate `claimMessage` method.

#### Scenario: First claim

- **WHEN** `routeEvent` is called with `messageId: 'm1'` for the first time
- **THEN** it returns `fresh: true`

#### Scenario: Duplicate delivery

- **WHEN** `routeEvent` is called with `messageId: 'm1'` again within 15 minutes
- **THEN** it returns `fresh: false`

#### Scenario: Expired claim

- **WHEN** `routeEvent` is called with `messageId: 'm1'` 15 minutes or more after the first claim
- **THEN** it returns `fresh: true`

#### Scenario: One prune queued

- **WHEN** several messages are claimed in a row
- **THEN** exactly one pending `prune-dedupe` job exists

#### Scenario: Prune expired ids

- **WHEN** the `prune-dedupe` job runs and an id was claimed more than 15 minutes ago
- **THEN** that id's row is deleted, and no prune job remains if no claims are left

#### Scenario: Prune keeps live ids

- **WHEN** the `prune-dedupe` job runs while a younger claim remains
- **THEN** that claim is kept and the job reschedules for the claim's expiry

### Requirement: Chat-send token bucket

`TwitchChannel` SHALL rate-limit outbound chat sends with a lazily-refilled token bucket per `BotId`. `acquireSendSlot(botId)` SHALL refill that bot's tokens by elapsed time at its tier's rate, then either consume one token and return `{ ok: true }`, or return `{ ok: false, retryAfterMs }` with the milliseconds until one token is available. The default tier SHALL be `standard` (capacity 20, refill 20 per 30 seconds); `setSendTier(botId, 'moderator')` SHALL switch that bot to capacity 100, refill 100 per 30 seconds; `setSendTier(botId, 'standard')` SHALL switch back. Switching tier SHALL clamp current tokens to the new capacity. A bot's first bucket SHALL start full.

#### Scenario: Within limit

- **WHEN** `acquireSendSlot('lingual')` is called 20 times in quick succession on a new `standard` channel
- **THEN** all 20 return `{ ok: true }`

#### Scenario: Limit exceeded

- **WHEN** a 21st call is made immediately after
- **THEN** it returns `{ ok: false, retryAfterMs }` with `retryAfterMs` approximately 1500

#### Scenario: Refill over time

- **WHEN** 30 seconds elapse after the bucket is emptied
- **THEN** 20 further calls succeed

#### Scenario: Moderator tier

- **WHEN** `setSendTier('lingual', 'moderator')` is called on a channel with a full bucket
- **THEN** after refill the bucket allows up to 100 sends per 30 seconds

### Requirement: TwitchChannel requests Twitch work through the queue

`TwitchChannel` SHALL have a queue producer binding `TWITCH_EVENTS` to the `twitch-events` queue and SHALL request all Twitch API work by sending messages `{ kind: 'subscribe' | 'unsubscribe' | 'reconcile', broadcasterId, botId }`. It SHALL continue to make no direct Twitch API calls. The `broadcasterId` SHALL be derived from the DO name (`twitch:{broadcasterId}`).

#### Scenario: No direct Twitch calls

- **WHEN** any `TwitchChannel` method or scheduled job runs
- **THEN** no request is made to `api.twitch.tv` or `id.twitch.tv`

### Requirement: Enable and disable enqueue subscription work

`enableBot(botId)` SHALL, when transitioning from disabled to enabled, schedule a one-shot `request-subscribe:<botId>` job (due immediately, idempotency key `request-subscribe:<botId>`) and register the recurring `reconcile-subscription:<botId>` job. `disableBot(botId)` SHALL, when transitioning from enabled to disabled, schedule a one-shot `request-unsubscribe:<botId>` job and cancel that bot's reconcile job. Each request SHALL cancel a pending request of the opposite kind for the same bot. The request jobs SHALL send `{ kind: 'subscribe' | 'unsubscribe', broadcasterId, botId }` to the queue, retrying with the scheduler's backoff if the send fails. Calls that do not change state SHALL request nothing.

#### Scenario: Enable

- **WHEN** `enableBot('lingual')` is called on a disabled channel and the alarm runs
- **THEN** one `subscribe` message with `botId: 'lingual'` is enqueued and Lingual's reconcile job is scheduled

#### Scenario: Repeat enable

- **WHEN** `enableBot('lingual')` is called on an already-enabled channel
- **THEN** nothing is enqueued

#### Scenario: Disable

- **WHEN** `disableBot('lingual')` is called on an enabled channel and the alarm runs
- **THEN** one `unsubscribe` message with `botId: 'lingual'` is enqueued and Lingual's reconcile job is removed

#### Scenario: Enable then disable before the alarm

- **WHEN** `enableBot('lingual')` then `disableBot('lingual')` are called before the alarm runs
- **THEN** only `unsubscribe` is enqueued

#### Scenario: Queue send fails

- **WHEN** the queue send for a request fails
- **THEN** the request job retries with backoff until the send succeeds

### Requirement: Recurring subscription reconcile

While a bot is enabled, `TwitchChannel` SHALL run a cron job `reconcile-subscription:<botId>` every 6 hours (`0 */6 * * *`) whose handler enqueues `{ kind: 'reconcile', broadcasterId, botId }`.

#### Scenario: Reconcile fires

- **WHEN** Lingual's reconcile cron fires for a channel where Lingual is enabled
- **THEN** one `reconcile` message with `botId: 'lingual'` is enqueued

## REMOVED Requirements

### Requirement: Lingual settings storage

**Reason**: Lingual's settings move out of `TwitchChannel`'s core schema into the `Lingual` plugin.
**Migration**: Use `channel.lingual().getSettings()` / `setSettings()`. See "Lingual plugin settings". Existing rows are dropped, and settings are re-entered after deploy.
