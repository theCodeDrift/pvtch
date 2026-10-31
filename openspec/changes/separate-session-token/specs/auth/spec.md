## MODIFIED Requirements

### Requirement: Dual KV storage

The system SHALL store two entries in the `PVTCH_ACCOUNTS` KV namespace per user:

1. `twitch-data-{twitchId}` → JSON containing `{ id, login, display_name, token }`
2. `token-data-{token}` → the Twitch user ID as a plain string

The user's `token` is their overlay key: it names their overlay and API URLs and the Durable Objects built from it. Login sessions are stored separately as `session-` records (see the `session` capability).

#### Scenario: New user registration

- **WHEN** a user completes OAuth and no existing `twitch-data-{id}` entry exists
- **THEN** the system creates both KV entries with the generated token, and a `session-` record for this sign-in

#### Scenario: Returning user login

- **WHEN** a user completes OAuth and an existing `twitch-data-{id}` entry is found
- **THEN** the system reuses the existing token and updates the `token-data-{token}` entry, preserving the user's existing widget configurations, and creates a new `session-` record for this sign-in

### Requirement: Session cookie

The system SHALL set a `pvtch_token` cookie after successful authentication whose value is the new session token, never the user's `token`. The cookie SHALL use `Path=/`, `SameSite=Lax`, `HttpOnly` and `Max-Age` equal to the session TTL (30 days). The system SHALL also set a `pvtch_name` cookie holding the URL-encoded display name, with the same attributes except `HttpOnly`. In production, both SHALL include `Secure` and `Domain=pvtch.com`. After setting the cookies, the system redirects to `/welcome`.

#### Scenario: Cookie set on login

- **WHEN** a user successfully authenticates (new or returning)
- **THEN** an HttpOnly `pvtch_token` cookie holding a session token and a readable `pvtch_name` cookie are set via `Set-Cookie` headers, and the user is redirected to `/welcome`

#### Scenario: Cookie does not carry the overlay key

- **WHEN** a returning user signs in
- **THEN** the `pvtch_token` cookie value differs from `twitch-data-{id}.token`

#### Scenario: Localhost development

- **WHEN** the app domain is `localhost`
- **THEN** the cookies omit `Secure` and `Domain` attributes

### Requirement: Token validation

The system SHALL provide an `isValidToken` function that looks up `token-data-{token}` in KV and returns the associated Twitch user ID, or `undefined` if the token is invalid or missing. `isValidToken` SHALL be used only for overlay and API URLs that carry the user's token; it SHALL NOT be used to resolve the `pvtch_token` cookie. Session validation SHALL be performed centrally in React Router middleware (`app/middleware/auth.ts`) instead of in individual route loaders, resolving the cookie through `resolveSession`. The middleware SHALL set `userContext` with the authenticated user's data, and `instanceAccessContext` with authorization state.

#### Scenario: Valid session

- **WHEN** a request arrives with a `pvtch_token` cookie naming a live `session-` record
- **THEN** the middleware resolves the user, sets `userContext` with `{ id, login, displayName, token }`, and loaders access user data via `context.get(userContext)`

#### Scenario: Invalid or missing session

- **WHEN** a request arrives without a `pvtch_token` cookie, or with one that names no `session-` record (including the user's own `token`)
- **THEN** the middleware does not set `userContext`, and `context.get(userContext)` returns `undefined` in loaders

#### Scenario: Overlay URL

- **WHEN** a request arrives at an overlay or API route with the user's token in the URL
- **THEN** the route resolves the user through `isValidToken`, with or without a session cookie

### Requirement: Login UI component

The system SHALL provide a `TwitchLogin` component that renders a Twitch-branded login button when unauthenticated, and a logout button when authenticated. Because `pvtch_token` is HttpOnly, the component SHALL treat the user as signed in only when the readable `pvtch_name` cookie is present and the layout loader reports a resolved session. It SHALL remove a `pvtch_name` cookie that has no session. Login navigates to `/auth/start`. Logout POSTs to `/auth/logout`, which revokes the session and clears both cookies, and then reloads the page. On a private instance, when the user is logged in but not authorized, the component SHALL display an `X` icon instead of the Twitch icon, and the username SHALL link to `/private` instead of opening a dropdown.

#### Scenario: Unauthenticated user

- **WHEN** no `pvtch_name` cookie is present
- **THEN** the component renders a purple Twitch-branded "Login With Twitch" button linking to `/auth/start`

#### Scenario: Authenticated and authorized user

- **WHEN** a `pvtch_name` cookie is present and the user is authorized (or the instance is open)
- **THEN** the component renders the Twitch icon with the display name and a sign-out dropdown

#### Scenario: Authenticated but unauthorized user on private instance

- **WHEN** a `pvtch_name` cookie is present but the user is not on the allow list
- **THEN** the component renders an `X` icon with the display name as a link to `/private`

#### Scenario: Name cookie without a session

- **WHEN** a `pvtch_name` cookie is present but the loader reports no session (for example, a cookie from before session records)
- **THEN** the component renders the login button and removes `pvtch_name`

#### Scenario: Sign out

- **WHEN** the user chooses Sign out
- **THEN** the component POSTs `/auth/logout` and reloads, and the page renders signed out
