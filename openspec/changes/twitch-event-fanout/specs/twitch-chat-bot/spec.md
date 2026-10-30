## MODIFIED Requirements

### Requirement: Periodic reconcile

When `pvtch-twitch` consumes `{ kind: 'sync', broadcasterId, senderId }`, it SHALL compute the desired subscription types as the union of `eventTypes` over the channel's enabled handlers (`listHandlers()`) whose registry `sender` is `senderId`. For each desired type whose stored subscription is missing, or which Helix (`GET /eventsub/subscriptions?subscription_id=`) reports absent or in any status other than `enabled` / `webhook_callback_verification_pending`, it SHALL create a v1 webhook subscription with condition `{ broadcaster_user_id: broadcasterId, user_id: TWITCH_SENDERS[senderId].userId }`, callback `https://twitch.pvtch.com/eventsub`, and secret `TWITCH_EVENTSUB_SECRET`, and record it via `setSubscription(senderId, type, id, status)`. On 409 it SHALL look up the existing subscription and record it; on 403 it SHALL disable every handler using `senderId` and ack. For each stored type that is no longer desired, it SHALL delete the subscription via Helix (treating 404 as success) and call `clearSubscription(senderId, type)`.

#### Scenario: Handler enabled

- **WHEN** a sync for `botlingual` runs on a channel where `lingual` was just enabled
- **THEN** a `channel.chat.message` subscription for botlingual is created and recorded with status `webhook_callback_verification_pending`

#### Scenario: Handler disabled

- **WHEN** a sync for `botlingual` runs on a channel where no handler using botlingual is enabled
- **THEN** the stored subscriptions are deleted via Helix and their records cleared

#### Scenario: Recover revoked subscription

- **WHEN** a sync runs for a channel with `lingual` enabled whose subscription was revoked for `notification_failures_exceeded`
- **THEN** a new subscription is created and recorded

#### Scenario: Healthy subscription

- **WHEN** a sync runs and Helix reports the stored subscription `enabled`
- **THEN** no Helix write occurs

#### Scenario: Missing authorization

- **WHEN** Twitch responds 403 to the create call
- **THEN** every handler using that sender is disabled on the channel and the message is acked

### Requirement: App-level authorization revoke subscription

The twitch worker SHALL maintain one `user.authorization.revoke` webhook subscription with condition `{ client_id: TWITCH_CLIENT_ID }`, created via `POST /admin/bootstrap` (restricted to sessions whose login is in `ADMIN_USERS`; empty allows no one). It is a channel-level event type handled in `pvtch-twitch`. Its handler SHALL call `disableHandler` on that user's `TwitchChannel` for every handler `routeEvent` returns (each schedules a sync that removes its subscriptions) and clear `scopes` on the user's `twitch-data-{userId}` record in `PVTCH_ACCOUNTS`.

#### Scenario: Streamer disconnects pvtch

- **WHEN** a `user.authorization.revoke` event arrives for user `123` with `lingual` enabled
- **THEN** `TwitchChannel(twitch:123)` has `lingual` disabled and a sync for `botlingual` is enqueued

### Requirement: Event filtering and loop prevention

The router SHALL NOT fan out a `channel.chat.message` whose `chatter_user_id` is any registered sender's `userId`, so no handler ever sees a pvtch bot's own message. Content filters (known bots, ignored chatters, commands, Shared Chat) SHALL be applied by the handler worker that owns the feature.

#### Scenario: Bot's own message

- **WHEN** an event's `chatter_user_id` is botlingual
- **THEN** no handler message is sent

#### Scenario: Another pvtch bot's message

- **WHEN** an event's `chatter_user_id` is any registered sender
- **THEN** no handler message is sent

### Requirement: Send tier follows the bot's moderator status

When the router consumes a `channel.chat.message` whose `chatter_user_id` equals the `userId` of the subscription's own sender, it SHALL inspect the event's `badges` before dropping it, and call `setSendTier(senderId, 'moderator')` if a badge with `set_id` of `moderator`, `lead_moderator`, or `broadcaster` is present, otherwise `setSendTier(senderId, 'standard')`. No bot user token or additional scope SHALL be required.

#### Scenario: Bot is modded

- **WHEN** botlingual's own reply arrives as an event with a `moderator` badge
- **THEN** botlingual's send tier on that channel becomes `moderator`

#### Scenario: Bot is unmodded

- **WHEN** botlingual's own reply arrives with no moderator badge on a channel whose botlingual tier is `moderator`
- **THEN** botlingual's send tier becomes `standard`

### Requirement: Rate-limited reply sending

When `pvtch-twitch` consumes `{ kind: 'send', broadcasterId, senderId, handlerId, message, replyParentMessageId, timestamp }`, it SHALL: (1) ack without sending if `timestamp` is more than 60 seconds old; (2) call `acquireSendSlot(senderId)` and, on `{ ok: false, retryAfterMs }`, retry the queue message with `delaySeconds = ceil(retryAfterMs / 1000)`; (3) call `POST /helix/chat/messages` with `broadcaster_id`, `sender_id: TWITCH_SENDERS[senderId].userId`, `message`, and `reply_parent_message_id`. On HTTP 429 it SHALL retry with delay derived from the `Ratelimit-Reset` header; on 5xx it SHALL retry with default backoff; on 403 it SHALL disable every handler using `senderId` and ack; on 200 with `is_sent: false` it SHALL log `drop_reason.code` with the `handlerId` and ack without retry.

#### Scenario: Successful reply

- **WHEN** a `send` request is consumed and a slot is available
- **THEN** a threaded reply is posted as botlingual and the queue message acked

#### Scenario: Local bucket empty

- **WHEN** `acquireSendSlot('botlingual')` returns `{ ok: false, retryAfterMs: 1500 }`
- **THEN** the queue message is retried with `delaySeconds: 2` and Helix is not called

#### Scenario: Helix rate limited

- **WHEN** Helix responds 429 with `Ratelimit-Reset` 5 seconds in the future
- **THEN** the queue message is retried with a delay of about 5 seconds

#### Scenario: AutoMod drop

- **WHEN** Helix responds 200 with `is_sent: false` and `drop_reason.code: "msg_rejected"`
- **THEN** the drop is logged and the message acked with no retry

#### Scenario: Stale after retries

- **WHEN** a `send` is consumed more than 60 seconds after the source chat message
- **THEN** it is acked without sending

## REMOVED Requirements

### Requirement: Subscribe on enable

**Reason**: Separate subscribe and unsubscribe work is replaced by a per-sender sync that converges on the subscriptions the enabled handlers need.
**Migration**: See "Periodic reconcile". `enableHandler` schedules a sync for the handler's sender.

### Requirement: Unsubscribe on disable

**Reason**: Replaced by the per-sender sync, which deletes subscriptions no enabled handler needs.
**Migration**: See "Periodic reconcile". `disableHandler` schedules a sync for the handler's sender.
