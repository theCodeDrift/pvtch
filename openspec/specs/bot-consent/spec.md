# bot-consent Specification

## Purpose

How a streamer turns on the Lingual chat bot from Bots → Lingual on www, the general `/auth/grant` consent for `channel:bot`, the rollout gate, and the one-time authorization of the bot account on `pvtch-twitch`.

## Requirements

### Requirement: Lingual enable uses the general grant flow

Enabling Lingual SHALL require `channel:bot` in the user's recorded scopes. The `/bots/lingual` "Turn on Lingual" action SHALL call `enableHandler('lingual')` on the user's `TwitchChannel` when `channel:bot` is recorded; otherwise it SHALL redirect to `/auth/grant?scopes=channel:bot&return_to=/bots/lingual?enable=1`. When `/bots/lingual` loads with `enable=1` and `channel:bot` recorded, it SHALL call `enableHandler('lingual')` and remove the parameter. Lingual SHALL NOT implement its own OAuth routes.

#### Scenario: First enable

- **WHEN** a user without `channel:bot` clicks Turn on Lingual
- **THEN** they go through `/auth/grant`, return to `/bots/lingual?enable=1`, and `lingual` is enabled

#### Scenario: Scope already granted

- **WHEN** a user with `channel:bot` recorded clicks Turn on Lingual
- **THEN** `lingual` is enabled with no Twitch redirect

#### Scenario: Grant declined

- **WHEN** the user returns with `grant_error=access_denied`
- **THEN** `lingual` stays disabled and the page explains the permission is required

### Requirement: Bot settings UI

The pvtch dashboard sidebar (`app-layout.tsx`) SHALL gain a section titled "Bots" whose first entry is "Lingual", linking to `/bots/lingual` inside the shared app layout. During rollout, the section and the page's controls SHALL be visible only to users whose Twitch login is in `LINGUAL_PREVIEW_USERS` (a comma-separated `pvtch` var, case-insensitive; empty shows them to no one). The page SHALL show `lingual`'s state (`getHandler('lingual')`) and its sender's stored subscription status (`getSubscription('botlingual', 'channel.chat.message')`) from `TwitchChannel` (Off, Connecting, Live, or the failed status), the sender's login (from `TWITCH_SENDERS`), and a Settings form for Lingual's own target language (supported languages only) and up to 25 ignored chatters, saved with `lingual().setSettings()`. It SHALL offer "Turn on Lingual" when disabled and "Turn off Lingual" when enabled. Turning off SHALL call `disableHandler('lingual')` (which schedules the sync) and SHALL NOT remove recorded scopes.

#### Scenario: Enabled with pending subscription

- **WHEN** `lingual` is enabled and the subscription status is `webhook_callback_verification_pending` or not yet recorded
- **THEN** the UI shows Lingual as Connecting

#### Scenario: Disable

- **WHEN** the user clicks Turn off Lingual
- **THEN** `lingual` is disabled and a success toast is shown

#### Scenario: Rollout gate

- **WHEN** a logged-in user whose login is not in `LINGUAL_PREVIEW_USERS` views `/bots/lingual`
- **THEN** no bot controls are shown and the sidebar has no Bots section

#### Scenario: Sidebar entry

- **WHEN** a user in `LINGUAL_PREVIEW_USERS` views any page in the app layout
- **THEN** the sidebar shows a "Bots" section containing "Lingual" linking to `/bots/lingual`

#### Scenario: No target language yet

- **WHEN** the user has no Lingual language saved
- **THEN** the page tells them to pick one in the Settings form; Lingual stays quiet until they do

#### Scenario: Unsupported language

- **WHEN** the user submits a language that is not on the supported target list
- **THEN** nothing is saved and an error is shown

### Requirement: One-time bot account authorization

`pvtch-twitch` SHALL provide `GET /bot/authorize?sender=<senderId>` that redirects to Twitch authorize with `scope=user:bot user:read:chat user:write:chat` and `redirect_uri=https://twitch.pvtch.com/bot/callback`, carrying the `senderId` in the OAuth `state`, and `GET /bot/callback` that exchanges the code and verifies the authorizing user's id equals `TWITCH_SENDERS[senderId].userId`. An unknown `senderId` SHALL return HTTP 400. This is separate from `/auth/grant` because the authorizing Twitch account is the bot, not the logged-in pvtch user. Both routes SHALL require a valid pvtch session (the `pvtch_token` cookie, set on `Domain=pvtch.com`, resolved through the shared `PVTCH_ACCOUNTS` KV) belonging either to that sender's account itself or to a user in `ADMIN_USERS` (a comma-separated list of Twitch logins on `pvtch-twitch`; empty allows no one). Admitting the bot account lets it log into www and open `/bot/authorize` with a single Twitch login; the callback's id check still rejects every other authorizing account. The resulting tokens SHALL NOT be stored.

#### Scenario: Bot account grants scopes

- **WHEN** an admin or botlingual completes `/bot/authorize?sender=botlingual` logged into Twitch as botlingual
- **THEN** the callback confirms the grant and shows success

#### Scenario: Wrong Twitch account

- **WHEN** the authorizing Twitch user id is not the requested sender's `userId`
- **THEN** the callback shows an error and nothing changes

#### Scenario: Not an allowed user

- **WHEN** a user who is neither the sender's account nor in `ADMIN_USERS` requests `/bot/authorize?sender=botlingual`
- **THEN** the response is HTTP 403

#### Scenario: Bot account logged into www

- **WHEN** botlingual, logged into www and not in `ADMIN_USERS`, requests `/bot/authorize?sender=botlingual`
- **THEN** it is redirected to Twitch; `/admin/bootstrap` still returns HTTP 403 for it

#### Scenario: Unknown sender

- **WHEN** an admin requests `/bot/authorize?sender=nope`
- **THEN** the response is HTTP 400
