## Context

`TwitchUserData.token` is created once per user at first sign-in and never changes. It does three jobs:

1. **Login.** It's the `pvtch_token` cookie. core's `authMiddleware` and `scope-grant.ts` resolve it with `isValidToken` (`token-data-{token}` → user id). pvtch-twitch's `getSessionUser` does the same lookup with its own copy of the prefix.
2. **Overlay key.** It's in the overlay and API URLs that helper pages show and users paste into OBS and chat bots: `/sources/progress/:token/:name`, `/progress/:token/:name/{get,set}`, `/lingo/translate/:token` and `/lingo/config/:token/set`. These routes call `isValidToken` on the URL segment.
3. **Data key.** Some Durable Object names are built from it, e.g. `normalizeKey(user.token, 'lingo-config')` for `PvtchBackend`.

Because (1) and (2) are the same value, a leaked overlay URL is a login. #11 made the cookie HttpOnly and added an Origin check to admin POSTs, but neither helps once the token itself is out. Logout clears the cookie but can't revoke anything, because the token is permanent.

## Goals / Non-Goals

**Goals:**

- A leaked overlay or API URL can't sign anyone in.
- Signing out actually ends the session, and sessions expire.
- Existing overlay URLs, bot commands and stored data keep working without the user changing anything.

**Non-Goals:**

- Rotating or regenerating the overlay key. Job 3 means rotation has to move DO data, which is a separate change.
- Separate read and write overlay keys. Every existing URL would change, and once the overlay key can't sign in, a leak only exposes overlays.
- Listing or revoking a user's other sessions. KV can't list them by user; see Risks.
- Keeping existing logins alive through the change.

## Decisions

### Keep `token` as the overlay key and add session tokens

The alternative, a new overlay key with the old token kept as the session, would break every pasted URL and need DO data moved. Keeping `token` where it is and minting a new value for the cookie changes only the login path, which both workers already centralize: `authMiddleware` plus `sessionUser` in core, and `getSessionUser` in twitch.

### Session records in `PVTCH_ACCOUNTS`

`session-{sessionToken}` → user id, written with `expirationTtl: 2592000` (30 days), so KV deletes it on expiry with no cleanup job. Session tokens come from `createToken()`, the same 16-byte Base58 generator used for user tokens. KV fits because sessions are read on almost every request and written only at sign-in and sign-out. A Durable Object per session would add a hop to every page load for no benefit.

The cookie gets a matching `Max-Age=2592000`, so the browser drops it around the same time the record expires. The TTL is fixed, not sliding: refreshing it would mean a KV write and a `Set-Cookie` on ordinary page loads, and #11 avoided adding `Set-Cookie` to responses that could be cached. Users sign in again every 30 days.

### One shared resolver

`packages/shared/src/session.ts` exports `SESSION_PREFIX`, `SESSION_TTL_SECONDS` and `resolveSession(accounts: KVNamespace, sessionToken: string | undefined): Promise<string | undefined>`. core's middleware and scope-grant flow and pvtch-twitch's `getSessionUser` all use it, so the two workers can't drift apart the way the duplicated `token-data-` prefix could. Both callers already load `twitch-data-{userId}` afterwards and treat a missing record as signed out, which covers removed accounts.

`isValidToken` stays as the overlay-key lookup for URL routes. Its `DEV_TWITCH_USER_ID` bypass for local development moves into the middleware as well, so local development behaves the same for pages and overlays.

### Logout revokes

`/auth/logout` reads `pvtch_token`, deletes `session-{value}` and returns the cleared cookies. If the cookie is missing or the record is already gone, it still clears the cookies and returns 204.

### Cutover: everyone signs out once

There is no dual-read window: after deploy, no code resolves a cookie through `token-data-`. Old cookies hold the overlay key, which resolves to nothing as a session, so those users simply appear signed out. The user accepted this. It closes the hole on deploy instead of waiting for each user to come back. No data migration is needed.

`pvtch_name` cookies from before the change outlive the session they belonged to, so the header would show a name while the server treats the user as signed out. To fix that, the root loader exposes whether `userContext` is set, and `TwitchLogin` treats the user as signed in only when both agree. It clears a stale `pvtch_name` with the existing `useCookie` remove. That works because `pvtch_name` isn't HttpOnly.

## Risks / Trade-offs

- **KV is eventually consistent.** The callback writes `session-{token}` and redirects to `/welcome`, which reads it. Cloudflare's docs say writes are usually visible immediately in the location that made them, and the redirect normally lands on the same location. A new random key has never been read, so there is no cached "not found" to wait out. pvtch-twitch could run elsewhere, but the user reaches it a page or more later.
  - **Mitigation:** none needed beyond a test that the callback writes the record before redirecting. If a sign-in ever lands on a different location, the user sees a signed-out page and the next request resolves.
- **Logout can take up to about 60 seconds to reach other locations.** A deleted key can still be served from another location's cache briefly. The cookie is cleared immediately in the browser that signed out, so only someone who already copied the session token could use that window.
- **Other sessions can't be revoked.** Signing out ends only that browser's session. Ending all of a user's sessions would need a per-user index or a version number on `twitch-data-`.
  - **Mitigation:** sessions expire after 30 days. A `sessionVersion` field checked by `resolveSession` is a small follow-up if needed.
- **Overlay URLs still leak overlay access.** Someone with the URL can still read or set that user's progress bars and call `/lingo/translate`. That's the accepted scope here; rotating the key is the follow-up.
- **The forced re-login is visible.** Every user is signed out once. Overlays keep working, so streams are unaffected; only the www and twitch.pvtch.com pages ask for a new sign-in.
