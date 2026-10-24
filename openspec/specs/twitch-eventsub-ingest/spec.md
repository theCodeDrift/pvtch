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

For message type `webhook_callback_verification`, the handler SHALL respond HTTP 200 with `Content-Type: text/plain` and the body's `challenge` value exactly. If the subscription's condition includes a `broadcaster_user_id`, it SHALL call `setSubscription(type, id, 'enabled')` on that broadcaster's `TwitchChannel`.

#### Scenario: Challenge response

- **WHEN** a verified `webhook_callback_verification` arrives with `challenge: "abc123"`
- **THEN** the response is HTTP 200, `text/plain`, body `abc123`

### Requirement: Revocation handled inline

For message type `revocation`, the handler SHALL call `clearSubscription(type)` on the affected broadcaster's `TwitchChannel`, and additionally `disableBot()` when the status is `authorization_revoked` or `user_removed`. It SHALL respond HTTP 204. Other statuses (e.g. `notification_failures_exceeded`, `version_removed`) SHALL leave the bot enabled so the reconcile job recreates the subscription.

#### Scenario: Broadcaster revokes authorization

- **WHEN** a verified revocation with status `authorization_revoked` arrives for broadcaster `123`
- **THEN** `TwitchChannel(twitch:123)` has no subscription and `getBot().enabled` is false

#### Scenario: Delivery failures revoke subscription

- **WHEN** a verified revocation with status `notification_failures_exceeded` arrives for broadcaster `123`
- **THEN** the subscription record is cleared and the bot remains enabled

### Requirement: Notifications are enqueued then acknowledged

For message type `notification`, the handler SHALL send `{ kind: 'event', messageId, subscriptionType, timestamp, event }` to the `twitch-events` queue and respond HTTP 204 only after the send resolves. If the queue send fails, it SHALL respond HTTP 500 so Twitch retries.

#### Scenario: Chat message notification

- **WHEN** a verified `channel.chat.message` notification arrives
- **THEN** one queue message is sent and the response is HTTP 204

#### Scenario: Queue unavailable

- **WHEN** the queue send rejects
- **THEN** the response is HTTP 500

### Requirement: Queue consumer with dedupe and dead-lettering

The `twitch-events` consumer SHALL run with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, and dead-letter queue `twitch-events-dlq`. For `kind: 'event'` messages it SHALL call `claimMessage(messageId)` on the relevant `TwitchChannel` (the broadcaster for chat events; the revoked user for `user.authorization.revoke`) and SHALL ack without processing when the claim returns `false`. Messages are dispatched by `kind` (`event`, `subscribe`, `unsubscribe`, `reconcile`) and, for events, by `subscriptionType`; unknown kinds or types SHALL be logged and acked.

#### Scenario: Duplicate delivery

- **WHEN** the same `messageId` is consumed twice
- **THEN** the second is acked without calling the lingo pipeline or Helix

#### Scenario: Unknown subscription type

- **WHEN** an event with an unhandled `subscriptionType` is consumed
- **THEN** it is logged and acked

### Requirement: Admin status diagnostics

`GET /admin/status` SHALL be restricted to `ADMIN_USERS` and SHALL be read-only. It SHALL return JSON with the app's EventSub subscriptions as Twitch reports them (`GET /helix/eventsub/subscriptions`) alongside the broadcaster's `TwitchChannel` state (bot state, chat subscription record, Lingual settings). The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` requests `/admin/status`
- **THEN** the response is HTTP 403
