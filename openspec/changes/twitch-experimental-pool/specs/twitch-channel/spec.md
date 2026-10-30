## ADDED Requirements

### Requirement: Channel pool

`TwitchChannel` SHALL store which pool processes the channel's queue messages: `'stable'` or `'experimental'`. `getPool()` SHALL return the stored pool, or `'stable'` when none has been set. `setPool(pool)` SHALL store it and return it. The pool SHALL be kept in a single-row `channel_pool` table added by a new entry in `twitchChannelMigrations`.

#### Scenario: Default pool

- **WHEN** `getPool()` is called on a new channel
- **THEN** it returns `'stable'`

#### Scenario: Set and return to stable

- **WHEN** `setPool('experimental')` and then `setPool('stable')` are called
- **THEN** `getPool()` returns `'experimental'` after the first call and `'stable'` after the second

### Requirement: Route and claim in one call

`TwitchChannel` SHALL provide `routeMessage(messageId: string | null)` returning `{ pool, fresh }`. When `messageId` is a string it SHALL claim it with the same atomic statement, dedupe window, and prune scheduling as `claimMessage`, and `fresh` SHALL be the claim result. When `messageId` is `null` it SHALL claim nothing, and `fresh` SHALL be `true`. `pool` SHALL be the value `getPool()` would return. `claimMessage` SHALL remain available and unchanged.

#### Scenario: First delivery

- **WHEN** `routeMessage('m1')` is called for the first time on an experimental channel
- **THEN** it returns `{ pool: 'experimental', fresh: true }`

#### Scenario: Redelivery

- **WHEN** `routeMessage('m1')` is called again within 15 minutes
- **THEN** it returns `fresh: false`

#### Scenario: Shared dedupe with claimMessage

- **WHEN** `claimMessage('m2')` has claimed an id and `routeMessage('m2')` is then called
- **THEN** `routeMessage` returns `fresh: false`

#### Scenario: No claim

- **WHEN** `routeMessage(null)` is called
- **THEN** it returns `fresh: true` and writes no claim row
