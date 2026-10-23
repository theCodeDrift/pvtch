## ADDED Requirements

### Requirement: TwitchChannel requests Twitch work through the queue

`TwitchChannel` SHALL have a queue producer binding `TWITCH_EVENTS` to the `twitch-events` queue and SHALL request all Twitch API work by sending messages `{ kind: 'subscribe' | 'unsubscribe' | 'reconcile', broadcasterId }`. It SHALL continue to make no direct Twitch API calls. The `broadcasterId` SHALL be derived from the DO name (`twitch:{broadcasterId}`).

#### Scenario: No direct Twitch calls

- **WHEN** any `TwitchChannel` method or scheduled job runs
- **THEN** no request is made to `api.twitch.tv` or `id.twitch.tv`

### Requirement: Enable and disable enqueue subscription work

`enableBot()` SHALL, when transitioning from disabled to enabled, enqueue `{ kind: 'subscribe' }` and register the recurring `reconcile-subscription` job. `disableBot()` SHALL, when transitioning from enabled to disabled, enqueue `{ kind: 'unsubscribe' }` and cancel the `reconcile-subscription` job. Calls that do not change state SHALL enqueue nothing.

#### Scenario: Enable

- **WHEN** `enableBot()` is called on a disabled channel
- **THEN** one `subscribe` message is enqueued and the reconcile job is scheduled

#### Scenario: Repeat enable

- **WHEN** `enableBot()` is called on an already-enabled channel
- **THEN** nothing is enqueued

#### Scenario: Disable

- **WHEN** `disableBot()` is called on an enabled channel
- **THEN** one `unsubscribe` message is enqueued and the reconcile job is removed

### Requirement: Recurring subscription reconcile

While the bot is enabled, `TwitchChannel` SHALL run a cron job `reconcile-subscription` every 6 hours (`0 */6 * * *`) whose handler enqueues `{ kind: 'reconcile', broadcasterId }`.

#### Scenario: Reconcile fires

- **WHEN** the reconcile cron fires for an enabled channel
- **THEN** one `reconcile` message is enqueued
