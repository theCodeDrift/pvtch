# lingual-worker Specification

## Purpose

The `pvtch-lingual` worker consumes the `lingual-events` queue and translates chat for channels that enabled Lingual. It reads channel settings and flags from the TwitchChannel DO and asks pvtch-twitch to send replies through a `send` queue message; it never calls Helix itself.

## Requirements

### Requirement: Lingual worker

`workers/lingual` SHALL deploy as `pvtch-lingual` with `workers_dev: false`, no routes, and `observability.enabled: true`. It SHALL bind `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`), a `TWITCH_EVENTS` producer on `twitch-events`, and `AI`. It SHALL NOT bind Twitch secrets or `PVTCH_ACCOUNTS`. It SHALL consume `lingual-events` with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, `max_concurrency: 10`, and dead-letter queue `lingual-events-dlq`. It SHALL deploy through the existing CI workflow after `pvtch-storage`.

#### Scenario: No public surface

- **WHEN** `pvtch-lingual` is deployed
- **THEN** it has no route, custom domain, or `workers.dev` URL

#### Scenario: Unknown message

- **WHEN** a message that is not a `lingual` handler message is consumed
- **THEN** it is logged and acked

### Requirement: Lingual handler flow

For each `lingual` handler message, `pvtch-lingual` SHALL apply handler dedupe, then skip without replying when any of: `chatter_user_login` is in `knownBots` (case-insensitive); `message.text` starts with `!`; `source_broadcaster_user_id` is non-null and differs from `broadcaster_user_id`. On its first attempt it SHALL also skip a message whose normalized text (no emotes, mentions or URLs, ignoring case, punctuation and spacing) `messageCache()` has already seen, keyed by a hash so the channel never holds chat text. Otherwise it SHALL run the lingo pipeline and, on a translation, enqueue a `send` request. A thrown error SHALL retry the message.

#### Scenario: Repeated message

- **WHEN** two chatters send `HOLA, amigos!!!` and `hola amigos` within the cache window
- **THEN** only the first is translated

#### Scenario: Retry of a seen message

- **WHEN** a message's first attempt throws after it was recorded in `messageCache()`
- **THEN** the retry still translates it

#### Scenario: Command message

- **WHEN** a chat message starting with `!` is handled
- **THEN** no translation or `send` occurs

#### Scenario: Shared Chat message from another channel

- **WHEN** an event has `source_broadcaster_user_id: "999"` and `broadcaster_user_id: "123"`
- **THEN** no translation or `send` occurs
