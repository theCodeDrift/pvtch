## ADDED Requirements

### Requirement: Handler and sender registry

`@pvtch/shared/twitch-registry` SHALL export `TWITCH_SENDERS` (`SenderId → { userId, login }`), `TWITCH_HANDLERS` (`HandlerId → { sender, eventTypes, queue }`, where `queue` names the producer binding on `pvtch-twitch`), `CHANNEL_EVENT_TYPES` (`['user.authorization.revoke']`), `senderForUserId(userId)`, and `handlersFor(type)`. It SHALL register sender `botlingual` (the bot account's user id and login) and handler `lingual` (`sender: 'botlingual'`, `eventTypes: ['channel.chat.message']`, `queue: 'LINGUAL_EVENTS'`). No two senders SHALL share a `userId`, and every handler's `sender` SHALL be a registered sender.

#### Scenario: Sender lookup

- **WHEN** `senderForUserId` is called with botlingual's user id
- **THEN** it returns `'botlingual'`

#### Scenario: Handlers for a type

- **WHEN** `handlersFor('channel.chat.message')` is called
- **THEN** it returns `['lingual']`

#### Scenario: Invalid registry

- **WHEN** two senders share a `userId`, or a handler names an unregistered sender
- **THEN** the registry's unit test fails

### Requirement: Router

The `pvtch-twitch` consumer SHALL route each `kind: 'event'` message as follows:

1. If `subscriptionType` is in neither `handlersFor(type)` nor `CHANNEL_EVENT_TYPES`, it SHALL log and ack.
2. It SHALL resolve the channel from the event (`broadcaster_user_id`; `user_id` for `user.authorization.revoke`) and, for handler types, the sender with `senderForUserId(condition.user_id)`. An unknown sender SHALL be logged and acked.
3. A `channel.chat.message` whose `chatter_user_id` is any registered sender's `userId` SHALL NOT be fanned out. When the chatter is the subscription's own sender, the router SHALL first apply the send-tier rule.
4. It SHALL call `routeEvent` on the channel's `TwitchChannel`, passing the `messageId` on the first attempt and `null` on retries, and SHALL ack when `fresh` is `false` or `handlers` is empty.
5. For handler types, it SHALL send one handler message per returned handler to that handler's queue binding. For channel-level types, it SHALL run the channel-level handler in-process.

A failed handler-queue send SHALL throw, so the event is retried.

#### Scenario: Untracked type

- **WHEN** an event of a type no handler or channel-level rule tracks is consumed
- **THEN** it is acked without calling `routeEvent`

#### Scenario: Handler disabled on the channel

- **WHEN** a `channel.chat.message` for botlingual arrives for a channel where `lingual` is disabled
- **THEN** nothing is sent to `lingual-events` and the message is acked

#### Scenario: Fan out

- **WHEN** a `channel.chat.message` for botlingual arrives for a channel where `lingual` is enabled
- **THEN** exactly one handler message is sent to `lingual-events` and the router message is acked

#### Scenario: Own message

- **WHEN** a `channel.chat.message` whose chatter is botlingual is consumed
- **THEN** no handler message is sent

#### Scenario: Fan-out send fails

- **WHEN** sending to `lingual-events` throws
- **THEN** the router message is retried, and the retry does not claim the `messageId` again

### Requirement: Handler message

A handler message SHALL be `{ kind: 'handler-event', handlerId, broadcasterId, senderId, messageId, subscriptionType, timestamp, event, flags }`, where `flags` is the list `routeEvent` returned. Its type SHALL be exported from `@pvtch/shared/twitch-queue`. It SHALL NOT carry handler settings; handlers read their own state from `TwitchChannel`.

#### Scenario: Flags carried

- **WHEN** a channel has `lingual.reply-threading` on and an event is fanned out to `lingual`
- **THEN** the handler message's `flags` contains `lingual.reply-threading`

### Requirement: Handler dedupe

Before acting on a handler message on its first attempt (`attempts === 1`), a handler worker SHALL call `claim('<handlerId>:<messageId>')` on the channel's `TwitchChannel` and SHALL ack without acting when the claim returns `false`. Retries (`attempts > 1`) SHALL NOT claim.

#### Scenario: Repeated fan-out

- **WHEN** the router fans out the same `messageId` to `lingual` twice
- **THEN** `pvtch-lingual` acts on it once

### Requirement: Send requests

Handlers SHALL send chat only by enqueuing `{ kind: 'send', broadcasterId, senderId, handlerId, message, replyParentMessageId, timestamp }` to `twitch-events`, where `timestamp` is the source event's. Handler workers SHALL NOT call Helix or hold Twitch credentials.

#### Scenario: Reply requested

- **WHEN** `pvtch-lingual` produces a translation
- **THEN** it enqueues one `send` message for `botlingual` threaded to the source message, and makes no Helix call
