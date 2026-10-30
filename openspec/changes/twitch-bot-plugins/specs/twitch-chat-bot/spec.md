## MODIFIED Requirements

### Requirement: Subscribe on enable

When the consumer receives `{ kind: 'subscribe', broadcasterId, botId }`, it SHALL, for each type in the bot's registry `eventTypes`, create a v1 webhook subscription with condition `{ broadcaster_user_id: broadcasterId, user_id: TWITCH_BOTS[botId].userId }`, callback `https://twitch.pvtch.com/eventsub`, and secret `TWITCH_EVENTSUB_SECRET`, then record it via `setSubscription(botId, type, id, status)`. If Twitch returns 409 (already exists), it SHALL look up the existing subscription and record it. If Twitch returns 403 (missing `channel:bot` or bot not authorized), it SHALL call `disableBot(botId)` and ack.

#### Scenario: Successful subscribe

- **WHEN** a subscribe message for `lingual` is consumed for a channel with Lingual enabled
- **THEN** a `channel.chat.message` subscription for Lingual's account is created and its id is stored under `('lingual', 'channel.chat.message')` with status `webhook_callback_verification_pending`

#### Scenario: Existing subscription

- **WHEN** Twitch responds 409 to the create call
- **THEN** the existing subscription is looked up and recorded

#### Scenario: Missing authorization

- **WHEN** Twitch responds 403 to the create call
- **THEN** that bot is disabled for the channel and the message is acked

### Requirement: Unsubscribe on disable

When the consumer receives `{ kind: 'unsubscribe', broadcasterId, botId }`, it SHALL, for each type in the bot's `eventTypes`, delete the stored subscription via Helix (treating 404 as success) and call `clearSubscription(botId, type)`.

#### Scenario: Disable bot

- **WHEN** an unsubscribe message for `lingual` is consumed for a channel with a stored Lingual subscription
- **THEN** the Helix subscription is deleted and the record cleared

### Requirement: Periodic reconcile

When the consumer receives `{ kind: 'reconcile', broadcasterId, botId }`: if that bot is disabled it SHALL ensure no subscription exists for it (as unsubscribe); if enabled and, for any of its `eventTypes`, the stored subscription is missing, or Helix (`GET /eventsub/subscriptions?subscription_id=`) reports it absent or in any status other than `enabled` / `webhook_callback_verification_pending`, it SHALL perform the subscribe flow for that type.

#### Scenario: Recover revoked subscription

- **WHEN** reconcile runs for a channel with Lingual enabled whose subscription was revoked for `notification_failures_exceeded`
- **THEN** a new subscription is created and recorded

#### Scenario: Healthy subscription

- **WHEN** reconcile runs and Helix reports the stored subscription `enabled`
- **THEN** no Helix write occurs

### Requirement: App-level authorization revoke subscription

The twitch worker SHALL maintain one `user.authorization.revoke` webhook subscription with condition `{ client_id: TWITCH_CLIENT_ID }`, created via `POST /admin/bootstrap` (restricted to sessions whose login is in `ADMIN_USERS`; empty allows no one). It is a channel-level event type. Its handler SHALL call `disableBot(botId)` on that user's `TwitchChannel` for every bot `routeEvent` returns (each enqueues its `unsubscribe`) and clear `scopes` on the user's `twitch-data-{userId}` record in `PVTCH_ACCOUNTS`.

#### Scenario: Streamer disconnects pvtch

- **WHEN** a `user.authorization.revoke` event arrives for user `123` with Lingual enabled
- **THEN** `TwitchChannel(twitch:123)` has Lingual disabled and an unsubscribe for `lingual` is enqueued

### Requirement: Event filtering and loop prevention

For each `channel.chat.message` event routed to a bot, that bot's handler SHALL skip without sending when any of: `chatter_user_id` is the `userId` of any registered bot; `chatter_user_login` is in `knownBots` or, for Lingual, the channel's `ignoredChatters` (case-insensitive); `message.text` starts with `!`; `source_broadcaster_user_id` is non-null and differs from `broadcaster_user_id`. A disabled bot SHALL never receive the event (see the consumer's routing).

#### Scenario: Bot's own message

- **WHEN** an event's `chatter_user_id` is Lingual's account
- **THEN** no translation or send occurs

#### Scenario: Another pvtch bot's message

- **WHEN** an event's `chatter_user_id` is any registered pvtch bot
- **THEN** the handler does not reply to it

### Requirement: Send tier follows the bot's moderator status

When a bot's handler receives a `channel.chat.message` event whose `chatter_user_id` equals that bot's own `userId`, it SHALL inspect the event's `badges` before skipping it, and call `setSendTier(botId, 'moderator')` if a badge with `set_id` of `moderator`, `lead_moderator`, or `broadcaster` is present, otherwise `setSendTier(botId, 'standard')`. No bot user token or additional scope SHALL be required.

#### Scenario: Bot is modded

- **WHEN** Lingual's own reply arrives as an event with a `moderator` badge
- **THEN** Lingual's send tier on that channel becomes `moderator`

#### Scenario: Bot is unmodded

- **WHEN** Lingual's own reply arrives with no moderator badge on a channel whose Lingual tier is `moderator`
- **THEN** Lingual's send tier becomes `standard`

#### Scenario: Shared Chat message from another channel

- **WHEN** an event has `source_broadcaster_user_id: "999"` and `broadcaster_user_id: "123"`
- **THEN** no translation or send occurs

### Requirement: Rate-limited reply sending

To reply, a bot's handler SHALL: (1) skip if the event `timestamp` is more than 60 seconds old; (2) call `acquireSendSlot(botId)` and, on `{ ok: false, retryAfterMs }`, return a retry `Outcome` with `delaySeconds = ceil(retryAfterMs / 1000)`; (3) call `POST /helix/chat/messages` with `broadcaster_id`, `sender_id: TWITCH_BOTS[botId].userId`, `message`, and `reply_parent_message_id` set to the event's `message_id`. On HTTP 429 it SHALL retry with delay derived from the `Ratelimit-Reset` header; on 5xx it SHALL retry with default backoff; on 403 it SHALL call `disableBot(botId)` and ack; on 200 with `is_sent: false` it SHALL log `drop_reason.code` and ack without retry.

#### Scenario: Successful reply

- **WHEN** a translation is produced and a send slot is available
- **THEN** a threaded reply is posted as Lingual's account and the queue message acked

#### Scenario: Local bucket empty

- **WHEN** `acquireSendSlot('lingual')` returns `{ ok: false, retryAfterMs: 1500 }`
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
