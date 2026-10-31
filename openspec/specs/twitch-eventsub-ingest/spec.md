# twitch-eventsub-ingest Specification

## Purpose

The `pvtch-twitch` worker on `twitch.pvtch.com`: EventSub webhook verification, inline challenge and revocation handling, enqueueing notifications to `twitch-events`, the queue consumer, and admin routes.

## Requirements

### Requirement: Twitch worker on its own domain

The system SHALL provide a Cloudflare worker at `workers/twitch` (package `@pvtch/twitch`, script `pvtch-twitch`) served on the custom domain `twitch.pvtch.com`. It SHALL expose `POST /eventsub`, `GET /bot/authorize`, `GET /bot/callback`, `GET|POST /admin/bootstrap`, and `GET /admin/status`, and SHALL return HTTP 404 for all other paths. It SHALL serve no user-facing pages.

#### Scenario: Unknown path

- **WHEN** a request is made to `https://twitch.pvtch.com/anything-else`
- **THEN** the worker responds HTTP 404

### Requirement: EventSub signature verification

`POST /eventsub` SHALL read the request body as raw text before any parsing, compute HMAC-SHA256 with `TWITCH_EVENTSUB_SECRET` over `Twitch-Eventsub-Message-Id + Twitch-Eventsub-Message-Timestamp + body` using Web Crypto, and compare it in constant time to the `Twitch-Eventsub-Message-Signature` header (format `sha256=<hex>`). Requests with a missing or mismatched signature SHALL receive HTTP 403 with an empty body and SHALL NOT be enqueued or otherwise processed.

#### Scenario: Valid signature

- **WHEN** a request arrives whose signature matches the computed HMAC
- **THEN** processing continues based on `Twitch-Eventsub-Message-Type`

#### Scenario: Invalid signature

- **WHEN** a request arrives with a signature that does not match
- **THEN** the worker responds HTTP 403 and enqueues nothing

#### Scenario: Body re-serialization is not used

- **WHEN** the body contains whitespace or key ordering that `JSON.stringify(JSON.parse(body))` would change
- **THEN** verification still succeeds because the raw text is hashed

### Requirement: Replay window

The handler SHALL reject with HTTP 403 any verified request whose `Twitch-Eventsub-Message-Timestamp` is more than 10 minutes before the current time.

#### Scenario: Stale message

- **WHEN** a correctly signed message has a timestamp 11 minutes old
- **THEN** the worker responds HTTP 403 and enqueues nothing

### Requirement: Callback verification handled inline

For message type `webhook_callback_verification`, the handler SHALL respond HTTP 200 with `Content-Type: text/plain` and the body's `challenge` value exactly. If the subscription's condition includes a `broadcaster_user_id` and its `user_id` names a registered sender (`senderForUserId`), it SHALL call `setSubscription(senderId, type, id, 'enabled')` on that broadcaster's `TwitchChannel`. A condition naming no registered sender SHALL be logged and SHALL NOT write to any `TwitchChannel`.

#### Scenario: Challenge response

- **WHEN** a verified `webhook_callback_verification` arrives with `challenge: "abc123"`
- **THEN** the response is HTTP 200, `text/plain`, body `abc123`

#### Scenario: Recorded for the sender

- **WHEN** a verified challenge arrives for a `channel.chat.message` subscription whose `condition.user_id` is botlingual
- **THEN** `getSubscription('botlingual', 'channel.chat.message')` on that broadcaster's channel has status `enabled`

### Requirement: Revocation handled inline

For message type `revocation`, the handler SHALL resolve the sender from `condition.user_id` and call `clearSubscription(senderId, type)` on the affected broadcaster's `TwitchChannel`, and additionally `disableHandler` for every handler using that sender when the status is `authorization_revoked` or `user_removed`. It SHALL respond HTTP 204. Other statuses (e.g. `notification_failures_exceeded`, `version_removed`) SHALL leave handlers enabled so the reconcile sync recreates the subscription. A condition naming no registered sender SHALL be logged and SHALL NOT write to any `TwitchChannel`.

#### Scenario: Broadcaster revokes authorization

- **WHEN** a verified revocation with status `authorization_revoked` arrives for broadcaster `123` and botlingual
- **THEN** `TwitchChannel(twitch:123)` has no botlingual subscription and `getHandler('lingual').enabled` is false

#### Scenario: Delivery failures revoke subscription

- **WHEN** a verified revocation with status `notification_failures_exceeded` arrives for broadcaster `123` and botlingual
- **THEN** the subscription record is cleared and `lingual` remains enabled

### Requirement: Notifications are enqueued then acknowledged

For message type `notification`, the handler SHALL send `{ kind: 'event', messageId, subscriptionType, condition, timestamp, event }` to the `twitch-events` queue, where `condition` is the notification's `subscription.condition`, and respond HTTP 204 only after the send resolves. It SHALL NOT call any Durable Object or route the event before responding. If the queue send fails, it SHALL respond HTTP 500 so Twitch retries.

#### Scenario: Chat message notification

- **WHEN** a verified `channel.chat.message` notification arrives
- **THEN** one queue message including the subscription's `condition` is sent and the response is HTTP 204

#### Scenario: Queue unavailable

- **WHEN** the queue send rejects
- **THEN** the response is HTTP 500

### Requirement: Queue consumer with dedupe and dead-lettering

The `twitch-events` consumer in `pvtch-twitch` SHALL run with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, and dead-letter queue `twitch-events-dlq`. It SHALL dispatch by `kind`: `event` to the router (see `twitch-event-fanout`), `sync` to the subscription sync for that sender, and `send` to the reply sender. It SHALL apply each returned `Outcome` (ack or retry with delay), and a thrown error SHALL retry. Unknown kinds SHALL be logged and acked. `pvtch-twitch` SHALL have a producer binding for every handler queue in the registry (`LINGUAL_EVENTS` on `lingual-events`).

#### Scenario: Duplicate delivery

- **WHEN** the same `messageId` is consumed twice
- **THEN** the second is acked without sending a handler message

#### Scenario: Unknown kind

- **WHEN** a message with an unrecognized `kind` is consumed
- **THEN** it is logged and acked

### Requirement: Admin status diagnostics

`GET /admin/status` SHALL be restricted to `ADMIN_USERS` and SHALL be read-only. It SHALL return JSON with the app's EventSub subscriptions as Twitch reports them (`GET /helix/eventsub/subscriptions`) alongside the broadcaster's `TwitchChannel` state: each registered handler's state, each registered sender's subscription records, Lingual's settings, and the channel's flags. The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` requests `/admin/status`
- **THEN** the response is HTTP 403

#### Scenario: Handler and sender state

- **WHEN** an admin requests `/admin/status` for a channel with `lingual` enabled
- **THEN** the JSON includes `lingual`'s state and botlingual's `channel.chat.message` subscription record

### Requirement: Admin feature flags

`/admin/flags` on `pvtch-twitch` SHALL be restricted to `ADMIN_USERS`. `GET` SHALL list the broadcaster's flags with a form to change one. `POST` with form fields `name` (matching `<handlerId>.<feature>` for a registered handler) and `on` (`true` or `false`) SHALL call `flags().set(name, on)` and return the new list as JSON. An invalid name SHALL return HTTP 400. The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Turn a flag on

- **WHEN** an admin POSTs `name=lingual.reply-threading&on=true` for broadcaster `12345`
- **THEN** the next event fanned out to `lingual` for `12345` carries that flag

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` POSTs to `/admin/flags`
- **THEN** the response is HTTP 403 and no flag changes

#### Scenario: Invalid name

- **WHEN** an admin POSTs `name=unknown.thing`
- **THEN** the response is HTTP 400 and no flag changes
