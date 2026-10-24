## ADDED Requirements

### Requirement: TwitchChannel requests Twitch work through the queue

`TwitchChannel` SHALL have a queue producer binding `TWITCH_EVENTS` to the `twitch-events` queue and SHALL request all Twitch API work by sending messages `{ kind: 'subscribe' | 'unsubscribe' | 'reconcile', broadcasterId }`. It SHALL continue to make no direct Twitch API calls. The `broadcasterId` SHALL be derived from the DO name (`twitch:{broadcasterId}`).

#### Scenario: No direct Twitch calls

- **WHEN** any `TwitchChannel` method or scheduled job runs
- **THEN** no request is made to `api.twitch.tv` or `id.twitch.tv`

### Requirement: Enable and disable enqueue subscription work

`enableBot()` SHALL, when transitioning from disabled to enabled, schedule a one-shot `request-subscribe` job (due immediately, idempotency key `request-subscribe`) and register the recurring `reconcile-subscription` job. `disableBot()` SHALL, when transitioning from enabled to disabled, schedule a one-shot `request-unsubscribe` job and cancel the `reconcile-subscription` job. Each request SHALL cancel a pending request of the opposite kind. The request jobs SHALL send `{ kind: 'subscribe' | 'unsubscribe', broadcasterId }` to the queue, retrying with the scheduler's backoff if the send fails. Calls that do not change state SHALL request nothing.

#### Scenario: Enable

- **WHEN** `enableBot()` is called on a disabled channel and the alarm runs
- **THEN** one `subscribe` message is enqueued and the reconcile job is scheduled

#### Scenario: Repeat enable

- **WHEN** `enableBot()` is called on an already-enabled channel
- **THEN** nothing is enqueued

#### Scenario: Disable

- **WHEN** `disableBot()` is called on an enabled channel and the alarm runs
- **THEN** one `unsubscribe` message is enqueued and the reconcile job is removed

#### Scenario: Enable then disable before the alarm

- **WHEN** `enableBot()` then `disableBot()` are called before the alarm runs
- **THEN** only `unsubscribe` is enqueued

#### Scenario: Queue send fails

- **WHEN** the queue send for a request fails
- **THEN** the request job retries with backoff until the send succeeds

### Requirement: Recurring subscription reconcile

While the bot is enabled, `TwitchChannel` SHALL run a cron job `reconcile-subscription` every 6 hours (`0 */6 * * *`) whose handler enqueues `{ kind: 'reconcile', broadcasterId }`.

#### Scenario: Reconcile fires

- **WHEN** the reconcile cron fires for an enabled channel
- **THEN** one `reconcile` message is enqueued

### Requirement: Lingual settings storage

`TwitchChannel` SHALL store Lingual's settings in a single-row `lingual_settings` table added by a schema migration: `language` (nullable) and `ignored_chatters` (a JSON array). `getLingualSettings()` SHALL return `{ language: null, ignoredChatters: [] }` when nothing is saved. `setLingualSettings()` SHALL replace both values, lowercasing the language (an empty one clears it) and lowercasing, stripping a leading `@` from, and de-duplicating chatter logins. Callers SHALL validate the language.

#### Scenario: Defaults

- **WHEN** `getLingualSettings()` is called on a channel that never saved settings
- **THEN** it returns `{ language: null, ignoredChatters: [] }`

#### Scenario: Normalization

- **WHEN** `setLingualSettings({ language: ' Spanish ', ignoredChatters: ['@StreamElements', 'nightbot', 'NIGHTBOT'] })` is called
- **THEN** the stored settings are `{ language: 'spanish', ignoredChatters: ['streamelements', 'nightbot'] }`
