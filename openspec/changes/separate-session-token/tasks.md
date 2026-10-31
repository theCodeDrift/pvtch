## 1. Shared session module

- [ ] 1.1 Add `packages/shared/src/session.ts` exporting `SESSION_PREFIX = 'session-'`, `SESSION_TTL_SECONDS = 2_592_000` and `resolveSession(accounts, sessionToken)`, which returns the user id from `session-{token}` or `undefined` for a missing token or record. Add `./session` to `package.json` exports, keeping them sorted.
- [ ] 1.2 Test `resolveSession`: found, missing record, missing token, and a `token-data-` record for the same value not being treated as a session.

## 2. core sign-in, middleware and logout

- [ ] 2.1 In `app/routes/auth/callback.tsx`, for both new and returning users, create a session token with `createToken()`, write `session-{sessionToken}` → user id with `expirationTtl: SESSION_TTL_SECONDS`, and pass the session token (not `user.token`) to `sessionCookies`. Keep the `token-data-`/`twitch-data-` writes as they are.
- [ ] 2.2 In `app/lib/session-cookie.ts`, add `Max-Age=SESSION_TTL_SECONDS` to both cookies set at sign-in, and update its tests.
- [ ] 2.3 In `app/middleware/auth.ts`, resolve `pvtch_token` with `resolveSession`, with the `DEV_TWITCH_USER_ID` bypass moved here, then load `twitch-data-{userId}` as today. `userContext.token` stays the user's overlay token.
- [ ] 2.4 In `app/lib/scope-grant.ts`, make `sessionUser` use `resolveSession` the same way.
- [ ] 2.5 Document `isValidToken` in `app/lib/twitch-data.ts` as the overlay/API URL lookup, and check that no code path passes the `pvtch_token` cookie to it (`git grep`).
- [ ] 2.6 In `app/routes/auth/logout.tsx`, delete `session-{cookie value}` when the cookie is present, then return the cleared cookies with 204.
- [ ] 2.7 Expose `signedIn` (whether `userContext` is set) from the layout loader in `app/components/layout/app-layout.tsx` and pass it to `TwitchLogin`. `TwitchLogin` shows signed in only when `pvtch_name` and `signedIn` agree, and removes a `pvtch_name` that has no session.
- [ ] 2.8 Tests:
  - the callback writes a `session-` record with the TTL and sets a cookie different from `user.token`, for a returning user;
  - the middleware ignores a cookie holding the user's token;
  - logout deletes the record and still clears the cookies without one;
  - the scope grant starts only with a real session.

## 3. pvtch-twitch

- [ ] 3.1 In `workers/twitch/src/session.ts`, resolve `pvtch_token` with `resolveSession` and drop the local `token-data-` prefix.
- [ ] 3.2 Update the `login`/`loginAsBot` helpers in `workers/twitch/test/routes.test.ts` to write `session-` records. Add a test that a cookie holding the user's `token-data-` token gets 403 on `/admin/flags` and `/bot/authorize`.

## 4. Verify and ship

- [ ] 4.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
- [ ] 4.2 Update `workers/core/README.md` (Authentication) and `workers/twitch/README.md` if it describes session lookup.
- [ ] 4.3 After deploy:
  - confirm the old cookie shows signed out;
  - sign in and check the header, `/admin/flags` and `/bots/lingual`;
  - check that an existing OBS progress source and a `/lingo/translate/<token>` URL still work;
  - sign out and confirm the old session cookie value no longer works.
