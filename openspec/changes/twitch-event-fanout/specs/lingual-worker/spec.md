## ADDED Requirements

### Requirement: Lingual worker

`workers/lingual` SHALL deploy as `pvtch-lingual` with `workers_dev: false`, no routes, and `observability.enabled: true`. It SHALL bind `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`), a `TWITCH_EVENTS` producer on `twitch-events`, and `AI`. It SHALL NOT bind Twitch secrets or `PVTCH_ACCOUNTS`. It SHALL consume `lingual-events` with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, `max_concurrency: 10`, and dead-letter queue `lingual-events-dlq`. It SHALL deploy through the existing CI workflow after `pvtch-storage`.

#### Scenario: No public surface

- **WHEN** `pvtch-lingual` is deployed
- **THEN** it has no route, custom domain, or `workers.dev` URL

#### Scenario: Unknown message

- **WHEN** a message that is not a `lingual` handler message is consumed
- **THEN** it is logged and acked

### Requirement: Lingual handler flow

For each `lingual` handler message, `pvtch-lingual` SHALL apply handler dedupe, then skip without replying when any of: `chatter_user_login` is in `knownBots` or the channel's Lingual `ignoredChatters` (case-insensitive); `message.text` starts with `!`; `source_broadcaster_user_id` is non-null and differs from `broadcaster_user_id`. Otherwise it SHALL run the lingo pipeline and, on a translation, enqueue a `send` request. A thrown error SHALL retry the message.

#### Scenario: Command message

- **WHEN** a chat message starting with `!` is handled
- **THEN** no translation or `send` occurs

#### Scenario: Shared Chat message from another channel

- **WHEN** an event has `source_broadcaster_user_id: "999"` and `broadcaster_user_id: "123"`
- **THEN** no translation or `send` occurs
