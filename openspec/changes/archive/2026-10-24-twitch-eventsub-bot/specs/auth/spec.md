## ADDED Requirements

### Requirement: Login remains scope-free

The login flow (`/auth/start`) SHALL continue to request no OAuth scopes (the `scope` parameter is empty or absent). Additional scopes SHALL be requested only through the general scope grant flow.

#### Scenario: Normal login

- **WHEN** a user logs in
- **THEN** the Twitch authorize URL requests no scopes

### Requirement: General scope grant flow

`pvtch` SHALL provide `GET /auth/grant` for authenticated users, taking `scopes` (space- or comma-separated) and `return_to` (a same-origin relative path). Every requested scope SHALL be in a `GRANTABLE_SCOPES` allowlist (initially `channel:bot`); otherwise the request SHALL be rejected with HTTP 400. The flow SHALL redirect to Twitch authorize requesting the union of the requested scopes and the user's already-recorded scopes, so pvtch's authorization is never narrowed, with `redirect_uri` set to `/auth/grant/callback` and a random `state` stored with `return_to` in a short-lived, HttpOnly cookie. The flow is feature-agnostic: it SHALL NOT enable or change any feature state.

#### Scenario: Request a grantable scope

- **WHEN** a logged-in user visits `/auth/grant?scopes=channel:bot&return_to=/bots/lingual`
- **THEN** they are redirected to Twitch authorize with `scope=channel:bot` and a `state`

#### Scenario: Union with existing scopes

- **WHEN** a user with recorded scope `channel:bot` requests a future grantable scope `moderator:read:followers`
- **THEN** the Twitch authorize URL requests both scopes

#### Scenario: Scope not allowlisted

- **WHEN** `/auth/grant?scopes=channel:manage:broadcast` is requested
- **THEN** the response is HTTP 400

#### Scenario: Open redirect attempt

- **WHEN** `return_to` is an absolute URL or protocol-relative path
- **THEN** the response is HTTP 400

#### Scenario: Not logged in

- **WHEN** an anonymous user visits `/auth/grant`
- **THEN** they are redirected to `/auth/start` (login has no return-to; pages that link to the grant already require login)

### Requirement: Scope grant callback records granted scopes

`GET /auth/grant/callback` SHALL verify `state` against the cookie, exchange the code, fetch `/helix/users` with the returned token, and require the returned user id to equal the logged-in user's id. On success it SHALL store the token response's `scope` array as `scopes` on the user's `twitch-data-{userId}` record in `PVTCH_ACCOUNTS`, discard the access and refresh tokens without persisting them, clear the state cookie, and redirect to `return_to` with `granted=<scopes>`. On Twitch `error` (e.g. `access_denied`) it SHALL redirect to `return_to` with `grant_error=<error>` and change nothing.

#### Scenario: Successful grant

- **WHEN** the logged-in user approves `channel:bot`
- **THEN** `twitch-data-{userId}.scopes` includes `channel:bot`, no Twitch token is persisted, and the user lands on `return_to?granted=channel:bot`

#### Scenario: Different Twitch account approves

- **WHEN** the token's user id differs from the logged-in user
- **THEN** no scopes are recorded and the user lands on `return_to?grant_error=account_mismatch`

#### Scenario: State mismatch

- **WHEN** the callback `state` does not match the cookie, or the cookie is missing or malformed
- **THEN** the request is rejected with HTTP 400

#### Scenario: User declines

- **WHEN** Twitch redirects back with `error=access_denied`
- **THEN** nothing is recorded and the user lands on `return_to?grant_error=access_denied`

### Requirement: Recorded scopes cleared on revoke

When a `user.authorization.revoke` event is processed for a user, the system SHALL clear `scopes` on that user's `twitch-data-{userId}` record in addition to disabling features that depend on them.

#### Scenario: User disconnects pvtch on Twitch

- **WHEN** a `user.authorization.revoke` event arrives for user `123`
- **THEN** `twitch-data-123.scopes` is empty
