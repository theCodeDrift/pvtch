# account Specification

## Purpose

The signed-in account settings page and self-service account deletion: the `/account` page, the deletion request and its confirmation, the `User` DO's `delete-account` job, and the `/account/deleted` page with the remaining steps on Twitch.

## Requirements

### Requirement: Account settings page

core SHALL serve `/account` to signed-in users only; a signed-out request SHALL redirect to `/auth/start`. The page SHALL have three sections:

- **Sessions:** Sign out, and Sign out everywhere.
- **Overlay key:** the overlay key rotation control.
- **Danger zone:** a link to `/account/delete`.

`/welcome` SHALL NOT render the overlay key rotation control or a link in its place.

#### Scenario: Signed-in user opens account settings

- **WHEN** a signed-in user visits `/account`
- **THEN** the page shows the sessions, overlay key and danger zone sections

#### Scenario: Signed-out visitor

- **WHEN** a request without a session visits `/account`
- **THEN** it is redirected to `/auth/start`

#### Scenario: Rotation moved

- **WHEN** a signed-in user visits `/welcome`
- **THEN** no overlay key rotation control or link to it is shown

### Requirement: Account deletion request

`/account/delete` SHALL be signed-in only. It SHALL explain what is deleted, warn that overlays stop working immediately (including during a live stream), preview the Twitch next steps, and ask the user to type their Twitch login. `POST /account/delete` SHALL:

1. refuse a present `Origin` that isn't `PVTCH_APP_URL`'s origin;
2. return 400 with the submitted form data when the typed login doesn't match the user's login, compared case-insensitively;
3. clear the legacy `PvtchBackend` Lingo config for the user's current token, then call `deleteAccount(userId)` on the user's `User` DO, returning 500 without signing out if either fails;
4. delete the request's `session-` record and clear `pvtch_token` and `pvtch_name`;
5. redirect to `/account/deleted`.

No record of the deletion SHALL be logged.

#### Scenario: Confirmed deletion

- **WHEN** a signed-in user submits their login correctly
- **THEN** deletion starts, their cookies are cleared, and they land on `/account/deleted`

#### Scenario: Wrong login typed

- **WHEN** the typed login doesn't match
- **THEN** the response is 400, nothing is deleted, and the form shows the error

#### Scenario: Overlay key can't delete

- **WHEN** a request carries only an overlay URL token and no session
- **THEN** `POST /account/delete` refuses it

### Requirement: Account deletion job

`deleteAccount(userId)` on the `User` DO SHALL record a deletion marker inside the account's serialized queue and schedule a `delete-account` job on the DO's `JobScheduler` with idempotency key `delete-account`. A repeat call while the marker exists SHALL do nothing. While the marker exists, `ensure`, `setScopes`, `rotateToken` and `endSessions` SHALL refuse, `clearScopes` SHALL return without writing, and the sign-in callback SHALL redirect to `/account/deleted`.

The job SHALL run these steps in order, each idempotent, and reschedule itself in 300 seconds after a failed step, without a retry cap:

1. call `purge()` on the user's `TwitchChannel`, rescheduling itself in 60 seconds while it returns `{ done: false }`;
2. delete `token-data-` for the current and every pending-revocation token, then `twitch-data-{id}`;
3. delete the DO's alarm and all of its storage.

#### Scenario: Complete deletion

- **WHEN** the job finishes
- **THEN** no `twitch-data-` or `token-data-` record remains for the user, the `TwitchChannel` and `User` DOs hold no data, and every session for the user is signed out

#### Scenario: Partial failure

- **WHEN** the KV delete fails after the channel purge succeeded
- **THEN** the job retries from the top, the purge reports done again, and the KV records are deleted on a later attempt

#### Scenario: Sign-in during deletion

- **WHEN** the user signs in again while the job is still running
- **THEN** no account is created and they are sent to `/account/deleted`

#### Scenario: Sign-in after deletion

- **WHEN** the user signs in after the job finished
- **THEN** a new account is created with a new overlay token and no data

### Requirement: Account deleted page

`/account/deleted` SHALL render without a session. It SHALL state that all pvtch data is deleted, and list the remaining steps on Twitch:

1. disconnect pvtch under Twitch → Settings → Connections;
2. unmod pvtchbot (`/unmod pvtchbot`) if it was made a moderator;
3. remove pvtch browser sources from OBS and any chat-bot commands that call pvtch URLs.

#### Scenario: After deletion

- **WHEN** a user lands on `/account/deleted`
- **THEN** they see the confirmation and the three Twitch steps
