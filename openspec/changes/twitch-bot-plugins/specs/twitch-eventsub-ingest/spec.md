## MODIFIED Requirements

### Requirement: Callback verification handled inline

For message type `webhook_callback_verification`, the handler SHALL respond HTTP 200 with `Content-Type: text/plain` and the body's `challenge` value exactly. If the subscription's condition includes a `broadcaster_user_id` and its `user_id` names a registered bot (`botForUserId`), it SHALL call `setSubscription(botId, type, id, 'enabled')` on that broadcaster's `TwitchChannel`. A condition naming no registered bot SHALL be logged and SHALL NOT write to any `TwitchChannel`.

#### Scenario: Challenge response

- **WHEN** a verified `webhook_callback_verification` arrives with `challenge: "abc123"`
- **THEN** the response is HTTP 200, `text/plain`, body `abc123`

#### Scenario: Recorded for the bot

- **WHEN** a verified challenge arrives for a `channel.chat.message` subscription whose `condition.user_id` is Lingual's account
- **THEN** `getSubscription('lingual', 'channel.chat.message')` on that broadcaster's channel has status `enabled`

### Requirement: Revocation handled inline

For message type `revocation`, the handler SHALL resolve the bot from `condition.user_id` and call `clearSubscription(botId, type)` on the affected broadcaster's `TwitchChannel`, and additionally `disableBot(botId)` when the status is `authorization_revoked` or `user_removed`. It SHALL respond HTTP 204. Other statuses (e.g. `notification_failures_exceeded`, `version_removed`) SHALL leave the bot enabled so the reconcile job recreates the subscription. A condition naming no registered bot SHALL be logged and SHALL NOT write to any `TwitchChannel`.

#### Scenario: Broadcaster revokes authorization

- **WHEN** a verified revocation with status `authorization_revoked` arrives for broadcaster `123` and Lingual's account
- **THEN** `TwitchChannel(twitch:123)` has no Lingual subscription and `getBot('lingual').enabled` is false

#### Scenario: Delivery failures revoke subscription

- **WHEN** a verified revocation with status `notification_failures_exceeded` arrives for broadcaster `123` and Lingual's account
- **THEN** the Lingual subscription record is cleared and Lingual remains enabled

### Requirement: Notifications are enqueued then acknowledged

For message type `notification`, the handler SHALL send `{ kind: 'event', messageId, subscriptionType, condition, timestamp, event }` to the `twitch-events` queue, where `condition` is the notification's `subscription.condition`, and respond HTTP 204 only after the send resolves. If the queue send fails, it SHALL respond HTTP 500 so Twitch retries.

#### Scenario: Chat message notification

- **WHEN** a verified `channel.chat.message` notification arrives
- **THEN** one queue message including the subscription's `condition` is sent and the response is HTTP 204

#### Scenario: Queue unavailable

- **WHEN** the queue send rejects
- **THEN** the response is HTTP 500

### Requirement: Queue consumer with dedupe and dead-lettering

The `twitch-events` consumer SHALL run with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, and dead-letter queue `twitch-events-dlq`. Work messages (`subscribe`, `unsubscribe`, `reconcile`) SHALL be handled by the subscription flows for their `botId`. A `kind: 'event'` message SHALL be routed in five steps:

1. **Tracked:** if `subscriptionType` is neither in a registered bot's `eventTypes` nor a channel-level type (`user.authorization.revoke`), it SHALL be logged and acked.
2. **Who for:** the channel SHALL be resolved from the event (the broadcaster for chat events; the revoked user for `user.authorization.revoke`) and, for bot event types, the bot from `botForUserId(condition.user_id)`. An unknown bot SHALL be logged and acked.
3. **Supported:** the consumer SHALL call `routeEvent` on that channel's `TwitchChannel`, passing the `messageId` on the first attempt and `null` on retries, and SHALL ack without processing when `fresh` is `false` or `bots` is empty.
4. **Route:** it SHALL call the handler of each bot in `bots`, or the channel-level handler, with `{ env, channel, botId, event, timestamp, flags }`.
5. **Act:** handlers SHALL read the DO state they need themselves and return an `Outcome`. The consumer SHALL ack when every handler acks, and otherwise retry with the largest requested delay. A thrown error SHALL retry.

Unknown kinds SHALL be logged and acked.

#### Scenario: Duplicate delivery

- **WHEN** the same `messageId` is consumed twice
- **THEN** the second is acked without calling the lingo pipeline or Helix

#### Scenario: Unknown subscription type

- **WHEN** an event with an untracked `subscriptionType` is consumed
- **THEN** it is logged and acked without calling `routeEvent`

#### Scenario: Bot not enabled on the channel

- **WHEN** a `channel.chat.message` event for Lingual's account arrives for a channel where Lingual is disabled
- **THEN** it is acked without calling the Lingual handler

#### Scenario: Flags reach the handler

- **WHEN** a channel has `lingual.reply-threading` on and a chat event for Lingual is consumed
- **THEN** the Lingual handler receives `flags` containing `lingual.reply-threading`

### Requirement: Admin status diagnostics

`GET /admin/status` SHALL be restricted to `ADMIN_USERS` and SHALL be read-only. It SHALL return JSON with the app's EventSub subscriptions as Twitch reports them (`GET /helix/eventsub/subscriptions`) alongside the broadcaster's `TwitchChannel` state: for each registered bot its state and subscription records, Lingual's settings, and the channel's flags. The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` requests `/admin/status`
- **THEN** the response is HTTP 403

#### Scenario: Per-bot state

- **WHEN** an admin requests `/admin/status` for a channel with Lingual enabled
- **THEN** the JSON includes Lingual's bot state and its `channel.chat.message` subscription record

## ADDED Requirements

### Requirement: Admin feature flags

`/admin/flags` on `pvtch-twitch` SHALL be restricted to `ADMIN_USERS`. `GET` SHALL list the broadcaster's flags with a form to change one. `POST` with form fields `name` (matching `<botId>.<feature>` for a registered bot) and `on` (`true` or `false`) SHALL call `flags().set(name, on)` and return the new list as JSON. An invalid name SHALL return HTTP 400. The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Turn a flag on

- **WHEN** an admin POSTs `name=lingual.reply-threading&on=true` for broadcaster `12345`
- **THEN** the next Lingual event for `12345` is handled with that flag in `flags`

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` POSTs to `/admin/flags`
- **THEN** the response is HTTP 403 and no flag changes

#### Scenario: Invalid name

- **WHEN** an admin POSTs `name=unknownbot.thing`
- **THEN** the response is HTTP 400 and no flag changes
