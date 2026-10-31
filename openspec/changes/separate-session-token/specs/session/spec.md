## ADDED Requirements

### Requirement: Session records

Each sign-in SHALL create a session token generated the same way as the user's token (22-character Base58 from 16 random bytes) and store `session-{sessionToken}` → Twitch user id in `PVTCH_ACCOUNTS` with `expirationTtl` of 30 days. A session token SHALL never equal the user's `token`, and the user's `token` SHALL NOT be written to a `session-` key. Signing in SHALL NOT end the user's other sessions.

#### Scenario: Sign-in creates a session

- **WHEN** a user completes `/auth/callback`
- **THEN** a new `session-{sessionToken}` record pointing to their Twitch user id exists with a 30-day expiry, and `pvtch_token` is set to `sessionToken`

#### Scenario: Two devices

- **WHEN** a user signs in on a second browser
- **THEN** the first browser's session still resolves

### Requirement: Session resolution

`@pvtch/shared` SHALL export the `session-` prefix, the 30-day TTL and `resolveSession(accounts, sessionToken)`, which returns the Twitch user id for a `session-` record or `undefined`. core's auth middleware, core's scope-grant flow and pvtch-twitch's `getSessionUser` SHALL resolve the `pvtch_token` cookie only through `resolveSession`. A `token-data-` record SHALL NOT make a request signed in. A session whose user has no `twitch-data-{userId}` record SHALL be treated as signed out.

#### Scenario: Overlay key used as a cookie

- **WHEN** a request carries `pvtch_token=<the user's token>` and only `token-data-<token>` exists
- **THEN** core sets no `userContext` and pvtch-twitch's `getSessionUser` returns `undefined`

#### Scenario: Removed account

- **WHEN** a session's user removed their account, so `twitch-data-{userId}` no longer exists
- **THEN** the request is treated as signed out

#### Scenario: Expired session

- **WHEN** a `session-` record has expired from KV
- **THEN** the request is treated as signed out and the user signs in again

### Requirement: Session revocation on logout

`POST /auth/logout` SHALL delete the `session-` record named by the request's `pvtch_token` cookie, if any, and clear the `pvtch_token` and `pvtch_name` cookies. It SHALL NOT touch the user's `token`, `token-data-` record or other sessions.

#### Scenario: Logout revokes the session

- **WHEN** a signed-in user POSTs `/auth/logout`
- **THEN** their `session-` record is deleted, both cookies are cleared, and a later request with the old session token is signed out

#### Scenario: Overlays survive logout

- **WHEN** a user signs out
- **THEN** their overlay and API URLs keep working

### Requirement: One-time sign-out of existing logins

The switch to session records SHALL end every login made before it: no code path SHALL resolve a `pvtch_token` cookie through `token-data-` records. Overlay and API URLs SHALL keep resolving through `token-data-` records unchanged.

#### Scenario: Cookie from before the change

- **WHEN** a user with a cookie set before this change visits www
- **THEN** they appear signed out and sign in again, and their overlay URLs still work
