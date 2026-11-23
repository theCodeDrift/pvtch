## MODIFIED Requirements

### Requirement: Login UI component

The system SHALL provide a `TwitchLogin` component that renders a Twitch-branded login button when unauthenticated, and an account menu when authenticated. Because `pvtch_token` is HttpOnly, the layout loader SHALL return the signed-in user's display name, or `null` when no session resolved. That value decides how `TwitchLogin` renders. When the loader reports no session and a `pvtch_name` cookie is present, the component SHALL remove that cookie in an effect.

Login navigates to `/auth/start`. The account menu SHALL contain "Account", linking to `/account`, followed by "Sign out". Sign out POSTs to `/auth/logout`, which revokes the session and clears both cookies, and then reloads the page. On a private instance, when the user is logged in but not authorized, the component SHALL display an `X` icon instead of the Twitch icon, and the username SHALL link to `/private` instead of opening a dropdown.

#### Scenario: Unauthenticated user

- **WHEN** the layout loader reports no session
- **THEN** the component renders a purple Twitch-branded "Login With Twitch" button linking to `/auth/start`

#### Scenario: Authenticated and authorized user

- **WHEN** the layout loader reports a session and the user is authorized (or the instance is open)
- **THEN** the component renders the Twitch icon with the loader's display name and a dropdown with "Account" and "Sign out"

#### Scenario: Open account settings

- **WHEN** a signed-in user opens the dropdown and chooses Account
- **THEN** the browser navigates to `/account`

#### Scenario: Authenticated but unauthorized user on private instance

- **WHEN** the layout loader reports a session but the user is not on the allow list
- **THEN** the component renders an `X` icon with the display name as a link to `/private`

#### Scenario: Name cookie without a session

- **WHEN** a `pvtch_name` cookie is present but the loader reports no session (for example, a cookie from before session records)
- **THEN** the component renders the login button and removes `pvtch_name`

#### Scenario: Session without a name cookie

- **WHEN** the loader reports a session but no `pvtch_name` cookie is present
- **THEN** the component renders signed in with the loader's display name

#### Scenario: Sign out

- **WHEN** the user chooses Sign out
- **THEN** the component POSTs `/auth/logout` and reloads, and the page renders signed out
