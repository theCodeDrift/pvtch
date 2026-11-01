## 1. Shared session module

- [x] 1.1 Add `packages/shared/src/session.ts` exporting:
  - `SESSION_PREFIX = 'session-'` and `SESSION_TTL_SECONDS = 2_592_000`;
  - a zod `sessionRecord` (`{ userId, token }`);
  - `resolveSession(accounts, sessionToken)`.

  `accounts` is typed structurally (`{ get(key: string): Promise<string | null> }`), like `StoreSecret` in `secrets.ts`. `resolveSession` parses the session and `twitch-data-{userId}` records itself, and returns the user record only when its `token` matches the session's. Add `./session` to `package.json` exports, keeping them sorted.

- [x] 1.2 Test `resolveSession` for:
  - a session that resolves;
  - a missing token;
  - a missing record;
  - a malformed record;
  - a missing `twitch-data-` record;
  - a `token` mismatch (account re-created);
  - a `token-data-` record for the same value not counting as a session.

## 2. core sign-in

- [x] 2.1 In `app/routes/auth/start.tsx`, mint a state with `createToken()`, add `state` to the authorize URL, and set `pvtch_login_state` (`Path=/auth/callback`, HttpOnly, SameSite=Lax, `Max-Age=600`, `Secure` except on localhost). Remove the TODO.
- [x] 2.2 In `app/routes/auth/callback.tsx`, before reading `error` or `code`, return 400 unless the `state` query parameter equals the `pvtch_login_state` cookie. Clear that cookie on every response, including the `/auth/error` redirect.
- [x] 2.3 In the callback, for both new and returning users:
  1. delete `session-{existing pvtch_token}` if the request carries one;
  2. mint a session token with `createToken()`, regenerating it if it equals the user's token;
  3. write `session-{sessionToken}` → `{ userId, token }` with `expirationTtl: SESSION_TTL_SECONDS`;
  4. pass the session token, not `user.token`, to `sessionCookies`.

  Keep the `token-data-` and `twitch-data-` writes as they are.

- [x] 2.4 In `app/lib/session-cookie.ts`, add `Max-Age=SESSION_TTL_SECONDS` to both cookies set at sign-in, and update its tests.

## 3. core session lookup and the dev bypass

- [x] 3.1 In `app/lib/twitch-data.ts`, add `devUserId(env)`, which returns `DEV_TWITCH_USER_ID` only when the hostname of `PVTCH_APP_URL` is `localhost`. Use it in `isValidToken` in place of the unconditional check, and document `isValidToken` as the overlay/API URL lookup. Fix the `token` comment on `TwitchUserData` ("overlay key", not "secret"), and document `TwitchUser.token` in `app/context.ts` as the overlay key.
- [x] 3.2 In `app/middleware/auth.ts`, resolve the user as `devUserId(env)` (then load `twitch-data-`), or `resolveSession(env.PVTCH_ACCOUNTS, cookie)`. Drop the `if (twitchId && token)` cookie requirement for the dev bypass.
- [x] 3.3 In `app/lib/scope-grant.ts`, make `sessionUser` resolve the same way, through `devUserId` or `resolveSession`.
- [x] 3.4 Run `git grep` to confirm that nothing passes the `pvtch_token` cookie to `isValidToken` or reads `token-data-` for it.

## 4. core logout, account removal and header

- [x] 4.1 In `app/routes/auth/logout.tsx`, return 403 when `Origin` is present and isn't `new URL(env.PVTCH_APP_URL).origin`. Otherwise delete `session-{cookie value}` if the cookie is present, and return the cleared cookies with 204.
- [x] 4.2 Delete `app/routes/auth/remove.tsx` and its entry in `app/routes.ts`.
- [x] 4.3 In `app/components/layout/app-layout.tsx`, return `displayName` (or `null`) from `userContext` in the loader and pass it to `TwitchLogin`. `TwitchLogin` renders from that prop, and when it's `null` it removes any `pvtch_name` cookie in a `useEffect`. Leave `/private` as is; its stale-name Sign out is harmless, as noted in the design.

## 5. core tests

- [x] 5.1 Move `test/auth/scope-grant.test.ts` fixtures from `token-data-tok-1` plus a `pvtch_token=tok-1` cookie to a `session-` record. Extend its `FakeKV` with `delete` and record `put` options, so the TTL can be asserted.
- [x] 5.2 Add `test/auth/login.test.ts` covering:
  - `/auth/start` sets the state cookie and puts `state` in the URL;
  - the callback rejects a missing or mismatched state;
  - for a returning user, with Twitch's `fetch` mocked, the callback writes a `session-` record with the TTL, sets a cookie different from `user.token`, and deletes the browser's previous session.
- [x] 5.3 Add middleware tests:
  - a session resolves;
  - a cookie holding the user's token doesn't;
  - an overlay-token mismatch doesn't;
  - `DEV_TWITCH_USER_ID` applies on localhost and is ignored on a production `PVTCH_APP_URL`.
- [x] 5.4 Extend `test/auth/session-cookie.test.ts` so that logout:
  - deletes the record;
  - clears the cookies even with no session;
  - returns 403 for a foreign `Origin`.

## 6. pvtch-twitch

- [x] 6.1 In `workers/twitch/src/session.ts`, resolve `pvtch_token` with `resolveSession` and drop the local `token-data-` prefix.
- [x] 6.2 Update the `login` and `loginAsBot` helpers in `workers/twitch/test/routes.test.ts` to write `session-` records. Add a test that a cookie holding a `token-data-` token gets 403 on `/admin/flags` and `/bot/authorize`.

## 7. Docs, verify and ship

- [x] 7.1 Update the docs:
  - the Authentication section of `workers/core/README.md`: sessions, the overlay key, and that API routes validate the overlay key;
  - the `DEV_TWITCH_USER_ID` note in `workers/core/.dev.vars.example` (localhost only);
  - `workers/twitch/README.md`, if it describes session lookup.
- [x] 7.2 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
- [x] 7.3 After deploy:
  1. Confirm the old cookie shows signed out.
  2. Sign in and check the header, `/admin/flags` and `/bots/lingual`.
  3. Check that an existing OBS progress source and a `/lingo/translate/<token>` URL still work.
  4. Sign out and confirm the old session cookie value no longer works.
  5. Confirm `/auth/remove` returns 404.
- [x] 7.4 After archiving, update the `auth` spec's Purpose, which still says "token-based sessions".
