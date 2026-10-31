## Why

A user's `token` is both their login and the key in their overlay and API URLs (`/sources/progress/<token>/…`, `/progress/<token>/…`, `/lingo/translate/<token>`, `/lingo/config/<token>/set`). Those URLs are shown on helper pages and pasted into OBS and chat bots, so anyone who sees one on stream, in a screenshot or in a bot config can sign in as that user, and for an admin that includes the twitch.pvtch.com admin pages. The token also never expires, and signing out only clears the cookie, so a leaked token works forever.

## What Changes

- Sign-in issues a new random **session token** for each login, stored as `session-<token>` → Twitch user id in `PVTCH_ACCOUNTS` with a 30-day expiry. The `pvtch_token` cookie carries the session token, not the user's `token`.
- The user's existing `token` becomes the **overlay key** only. Overlay and API URLs, `token-data-<token>` records and DO names built from the token stay the same, so existing OBS sources and bot commands keep working.
- core's auth middleware, the scope-grant flow and pvtch-twitch's `getSessionUser` resolve logins only through `session-` records. **BREAKING:** an overlay key is no longer accepted as a login.
- `POST /auth/logout` deletes the session record as well as clearing the cookies.
- **BREAKING:** every existing login ends. Cookies hold the old token, which no longer resolves as a session, so everyone signs in again once. There is no dual-read window.
- Out of scope: rotating the overlay key (DO data is keyed by it) and separate read and write overlay keys.

## Capabilities

### New Capabilities

- `session`: login sessions separate from the overlay key — the `session-` record, its expiry, how both workers resolve it, and revocation on logout.

### Modified Capabilities

- `auth`: sign-in sets a session token instead of the user's token, the session cookie is HttpOnly with a 30-day `Max-Age`, token validation means overlay-key lookup only, middleware resolves the user from the session, and logout goes through `/auth/logout`.

## Impact

- `workers/core`: `app/routes/auth/callback.tsx`, `app/middleware/auth.ts`, `app/lib/scope-grant.ts`, `app/lib/session-cookie.ts`, `app/routes/auth/logout.tsx`, `app/lib/twitch-data.ts`, and their tests.
- `workers/twitch`: `src/session.ts` and route tests.
- `packages/shared`: a new `session` module with the record prefix, the TTL and a resolver used by both workers.
- KV `PVTCH_ACCOUNTS`: new `session-` keys. Existing `token-data-` and `twitch-data-` keys are unchanged.
- Users: one forced sign-in after deploy. Overlay URLs are unaffected.
