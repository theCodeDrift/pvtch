## ADDED Requirements

### Requirement: App access token management

The twitch worker SHALL obtain a Twitch app access token via the client-credentials grant using `TWITCH_CLIENT_ID` and `TWITCH_SECRET`, cache it in `PVTCH_KV` under `twitch-app-token` with expiration `expires_in - 300` seconds, and reuse it until expiry. On a Helix HTTP 401 it SHALL fetch a new token once and retry the request once.

#### Scenario: Cached token reused

- **WHEN** two Helix calls occur within the token's lifetime
- **THEN** only one client-credentials request is made

#### Scenario: Token rejected

- **WHEN** a Helix call returns 401
- **THEN** a new token is fetched, the cache is replaced, and the call is retried once

### Requirement: Subscribe on enable

When the consumer receives `{ kind: 'subscribe', broadcasterId }`, it SHALL create a `channel.chat.message` v1 webhook subscription with condition `{ broadcaster_user_id: broadcasterId, user_id: TWITCH_BOT_USER_ID }`, callback `https://twitch.pvtch.com/eventsub`, and secret `TWITCH_EVENTSUB_SECRET`, then record it via `setSubscription('channel.chat.message', id, status)`. If Twitch returns 409 (already exists), it SHALL look up the existing subscription and record it. If Twitch returns 403 (missing `channel:bot` or bot not authorized), it SHALL call `disableBot()` and ack.

#### Scenario: Successful subscribe

- **WHEN** a subscribe message is consumed for an enabled channel
- **THEN** a subscription is created and its id is stored with status `webhook_callback_verification_pending`

#### Scenario: Missing authorization

- **WHEN** Twitch responds 403 to the create call
- **THEN** the bot is disabled for that channel and the message is acked

### Requirement: Unsubscribe on disable

When the consumer receives `{ kind: 'unsubscribe', broadcasterId }`, it SHALL delete the stored `channel.chat.message` subscription via Helix (treating 404 as success) and call `clearSubscription('channel.chat.message')`.

#### Scenario: Disable bot

- **WHEN** an unsubscribe message is consumed for a channel with a stored subscription
- **THEN** the Helix subscription is deleted and the record cleared

### Requirement: Periodic reconcile

When the consumer receives `{ kind: 'reconcile', broadcasterId }`: if the bot is disabled it SHALL ensure no subscription exists (as unsubscribe); if enabled and the stored subscription is missing, or Helix (`GET /eventsub/subscriptions?subscription_id=`) reports it absent or in any status other than `enabled` / `webhook_callback_verification_pending`, it SHALL perform the subscribe flow.

#### Scenario: Recover revoked subscription

- **WHEN** reconcile runs for an enabled channel whose subscription was revoked for `notification_failures_exceeded`
- **THEN** a new subscription is created and recorded

#### Scenario: Healthy subscription

- **WHEN** reconcile runs and Helix reports the stored subscription `enabled`
- **THEN** no Helix write occurs

### Requirement: App-level authorization revoke subscription

The twitch worker SHALL maintain one `user.authorization.revoke` webhook subscription with condition `{ client_id: TWITCH_CLIENT_ID }`, created via `POST /admin/bootstrap` (restricted to `ALLOWED_USERS` sessions). On a `user.authorization.revoke` event the consumer SHALL call `disableBot()` on that user's `TwitchChannel` (which enqueues `unsubscribe`) and clear `scopes` on the user's `twitch-data-{userId}` record in `PVTCH_ACCOUNTS`.

#### Scenario: Streamer disconnects pvtch

- **WHEN** a `user.authorization.revoke` event arrives for user `123`
- **THEN** `TwitchChannel(twitch:123)` bot is disabled and an unsubscribe is enqueued

### Requirement: Event filtering and loop prevention

For each `channel.chat.message` event the consumer SHALL skip without sending when any of: the bot is disabled for the channel; `chatter_user_id` equals `TWITCH_BOT_USER_ID`; `chatter_user_login` is in `knownBots` or the channel's configured `bots` list (case-insensitive); `message.text` starts with `!`; `source_broadcaster_user_id` is non-null and differs from `broadcaster_user_id`.

#### Scenario: Bot's own message

- **WHEN** an event's `chatter_user_id` is the pvtch bot
- **THEN** no translation or send occurs

### Requirement: Send tier follows the bot's moderator status

When the consumer receives a `channel.chat.message` event whose `chatter_user_id` equals `TWITCH_BOT_USER_ID`, it SHALL inspect the event's `badges` before skipping it, and call `setSendTier('moderator')` if a badge with `set_id` of `moderator`, `lead_moderator`, or `broadcaster` is present, otherwise `setSendTier('standard')`. No bot user token or additional scope SHALL be required.

#### Scenario: Bot is modded

- **WHEN** the bot's own reply arrives as an event with a `moderator` badge
- **THEN** the channel's send tier becomes `moderator`

#### Scenario: Bot is unmodded

- **WHEN** the bot's own reply arrives with no moderator badge on a channel whose tier is `moderator`
- **THEN** the channel's send tier becomes `standard`

#### Scenario: Shared Chat message from another channel

- **WHEN** an event has `source_broadcaster_user_id: "999"` and `broadcaster_user_id: "123"`
- **THEN** no translation or send occurs

### Requirement: Rate-limited reply sending

To reply, the consumer SHALL: (1) skip if the event `timestamp` is more than 60 seconds old; (2) call `acquireSendSlot()` and, on `{ ok: false, retryAfterMs }`, retry the queue message with `delaySeconds = ceil(retryAfterMs / 1000)`; (3) call `POST /helix/chat/messages` with `broadcaster_id`, `sender_id: TWITCH_BOT_USER_ID`, `message`, and `reply_parent_message_id` set to the event's `message_id`. On HTTP 429 it SHALL retry the queue message with delay derived from the `Ratelimit-Reset` header; on 5xx it SHALL retry with default backoff; on 403 it SHALL call `disableBot()` and ack; on 200 with `is_sent: false` it SHALL log `drop_reason.code` and ack without retry.

#### Scenario: Successful reply

- **WHEN** a translation is produced and a send slot is available
- **THEN** a threaded reply is posted and the queue message acked

#### Scenario: Local bucket empty

- **WHEN** `acquireSendSlot()` returns `{ ok: false, retryAfterMs: 1500 }`
- **THEN** the queue message is retried with `delaySeconds: 2` and Helix is not called

#### Scenario: Helix rate limited

- **WHEN** Helix responds 429 with `Ratelimit-Reset` 5 seconds in the future
- **THEN** the queue message is retried with a delay of about 5 seconds

#### Scenario: AutoMod drop

- **WHEN** Helix responds 200 with `is_sent: false` and `drop_reason.code: "msg_rejected"`
- **THEN** the drop is logged and the message acked with no retry

#### Scenario: Stale after retries

- **WHEN** a retried message is consumed more than 60 seconds after the original chat message
- **THEN** it is acked without sending
