## Why

A user's `token` is both their login and the key in their overlay and API URLs (`/sources/progress/<token>/…`, `/progress/<token>/…`, `/lingo/translate/<token>`, `/lingo/config/<token>/set`). Those URLs are shown on helper pages and pasted into OBS and chat bots, so anyone who sees one on stream, in a screenshot or in a bot config can do three things:

- sign in as that user, which for an admin includes the twitch.pvtch.com admin pages;
- delete the account through `/auth/remove`, which takes the token and the public login in its body;
- keep going forever, because the token never expires and signing out only clears the cookie.

Login also has no OAuth `state`. An attacker can sign a victim into the attacker's account, and the victim's helper pages then show the attacker's overlay URLs.

## What Changes

- **Session tokens.** Sign-in issues a new random session token for each login, stored as `session-<token>` → `{ userId, token }` in `PVTCH_ACCOUNTS` with a 30-day expiry. The `pvtch_token` cookie carries the session token, not the user's `token`.
  - A session only resolves while its `token` still matches the user's `twitch-data-` record, so removing an account and signing up again can't revive old sessions.
  - Signing in again on the same browser deletes the session it replaces.
- **Overlay key.** The user's existing `token` becomes the overlay key only. Overlay and API URLs, `token-data-<token>` records and DO names built from the token are unchanged, so existing OBS sources and bot commands keep working.
- **Session lookup.** core's auth middleware, the scope-grant flow and pvtch-twitch's `getSessionUser` resolve logins only through `session-` records. **BREAKING:** an overlay key is no longer accepted as a login.
- **Dev bypass.** `DEV_TWITCH_USER_ID` applies only when `PVTCH_APP_URL` is localhost. It's ignored anywhere else, so a stray production setting can't make every visitor that user.
- **Logout.** `POST /auth/logout` checks the request's Origin, deletes the session record and clears the cookies.
- **Login state.** Login gets OAuth `state`. `/auth/start` sets a short-lived HttpOnly state cookie, and `/auth/callback` rejects a missing or mismatched `state` before exchanging the code.
- **Removed:** `/auth/remove` is deleted. Nothing in the app calls it, and it let anyone with an overlay URL delete the account. **BREAKING** for anyone calling it by hand.
- **Header.** The header shows signed in from the server's session, not the `pvtch_name` cookie, and clears a `pvtch_name` cookie that has no session.
- **BREAKING:** every existing login ends. Cookies hold the old token, which no longer resolves as a session, so everyone signs in again once. There is no dual-read window.
- **Out of scope:**
  - rotating the overlay key, since DO data is keyed by it;
  - separate read and write overlay keys;
  - ending all of a user's sessions at once;
  - a replacement account-removal flow.

## Capabilities

### New Capabilities

- `session`: login sessions separate from the overlay key. Covers:
  - the `session-` record and its binding to the overlay token;
  - expiry;
  - how both workers resolve it;
  - revocation on logout and re-login;
  - the localhost-only dev bypass.

### Modified Capabilities

- `auth`:
  - Login initiation and the callback use OAuth `state`.
  - Sign-in sets a session token instead of the user's token, in an HttpOnly cookie with a 30-day `Max-Age`.
  - Token validation means overlay-key lookup only, and the middleware resolves the user from the session.
  - The header follows the server's session.
  - Account removal is removed.

## Impact

- `workers/core`:
  - `app/routes/auth/start.tsx`, `callback.tsx` and `logout.tsx`; `remove.tsx` is deleted
  - `app/routes.ts`
  - `app/middleware/auth.ts`
  - `app/lib/scope-grant.ts`, `session-cookie.ts` and `twitch-data.ts`
  - `app/context.ts`
  - `app/components/twitch-login.tsx` and `layout/app-layout.tsx`
  - `README.md` and `.dev.vars.example`
  - tests
- `workers/twitch`: `src/session.ts` and route tests.
- `packages/shared`: a new `session` module with the record prefix, the TTL, the record shape and a resolver used by both workers.
- KV `PVTCH_ACCOUNTS`: new `session-` keys. Existing `token-data-` and `twitch-data-` keys are unchanged.
- Users: one forced sign-in after deploy. Overlay URLs are unaffected.
