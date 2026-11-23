# session Specification

## Purpose

Login sessions kept separate from the user's overlay key: `session-` records in `PVTCH_ACCOUNTS` bound to the overlay token, their 30-day expiry, the shared resolver used by core and pvtch-twitch, revocation on logout and re-login, and the localhost-only development bypass.

## Requirements

### Requirement: Session records

Each sign-in SHALL create a session token with `createToken()` (22-character Base58 from 16 random bytes), regenerating it if it equals the user's `token`. It SHALL store `session-{sessionToken}` → JSON `{ userId, token }` in `PVTCH_ACCOUNTS` with `expirationTtl` of 30 days, where `token` is the user's overlay token at sign-in. The user's `token` SHALL NOT be written to a `session-` key. Signing in SHALL NOT end the user's sessions in other browsers. If the signing-in request already carries a `pvtch_token` cookie, the system SHALL delete that `session-` record.

#### Scenario: Sign-in creates a session

- **WHEN** a user completes `/auth/callback`
- **THEN** a `session-{sessionToken}` record holding their user id and overlay token exists with a 30-day expiry, and `pvtch_token` is set to `sessionToken`

#### Scenario: Two devices

- **WHEN** a user signs in on a second browser
- **THEN** the first browser's session still resolves

#### Scenario: Re-login on the same browser

- **WHEN** a request carrying `pvtch_token=s1` completes `/auth/callback`
- **THEN** `session-s1` is deleted and the browser gets a new session token

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

### Requirement: Development login bypass

When `DEV_TWITCH_USER_ID` is set and the hostname of `PVTCH_APP_URL` is `localhost`, core SHALL treat every request as signed in as that user id, through one helper used by both the auth middleware and the scope-grant flow, with no cookie required. `isValidToken` SHALL apply the same localhost-only bypass for overlay and API routes. On any other `PVTCH_APP_URL`, `DEV_TWITCH_USER_ID` SHALL be ignored. pvtch-twitch has no bypass.

#### Scenario: Local development

- **WHEN** `DEV_TWITCH_USER_ID=123` and `PVTCH_APP_URL=http://localhost:5173`
- **THEN** pages, the scope grant and overlay routes act as user `123`

#### Scenario: Set in production by mistake

- **WHEN** `DEV_TWITCH_USER_ID=123` and `PVTCH_APP_URL=https://www.pvtch.com`
- **THEN** the variable is ignored, and a request without a valid session is signed out

### Requirement: Session revocation on logout

`POST /auth/logout` SHALL refuse a request whose `Origin` is present and isn't the origin of `PVTCH_APP_URL`, with HTTP 403. Otherwise it SHALL delete the `session-` record named by the request's `pvtch_token` cookie, if there is one, and clear the `pvtch_token` and `pvtch_name` cookies. It SHALL NOT touch the user's `token`, `token-data-` record or other sessions.

#### Scenario: Logout revokes the session

- **WHEN** a signed-in user POSTs `/auth/logout` from a www page
- **THEN** their `session-` record is deleted, both cookies are cleared, and a later request with the old session token is signed out (within KV's propagation delay elsewhere)

#### Scenario: Logout from another site

- **WHEN** a POST to `/auth/logout` has `Origin: https://evil.example`
- **THEN** the system returns 403 and changes nothing

#### Scenario: Overlays survive logout

- **WHEN** a user signs out
- **THEN** their overlay and API URLs keep working

### Requirement: One-time sign-out of existing logins

The switch to session records SHALL end every login made before it: no code path SHALL resolve a `pvtch_token` cookie through `token-data-` records. Overlay and API URLs SHALL keep resolving through `token-data-` records unchanged.

#### Scenario: Cookie from before the change

- **WHEN** a user with a cookie set before this change visits www
- **THEN** they appear signed out and sign in again, and their overlay URLs still work

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
