## MODIFIED Requirements

### Requirement: Session resolution

`@pvtch/shared/session` SHALL export the `session-` prefix, the 30-day TTL, the record schema, `newSessionRecord(userId, token)` and `resolveSession(accounts, sessionToken)`. A session record SHALL be `{ userId, token, issuedAt? }`, where `issuedAt` is epoch milliseconds; `newSessionRecord` SHALL set `issuedAt` to the current time, and every writer of a `session-` record SHALL use it. The `accounts` parameter SHALL be typed structurally (a `get` method returning a string or null), because `packages/shared` doesn't load Workers types. `resolveSession` SHALL:

1. return `undefined` for a missing token or record;
2. load `twitch-data-{userId}`;
3. return `undefined` when that record's `token` differs from the session's `token`;
4. return `undefined` when that record has `sessionsNotBefore` and the session's `issuedAt` (0 when absent) is less than it;
5. otherwise return the user record.

core's auth middleware, core's scope-grant flow and pvtch-twitch's `getSessionUser` SHALL resolve the `pvtch_token` cookie only through `resolveSession`. A `token-data-` record SHALL NOT make a request signed in.

#### Scenario: Overlay key used as a cookie

- **WHEN** a request carries `pvtch_token=<the user's token>` and only `token-data-<token>` exists
- **THEN** core sets no `userContext` and pvtch-twitch's `getSessionUser` returns `undefined`

#### Scenario: Account record missing

- **WHEN** a session's user has no `twitch-data-{userId}` record
- **THEN** the request is treated as signed out

#### Scenario: Account re-created after removal

- **WHEN** a user's records were deleted and they sign up again, getting a new overlay token, while an old `session-` record from before still exists
- **THEN** the old session is signed out, because its `token` no longer matches

#### Scenario: Expired session

- **WHEN** a `session-` record has expired from KV
- **THEN** the request is treated as signed out and the user signs in again

#### Scenario: Session issued before the cutoff

- **WHEN** `twitch-data-{id}` has `sessionsNotBefore: 2000` and a session has `issuedAt: 1000`
- **THEN** the request is treated as signed out

#### Scenario: Session from before issuedAt existed

- **WHEN** a session record has no `issuedAt` and the account has a `sessionsNotBefore`
- **THEN** the request is treated as signed out

#### Scenario: No cutoff set

- **WHEN** the account has no `sessionsNotBefore`
- **THEN** a session with or without `issuedAt` resolves as before

## ADDED Requirements

### Requirement: Sign out everywhere

`POST /account/sessions/end` SHALL require a signed-in user and SHALL refuse a present `Origin` that isn't `PVTCH_APP_URL`'s origin. It SHALL call `endSessions(userId)` on the user's `User` DO, which sets the account's `sessions_not_before` to the current time inside the account's serialized queue and publishes it to `twitch-data-{id}` as `sessionsNotBefore`. After `endSessions` returns, the action SHALL re-write the request's own `session-` record with `newSessionRecord`, so the current browser stays signed in. Overlay and API URLs SHALL keep working.

#### Scenario: Other browsers are signed out

- **WHEN** a user signed in on browsers A and B chooses Sign out everywhere on A
- **THEN** B's next request is signed out and A stays signed in

#### Scenario: Overlays survive

- **WHEN** a user signs out everywhere
- **THEN** their overlay and API URLs still resolve

#### Scenario: Cross-site request

- **WHEN** a request to `/account/sessions/end` carries an `Origin` other than the app's
- **THEN** it is refused and no cutoff is written

#### Scenario: Cutoff survives other account writes

- **WHEN** a user signs out everywhere and then grants a scope
- **THEN** `twitch-data-{id}` still carries the same `sessionsNotBefore`
