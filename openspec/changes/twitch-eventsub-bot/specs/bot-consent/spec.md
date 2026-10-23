## ADDED Requirements

### Requirement: Lingual enable uses the general grant flow

Enabling Lingual SHALL require `channel:bot` in the user's recorded scopes. The `/bots/lingual` "Enable Lingual" action SHALL call `enableBot()` on the user's `TwitchChannel` when `channel:bot` is recorded; otherwise it SHALL redirect to `/auth/grant?scopes=channel:bot&return_to=/bots/lingual?enable=1`. When `/bots/lingual` loads with `enable=1` and `channel:bot` recorded, it SHALL call `enableBot()` and remove the parameter. Lingual SHALL NOT implement its own OAuth routes.

#### Scenario: First enable

- **WHEN** a user without `channel:bot` clicks Enable Lingual
- **THEN** they go through `/auth/grant`, return to `/bots/lingual?enable=1`, and the bot is enabled

#### Scenario: Scope already granted

- **WHEN** a user with `channel:bot` recorded clicks Enable Lingual
- **THEN** the bot is enabled with no Twitch redirect

#### Scenario: Grant declined

- **WHEN** the user returns with `grant_error=access_denied`
- **THEN** the bot stays disabled and the page explains the permission is required

### Requirement: Bot settings UI

The pvtch dashboard sidebar (`app-layout.tsx`) SHALL gain a new section titled "Bots" whose first entry is "Lingual", linking to a new page at `/bots/lingual` inside the shared app layout. That page SHALL show, for the logged-in user, whether the bot is enabled and the stored subscription status from `TwitchChannel`, and SHALL link to `/helpers/lingo` for language and ignore-list settings. It SHALL offer "Enable Lingual" when disabled and "Disable" when enabled. Disable SHALL call `disableBot()` (which enqueues the unsubscribe work) and SHALL NOT remove recorded scopes. During rollout the controls SHALL be visible only to users in `ALLOWED_USERS`.

#### Scenario: Enabled with pending subscription

- **WHEN** the bot is enabled and status is `webhook_callback_verification_pending`
- **THEN** the UI shows the bot as connecting

#### Scenario: Disable

- **WHEN** the user clicks Disable
- **THEN** the bot is disabled, an unsubscribe is enqueued, and a success toast is shown

#### Scenario: Rollout gate

- **WHEN** a user not in `ALLOWED_USERS` views `/bots/lingual`
- **THEN** no bot controls are shown

#### Scenario: Sidebar entry

- **WHEN** any page in the app layout renders
- **THEN** the sidebar shows a "Bots" section containing "Lingual" linking to `/bots/lingual`

### Requirement: One-time bot account authorization

`pvtch-twitch` SHALL provide `GET /bot/authorize` that redirects to Twitch authorize with `scope=user:bot user:read:chat user:write:chat` and `redirect_uri=https://twitch.pvtch.com/bot/callback`, and `GET /bot/callback` that exchanges the code and verifies the authorizing user's id equals `TWITCH_BOT_USER_ID`. This is separate from `/auth/grant` because the authorizing Twitch account is the bot, not the logged-in pvtch user. Both routes SHALL require a valid pvtch session (the `pvtch_token` cookie, set on `Domain=pvtch.com`, resolved through the shared `PVTCH_ACCOUNTS` KV) belonging to a user in `ALLOWED_USERS`. The resulting tokens SHALL NOT be stored.

#### Scenario: Bot account grants scopes

- **WHEN** an allowed user completes the flow logged into Twitch as the bot account
- **THEN** the callback confirms the grant and shows success

#### Scenario: Wrong Twitch account

- **WHEN** the authorizing Twitch user id is not `TWITCH_BOT_USER_ID`
- **THEN** the callback shows an error and nothing changes

#### Scenario: Not an allowed user

- **WHEN** a user not in `ALLOWED_USERS` requests `/bot/authorize`
- **THEN** the response is HTTP 403
