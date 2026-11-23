## ADDED Requirements

### Requirement: Channel purge

`TwitchChannel` SHALL expose `purge()`, returning `{ done: boolean }`. Each call SHALL:

1. mark the channel as purging, after which `enableHandler` SHALL refuse;
2. call `disableHandler` for every handler in `listHandlers()`, which schedules subscription sync as usual;
3. return `{ done: false }` while any subscription record remains for any sender;
4. otherwise clear the in-memory message cache, delete the alarm and all storage, and return `{ done: true }`.

`purge()` SHALL be idempotent and SHALL be covered by the class's `AssertRPCSerializable` check.

#### Scenario: Active Lingual channel

- **WHEN** `purge()` is called on a channel with Lingual enabled and its subscriptions recorded
- **THEN** it returns `{ done: false }` and one `sync` message for `pvtchbot` is enqueued

#### Scenario: Subscriptions cleared

- **WHEN** `purge()` is called again after the sync removed every subscription record
- **THEN** it returns `{ done: true }` and the channel's Lingual settings, flags, handler state and scheduled jobs are gone

#### Scenario: Enable while purging

- **WHEN** `enableHandler('lingual')` is called after `purge()` returned `{ done: false }`
- **THEN** the handler stays disabled

#### Scenario: Nothing to purge

- **WHEN** `purge()` is called on a channel that never enabled a handler
- **THEN** it returns `{ done: true }`
