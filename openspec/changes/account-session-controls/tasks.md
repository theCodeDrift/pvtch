## 1. Shared session module

- [x] 1.1 In `packages/shared/src/session.ts`:
  - add optional `issuedAt` to `sessionRecord` and optional `sessionsNotBefore` to `accountRecord`;
  - add `newSessionRecord(userId, token)`;
  - make `resolveSession` reject a session whose `issuedAt ?? 0` is below `sessionsNotBefore`.
- [x] 1.2 Test the new rejections and the unchanged paths:
  - issued before the cutoff;
  - no `issuedAt` with a cutoff;
  - equal timestamps;
  - no cutoff.
- [x] 1.3 Use `newSessionRecord` in `auth/callback.tsx` and `account.token.rotate.tsx`, and confirm with `git grep` that no other code writes a `session-` record.

## 2. Account plugin

- [x] 2.1 Add `Account` migration 3:
  - `sessions_not_before INTEGER` on `account`;
  - a new `account_deletion (user_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL)` table.
- [x] 2.2 Carry `sessionsNotBefore` through `OwnedFields`, `read`, `write`, `imported`, `sameOwned` and `publish`.
- [x] 2.3 Add `endSessions(userId)`.
- [x] 2.4 Make `ensure`, `setScopes`, `rotateToken` and `endSessions` throw `AccountDeletionInProgress` while `account_deletion` has a row, and `clearScopes` return without writing.
- [x] 2.5 Test:
  - the cutoff is published;
  - it survives scope and rotation writes;
  - every operation refuses during deletion.

## 3. TwitchChannel purge (pvtch-storage)

- [x] 3.1 Add a migration for a `purging` flag, and make `enableHandler` refuse while it's set.
- [x] 3.2 Add `purge(): { done: boolean }` per the twitch-channel spec, and extend the `AssertRPCSerializable` coverage.
- [x] 3.3 Test:
  - an active Lingual channel returns `done: false` and enqueues one sync;
  - a channel without subscriptions purges fully;
  - `enableHandler` refuses while purging;
  - repeat calls are safe.

## 4. User DO deletion job

- [x] 4.1 Add `endSessions(userId)` and `deleteAccount(userId)` to `User`. `deleteAccount` imports a KV-only account first, writes the marker, and schedules `delete-account` with key `delete-account`.
- [x] 4.2 Handle `delete-account` in `scheduled()`:
  1. channel purge, rescheduling in 60 seconds while not done;
  2. KV deletes, including pending-revocation tokens;
  3. `deleteAlarm()` + `deleteAll()`, then construct the plugins again.

  Legacy Lingo is cleared by `POST /account/delete` instead (see design).

  Log errors without user data.

- [x] 4.3 Test:
  - full deletion;
  - a retry after a KV failure;
  - a repeat `deleteAccount` call;
  - sign-in refused mid-deletion.

## 5. core routes and UI

- [x] 5.1 Add `POST /account/sessions/end`: Origin check, `endSessions`, then re-issue the current session.
- [x] 5.2 Add the `/account` route with the Sessions, Overlay key and Danger zone sections, using shadcn `Card` and `Button` and the Tailwind text colors from the UI guide. Redirect signed-out visitors to `/auth/start`.
- [x] 5.3 Move `RotateOverlayKey` from `welcome.tsx` to `/account`, leaving no link behind. Update its copy to say rotation also signs out other browsers.
- [x] 5.4 Add `/account/delete`:
  - the loader page with the warning and the Twitch steps preview;
  - an action with the Origin check, the case-insensitive login match (TanStack Form + Zod on the client, re-checked on the server), `deleteAccount`, session revocation, cookie clearing and the redirect.
- [x] 5.5 Add the static `/account/deleted` page with the confirmation and the three Twitch steps.
- [x] 5.6 In `auth/callback.tsx`, redirect to `/account/deleted` when `ensureAccount` throws `AccountDeletionInProgress`.
- [x] 5.7 Add "Account" above "Sign out" in the `twitch-login.tsx` dropdown.
- [x] 5.8 Register the new routes in `app/routes.ts`.

## 6. Verification

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
- [ ] 6.2 Manual check against local dev:
  - sign in on two browsers, sign out everywhere on one, and the other is signed out;
  - delete an account with Lingual enabled, and the KV records, DO data and EventSub subscriptions are gone;
  - signing in again creates a fresh account.
