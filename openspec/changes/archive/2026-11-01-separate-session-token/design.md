## Context

`TwitchUserData.token` is created once per user at first sign-in and never changes. It does three jobs:

1. **Login.** It's the `pvtch_token` cookie. core's `authMiddleware` and `scope-grant.ts` resolve it with `isValidToken` (`token-data-{token}` → user id). pvtch-twitch's `getSessionUser` does the same lookup with its own copy of the prefix. These are the only three places the cookie is resolved.
2. **Overlay key.** It's in the overlay and API URLs that helper pages show and users paste into OBS and chat bots: `/sources/progress/:token/:name`, `/progress/:token/:name/{get,set}`, `/lingo/translate/:token` and `/lingo/config/:token/set`. These routes call `isValidToken` on the URL segment. Loaders build these URLs from `userContext.token`, never from the cookie.
3. **Data key.** Some Durable Object names are built from it, e.g. `normalizeKey(user.token, 'lingo-config')` for `PvtchBackend`.

Because (1) and (2) are the same value, a leaked overlay URL is a login. #11 made the cookie HttpOnly and added an Origin check to admin POSTs, but neither helps once the token itself is out. Three other gaps came up in review:

- `/auth/remove` deletes an account given the token and the public login.
- `DEV_TWITCH_USER_ID` bypasses auth on any host it's set on.
- Login has no OAuth `state`, so an attacker can complete a login into their own account in a victim's browser.

## Goals / Non-Goals

**Goals:**

- A leaked overlay or API URL can't sign anyone in or delete the account.
- Signing out actually ends the session, and sessions expire.
- Existing overlay URLs, bot commands and stored data keep working without the user changing anything.
- The dev bypass can't act in production, and login can't be forced into someone else's account.

**Non-Goals:**

- Rotating or regenerating the overlay key. Job 3 means rotation has to move DO data, which is a separate change.
- Separate read and write overlay keys. Every existing URL would change, and once the overlay key can't sign in, a leak only exposes overlays.
- Ending all of a user's sessions at once. See Risks for the follow-up.
- A replacement account-removal flow.
- Keeping existing logins alive through the change.

## Decisions

### Keep `token` as the overlay key and add session tokens

The alternative, a new overlay key with the old token kept as the session, would break every pasted URL and need DO data moved. Keeping `token` where it is and minting a new value for the cookie changes only the login path, which the three resolvers already centralize.

### Session records bound to the overlay token

`session-{sessionToken}` → `{"userId": "...", "token": "..."}`, written with `expirationTtl: 2592000` (30 days), so KV deletes it on expiry with no cleanup job. Session tokens come from `createToken()`; on the 2^-128 chance one equals the user's token, it's regenerated.

The record carries the overlay token it was issued against, and `resolveSession` accepts it only while `twitch-data-{userId}.token` still matches. Without that check, a user who removed their records and signed up again within 30 days would bring every old session back, because the new `twitch-data-` record has the same Twitch id. With it, re-registration mints a new overlay token and all earlier sessions die. Both resolvers already load `twitch-data-` after the session, so the check costs no extra read.

KV fits because sessions are read on almost every request and written only at sign-in and sign-out. A Durable Object per session would add a hop to every page load for no benefit.

The cookie gets a matching `Max-Age=2592000`. The TTL is fixed, not sliding: refreshing it would mean a KV write and a `Set-Cookie` on ordinary page loads, and #11 avoided adding `Set-Cookie` to responses that could be cached. Users sign in again every 30 days.

On sign-in, if the browser already has a `pvtch_token`, the callback deletes that `session-` record first, so re-logging in on the same browser doesn't leave a 30-day orphan.

### One shared resolver

`packages/shared/src/session.ts` exports:

- `SESSION_PREFIX` and `SESSION_TTL_SECONDS`;
- a zod schema for the record;
- `resolveSession(accounts, sessionToken)`, which returns the `twitch-data-` user record or `undefined`.

`packages/shared` builds without Workers types (`lib: ["ES2022"]`), so `accounts` is a structural `{ get(key: string): Promise<string | null> }`. That's the same approach `secrets.ts` takes with `StoreSecret`. The resolver parses JSON itself rather than using KV's `'json'` overload.

core's middleware and scope-grant flow and pvtch-twitch's `getSessionUser` all use it, so the workers can't drift apart the way the duplicated `token-data-` prefix could. `isValidToken` stays as the overlay-key lookup for URL routes.

### Development bypass only on localhost

Today `isValidToken` returns `DEV_TWITCH_USER_ID` whenever it's set. That makes every page, the scope grant and every overlay act as that user, and nothing ties it to development. This change adds `devUserId(env)` in `app/lib/twitch-data.ts`. It returns the variable only when `new URL(env.PVTCH_APP_URL).hostname === 'localhost'`, the same test `session-cookie.ts` uses.

`devUserId` is used by:

- the middleware and scope-grant `sessionUser`, before `resolveSession`, with no cookie required. That drops today's quirk of needing some `pvtch_token` set.
- `isValidToken` for overlays.

pvtch-twitch never had a bypass and doesn't get one.

### Logout revokes, with an Origin check

`/auth/logout` refuses a present `Origin` that isn't `PVTCH_APP_URL`'s origin, the same idea as pvtch-twitch's `isSameOrigin`. A request without `Origin` is allowed, because `fetch` from the page always sends one and a missing header can't come from a cross-site form. It then reads `pvtch_token`, deletes `session-{value}` and returns the cleared cookies with 204. If the cookie is missing or the record is already gone, it still clears the cookies; `delete()` on a missing key succeeds.

### Login `state`

`/auth/start` mints a random state with `createToken()` and sets `pvtch_login_state` (`Path=/auth/callback`, HttpOnly, SameSite=Lax, `Max-Age=600`, `Secure` except on localhost). `/auth/callback` compares the `state` query parameter with the cookie before reading `error` or `code`, and every callback response clears the cookie. This mirrors the scope grant's state cookie in `scope-grant.ts`.

A plain random value is enough. Login has no `return_to` yet, and a JSON state can carry one later.

### Delete `/auth/remove`

The route takes `{username, token}` in its body with no session or Origin check, and the username is public. It's the one thing a leaked overlay URL could still do to the account itself, and it would permanently break that user's overlay URLs, because re-registration mints a new token. Nothing in the app calls it (`git grep` finds only its route entry). Deleting it is simpler than securing a flow nobody uses. A proper "delete my account" page can come later behind a session.

### Header follows the server

`TwitchLogin` renders only inside `app-layout.tsx`, whose loader runs after `authMiddleware`. The loader returns `displayName` (or `null`), and the component renders from that instead of the `pvtch_name` cookie. This covers several cases:

- **Stale name cookie:** a `pvtch_name` cookie with no session, such as one from before the change, shows signed out and is removed in an effect. `useCookie`'s remove also clears the `Domain=pvtch.com` copy, and `pvtch_name` isn't HttpOnly.
- **Missing name cookie:** a session with no `pvtch_name` still shows signed in.
- **Hydration:** the server render now matches the client.

`/private` has no layout loader. It keeps showing Sign out when `pvtch_name` exists, which is harmless with a stale name, because signing out just clears it.

### Cutover: everyone signs out once

There is no dual-read window: after deploy, no code resolves a cookie through `token-data-`. Old cookies hold the overlay key, which resolves to nothing as a session, so those users simply appear signed out. The user accepted this. It closes the hole on deploy instead of waiting for each user to come back. No data migration is needed.

## Risks / Trade-offs

- **KV is eventually consistent.** The callback writes `session-{token}` and redirects to `/welcome`, which reads it. Cloudflare's docs say writes are usually visible immediately in the location that made them, but they don't guarantee it and advise against relying on it. A new random key has never been read, so there's no cached "not found" ahead of the write.
  - If the first read does miss, that location caches the miss for up to about 60 seconds, and the user appears signed out for up to a minute.
  - Accepted: it hasn't been a problem with the existing `token-data-` write on the same path.
- **Logout takes time to reach other locations.** A deleted key can still be served from other locations' caches for about 60 seconds or more; the docs give the default `cacheTtl` of 60 seconds as a floor, not a guarantee. A thief using a stolen session token from elsewhere is exactly the reader who keeps that cache warm. The cookie is cleared immediately in the browser that signed out.
- **Other sessions can't be revoked.** Signing out ends only that browser's session.
  - Mitigation: sessions expire after 30 days.
  - Follow-up: add a `sessionsNotBefore` timestamp on `twitch-data-` checked by `resolveSession`.
- **Overlay URLs still leak overlay access.** Someone with the URL can still read or set that user's progress bars and call `/lingo/translate`. That's the accepted scope here; rotating the key is the follow-up.
- **Removing `/auth/remove` is breaking** for anyone calling it by hand. No UI or docs reference it.
- **The forced re-login is visible.** Every user is signed out once. Overlays keep working, so streams are unaffected; only the www and twitch.pvtch.com pages ask for a new sign-in.
