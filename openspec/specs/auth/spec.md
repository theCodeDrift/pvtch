# auth Specification

## Purpose

Twitch OAuth 2.0 authentication with token-based sessions, dual KV storage, cookie management, login/logout flows, inline auth gate component, and page-level auth gating patterns.

## Requirements

### Requirement: OAuth login initiation

The system SHALL redirect users to the Twitch OAuth 2.0 authorization endpoint when they visit `/auth/start`. The redirect SHALL include `client_id`, `response_type=code`, and `redirect_uri` parameters. No OAuth scopes are requested.

#### Scenario: User clicks login

- **WHEN** a user navigates to `/auth/start`
- **THEN** the system redirects to `https://id.twitch.tv/oauth2/authorize` with the correct query parameters

### Requirement: OAuth callback token exchange

The system SHALL exchange the authorization code for a Twitch access token by POSTing to `https://id.twitch.tv/oauth2/token` with `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, and `redirect_uri`.

#### Scenario: Successful token exchange

- **WHEN** Twitch redirects to `/auth/callback` with a valid `code` parameter
- **THEN** the system exchanges the code for an access token via the Twitch token endpoint

#### Scenario: Twitch returns an error

- **WHEN** Twitch redirects to `/auth/callback` with an `error` parameter
- **THEN** the system redirects to `/auth/error` with the error details as query parameters

#### Scenario: Missing code parameter

- **WHEN** a request arrives at `/auth/callback` without a `code` or `error` parameter
- **THEN** the system returns HTTP 400

### Requirement: User data retrieval

The system SHALL fetch the authenticated user's profile from `https://api.twitch.tv/helix/users` using the exchanged access token. Only `id`, `login`, and `display_name` are persisted.

#### Scenario: Fetch user profile

- **WHEN** a valid access token is obtained
- **THEN** the system fetches user data from the Twitch Helix API and extracts id, login, and display_name

### Requirement: Token generation

The system SHALL generate a 22-character Base58-encoded token from 16 cryptographically random bytes. Tokens are padded to exactly 22 characters.

#### Scenario: New token creation

- **WHEN** a new user completes OAuth for the first time
- **THEN** a unique 22-character Base58 token is generated using `crypto.getRandomValues`

### Requirement: Dual KV storage

The system SHALL store two entries in the `PVTCH_ACCOUNTS` KV namespace per user:

1. `twitch-data-{twitchId}` → JSON containing `{ id, login, display_name, token }`
2. `token-data-{token}` → the Twitch user ID as a plain string

#### Scenario: New user registration

- **WHEN** a user completes OAuth and no existing `twitch-data-{id}` entry exists
- **THEN** the system creates both KV entries with the generated token

#### Scenario: Returning user login

- **WHEN** a user completes OAuth and an existing `twitch-data-{id}` entry is found
- **THEN** the system reuses the existing token and updates the `token-data-{token}` entry, preserving the user's existing widget configurations

### Requirement: Session cookie

The system SHALL set a `pvtch_token` cookie after successful authentication. The cookie SHALL use `Path=/`, `SameSite=Lax`. In production, it SHALL include `Secure` and `Domain=pvtch.com`. After setting the cookie, the system redirects to `/welcome`.

#### Scenario: Cookie set on login

- **WHEN** a user successfully authenticates (new or returning)
- **THEN** a `pvtch_token` cookie is set via `Set-Cookie` header and the user is redirected to `/welcome`

#### Scenario: Localhost development

- **WHEN** the app domain is `localhost`
- **THEN** the cookie omits `Secure` and `Domain` attributes

### Requirement: Token validation

The system SHALL provide an `isValidToken` function that looks up `token-data-{token}` in KV and returns the associated Twitch user ID, or `undefined` if the token is invalid or missing. Token validation SHALL be performed centrally in React Router middleware (`app/middleware/auth.ts`) instead of in individual route loaders. The middleware SHALL set `userContext` with the authenticated user's data, and `instanceAccessContext` with authorization state.

#### Scenario: Valid token

- **WHEN** a request arrives with a valid `pvtch_token` cookie
- **THEN** the middleware resolves the user, sets `userContext` with `{ id, login, displayName }`, and loaders access user data via `context.get(userContext)`

#### Scenario: Invalid or missing token

- **WHEN** a request arrives without a `pvtch_token` cookie or with an invalid token
- **THEN** the middleware does not set `userContext`, and `context.get(userContext)` returns `undefined` in loaders

### Requirement: Account removal

The system SHALL allow users to remove their account by POSTing to `/auth/remove` with `{ username, token }` in the JSON body. The system SHALL verify the token is valid and the username matches before deleting both KV entries.

#### Scenario: Successful removal

- **WHEN** a valid token and matching username are provided
- **THEN** both `twitch-data-{id}` and `token-data-{token}` KV entries are deleted and the system returns `{ success: true }`

#### Scenario: Missing username or token

- **WHEN** the request body is missing `username` or `token`
- **THEN** the system returns HTTP 400 with an error message

#### Scenario: Username mismatch

- **WHEN** a valid token is provided but the username does not match (case-insensitive)
- **THEN** the system returns HTTP 400 with "Username does not match token"

### Requirement: Login UI component

The system SHALL provide a `TwitchLogin` component that renders a Twitch-branded login button when unauthenticated, and a logout button when authenticated. Login navigates to `/auth/start`. Logout removes the `pvtch_token` cookie and reloads the page. On a private instance, when the user is logged in but not authorized, the component SHALL display an `X` icon instead of the Twitch icon, and the username SHALL link to `/private` instead of opening a dropdown.

#### Scenario: Unauthenticated user

- **WHEN** no `pvtch_token` cookie is present
- **THEN** the component renders a purple Twitch-branded "Login With Twitch" button linking to `/auth/start`

#### Scenario: Authenticated and authorized user

- **WHEN** a `pvtch_token` cookie is present and the user is authorized (or the instance is open)
- **THEN** the component renders the Twitch icon with the display name and a sign-out dropdown

#### Scenario: Authenticated but unauthorized user on private instance

- **WHEN** a `pvtch_token` cookie is present but the user is not on the allow list
- **THEN** the component renders an `X` icon with the display name as a link to `/private`

### Requirement: Inline auth gate component

The system SHALL provide an `<AuthGate>` component (replacing `<RequireTwitchLogin>`) that accepts an `authenticated` boolean prop and children. When `authenticated` is true, it SHALL render its children. When `authenticated` is false, it SHALL render a login prompt with trust copy and a Twitch login button. Pages SHALL NOT use full-page auth blocking — authentication gating is scoped to sections that require a token.

#### Scenario: Authenticated user sees gated content

- **WHEN** `<AuthGate authenticated={true}>` wraps content
- **THEN** the children are rendered directly with no login prompt

#### Scenario: Unauthenticated user sees login prompt

- **WHEN** `<AuthGate authenticated={false}>` wraps content
- **THEN** the children are NOT rendered and a login prompt is displayed instead

### Requirement: Trust copy in login prompt

The `<AuthGate>` login prompt SHALL include trust copy explaining: (1) login is used only for identification, (2) no Twitch permissions are requested, and (3) only username and a generated token are stored.

#### Scenario: Trust copy is displayed

- **WHEN** an unauthenticated user sees the `<AuthGate>` login prompt
- **THEN** the prompt includes text explaining why login is needed and what data is stored

### Requirement: Login button in auth gate

The `<AuthGate>` login prompt SHALL include a Twitch-branded login button that navigates to `/auth/start`, using the same `<TwitchLogin>` component as the header.

#### Scenario: Login button links to auth start

- **WHEN** an unauthenticated user sees the `<AuthGate>` login prompt
- **THEN** the prompt includes a "Login With Twitch" button linking to `/auth/start`

### Requirement: Progress page open config with gated URLs

The progress bar config page SHALL render all configuration controls (colors, goal, text, preview) without requiring authentication. Only the URL output section (OBS URL, Update API URL) SHALL be wrapped in `<AuthGate>`.

#### Scenario: Unauthenticated user configures progress bar

- **WHEN** an unauthenticated user visits `/widgets/progress`
- **THEN** the live preview, color pickers, goal, text, decimal, and prefix controls are all visible and interactive

#### Scenario: Unauthenticated user cannot see progress URLs

- **WHEN** an unauthenticated user visits `/widgets/progress`
- **THEN** the OBS URL and Update API URL sections are replaced by the `<AuthGate>` login prompt

#### Scenario: Authenticated user sees full progress page

- **WHEN** an authenticated user visits `/widgets/progress`
- **THEN** all config controls AND the URL output section are visible

### Requirement: Lingo page open docs with gated config

The lingo config page SHALL render its description and setup guide (Firebot/MixItUp tabs) without requiring authentication. The config form (bots, language, save) and Translate URL SHALL be wrapped in `<AuthGate>`.

#### Scenario: Unauthenticated user reads lingo docs

- **WHEN** an unauthenticated user visits `/helpers/lingo`
- **THEN** the page title, description, and setup guide with bot integration tabs are visible

#### Scenario: Unauthenticated user cannot access lingo config

- **WHEN** an unauthenticated user visits `/helpers/lingo`
- **THEN** the config form and Translate URL are replaced by the `<AuthGate>` login prompt

#### Scenario: Authenticated user sees full lingo page

- **WHEN** an authenticated user visits `/helpers/lingo`
- **THEN** the description, config form, Translate URL, and setup guide are all visible

### Requirement: Homepage CTA directs to explore

The homepage primary hero CTA SHALL link to `/widgets/progress` with text "Explore Tools" instead of linking to `/auth/start` with "Get Started with Twitch".

#### Scenario: Homepage hero CTA

- **WHEN** a user visits the homepage
- **THEN** the primary CTA button says "Explore Tools" and links to `/widgets/progress`

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
