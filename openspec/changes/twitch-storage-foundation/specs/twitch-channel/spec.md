## ADDED Requirements

### Requirement: Per-broadcaster TwitchChannel Durable Object

The storage worker SHALL provide a SQLite-backed `TwitchChannel` Durable Object extending `DurableObject<Env>`, addressed by `idFromName("twitch:{broadcasterId}")` where `broadcasterId` is the Twitch user id of the channel owner. It SHALL run its schema via `migrate(sql, twitchChannelMigrations, '_twitch_channel_version')` and construct a `JobScheduler` with a private handler. It SHALL make no outbound Twitch API calls.

#### Scenario: Addressing

- **WHEN** a binder needs state for broadcaster `12345`
- **THEN** it obtains the stub via `env.TWITCH_CHANNEL.get(env.TWITCH_CHANNEL.idFromName("twitch:12345"))`

#### Scenario: Constructor runs migrations

- **WHEN** a `TwitchChannel` is constructed for the first time
- **THEN** its tables and the scheduler's `jobs` table exist

### Requirement: Bot enablement state

`TwitchChannel` SHALL store whether the translation bot is enabled for the channel. `getBot()` SHALL return `{ enabled, enabledAt, updatedAt }` (`enabled: false` and `enabledAt: null` when never enabled). `enableBot()` SHALL set `enabled` true and record `enabledAt` if previously disabled; `disableBot()` SHALL set `enabled` false. Both SHALL update `updatedAt`.

#### Scenario: Default state

- **WHEN** `getBot()` is called on a new channel
- **THEN** it returns `{ enabled: false, enabledAt: null, ... }`

#### Scenario: Enable then disable

- **WHEN** `enableBot()` then `disableBot()` are called
- **THEN** `getBot().enabled` is false and `enabledAt` still holds the enable time

### Requirement: EventSub subscription record

`TwitchChannel` SHALL store at most one EventSub subscription record per subscription type: `{ type, subscriptionId, status, updatedAt }`. `setSubscription(type, subscriptionId, status)` SHALL upsert the record; `getSubscription(type)` SHALL return it or `null`; `clearSubscription(type)` SHALL remove it. `status` SHALL be stored as the string Twitch reports (e.g. `enabled`, `webhook_callback_verification_pending`, `authorization_revoked`).

#### Scenario: Record a subscription

- **WHEN** `setSubscription('channel.chat.message', 'abc', 'webhook_callback_verification_pending')` is called
- **THEN** `getSubscription('channel.chat.message')` returns that id and status

#### Scenario: Status update

- **WHEN** `setSubscription('channel.chat.message', 'abc', 'enabled')` is called for an existing record
- **THEN** the status becomes `enabled` and `updatedAt` advances

#### Scenario: Revocation clears

- **WHEN** `clearSubscription('channel.chat.message')` is called
- **THEN** `getSubscription('channel.chat.message')` returns `null`

### Requirement: EventSub message dedupe

`TwitchChannel` SHALL provide `claimMessage(messageId)` that returns `true` the first time a given id is claimed and `false` on every subsequent claim within the dedupe window (15 minutes). The claim SHALL be a single atomic statement; a claim older than the window SHALL be treated as new. Each claim SHALL schedule a one-shot `prune-dedupe` job 15 minutes out under the idempotency key `prune-dedupe`, so at most one is ever queued. The job SHALL delete claims older than the window and, if any claims remain, reschedule itself for when the oldest remaining claim expires. A channel with no claims SHALL have no pending prune job (no perpetual alarm).

#### Scenario: First claim

- **WHEN** `claimMessage('m1')` is called for the first time
- **THEN** it returns `true`

#### Scenario: Duplicate delivery

- **WHEN** `claimMessage('m1')` is called again within 15 minutes
- **THEN** it returns `false`

#### Scenario: Expired claim

- **WHEN** `claimMessage('m1')` is called 15 minutes or more after the first claim
- **THEN** it returns `true`

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

`TwitchChannel` SHALL rate-limit outbound chat sends with a lazily-refilled token bucket. `acquireSendSlot()` SHALL refill tokens by elapsed time at the tier's rate, then either consume one token and return `{ ok: true }`, or return `{ ok: false, retryAfterMs }` with the milliseconds until one token is available. The default tier SHALL be `standard` (capacity 20, refill 20 per 30 seconds); `setSendTier('moderator')` SHALL switch to capacity 100, refill 100 per 30 seconds; `setSendTier('standard')` SHALL switch back. Switching tier SHALL clamp current tokens to the new capacity. A new channel SHALL start with a full bucket.

#### Scenario: Within limit

- **WHEN** `acquireSendSlot()` is called 20 times in quick succession on a new `standard` channel
- **THEN** all 20 return `{ ok: true }`

#### Scenario: Limit exceeded

- **WHEN** a 21st call is made immediately after
- **THEN** it returns `{ ok: false, retryAfterMs }` with `retryAfterMs` approximately 1500

#### Scenario: Refill over time

- **WHEN** 30 seconds elapse after the bucket is emptied
- **THEN** 20 further calls succeed

#### Scenario: Moderator tier

- **WHEN** `setSendTier('moderator')` is called on a channel with a full bucket
- **THEN** after refill the bucket allows up to 100 sends per 30 seconds

### Requirement: RPC surface is serializable and minimal

Every public method on `TwitchChannel` SHALL return an `Rpc.Serializable` value (plain objects, primitives, `null`). The scheduler handler and internal helpers SHALL NOT be reachable as RPC methods.

#### Scenario: No scheduler on RPC surface

- **WHEN** a binder inspects the `DurableObjectStub<TwitchChannel>` type
- **THEN** no `scheduled`, `alarm`-handler, or job-processing method is available other than the runtime `alarm()` lifecycle method
