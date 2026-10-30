## MODIFIED Requirements

### Requirement: Queue consumer with dedupe and dead-lettering

The `twitch-events` consumer SHALL run only in `pvtch-twitch`, with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, and dead-letter queue `twitch-events-dlq`. For each message it SHALL parse the body, resolve the channel (the broadcaster for chat events, the revoked user for `user.authorization.revoke`, `broadcasterId` for `subscribe` / `unsubscribe` / `reconcile`), and call `routeMessage` on that `TwitchChannel` before any processing. It SHALL pass the `messageId` for `kind: 'event'` messages on their first attempt and `null` otherwise. It SHALL ack without processing when `fresh` is `false`. It SHALL then process the message through `processQueueMessage` locally when the pool is `stable`, or through the `TWITCH_NEXT` service binding when the pool is `experimental`. It SHALL apply the returned `Outcome`, and a thrown error SHALL retry. `processQueueMessage` SHALL NOT claim messages. It dispatches by `kind` (`event`, `subscribe`, `unsubscribe`, `reconcile`) and, for events, by `subscriptionType`. Unknown kinds or types SHALL be logged and acked.

#### Scenario: Duplicate delivery

- **WHEN** the same `messageId` is consumed twice
- **THEN** the second is acked without calling the lingo pipeline or Helix, whichever pool the channel is in

#### Scenario: Unknown subscription type

- **WHEN** an event with an unhandled `subscriptionType` is consumed
- **THEN** it is logged and acked

#### Scenario: Retry re-reads the pool

- **WHEN** a message for an experimental channel is retried after the channel was set back to `stable`
- **THEN** the retry is processed locally by `pvtch-twitch` without claiming

### Requirement: Admin status diagnostics

`GET /admin/status` SHALL be restricted to `ADMIN_USERS` and SHALL be read-only. It SHALL return JSON with the app's EventSub subscriptions as Twitch reports them (`GET /helix/eventsub/subscriptions`) alongside the broadcaster's `TwitchChannel` state (bot state, chat subscription record, Lingual settings, pool). The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` requests `/admin/status`
- **THEN** the response is HTTP 403

#### Scenario: Pool shown

- **WHEN** an admin requests `/admin/status` for an experimental channel
- **THEN** the JSON includes `channel.pool: 'experimental'`

## ADDED Requirements

### Requirement: Admin pool toggle

`/admin/pool` on `pvtch-twitch` SHALL be restricted to `ADMIN_USERS`. `GET` SHALL show the broadcaster's current pool and a form to change it. `POST` with form field `pool` set to `stable` or `experimental` SHALL call `setPool` and return the new pool as JSON. Any other value SHALL return HTTP 400. The broadcaster defaults to the admin's own user id and can be overridden with `?broadcaster=<user id>`.

#### Scenario: Move a channel to experimental

- **WHEN** an admin POSTs `pool=experimental` for broadcaster `12345`
- **THEN** the next queue message for `12345` is processed by `pvtch-twitch-next`

#### Scenario: Return a channel to production

- **WHEN** an admin POSTs `pool=stable` for broadcaster `12345`
- **THEN** the next queue message for `12345` is processed by `pvtch-twitch`, with no deploy

#### Scenario: Non-admin

- **WHEN** a logged-in user not in `ADMIN_USERS` POSTs to `/admin/pool`
- **THEN** the response is HTTP 403 and the pool is unchanged

#### Scenario: Invalid pool

- **WHEN** an admin POSTs `pool=beta`
- **THEN** the response is HTTP 400 and the pool is unchanged
