## Context

`separate-session-token` split login sessions from the overlay key:

- **Sessions:** `session-{sessionToken}` in `PVTCH_ACCOUNTS`, resolved by `resolveSession` in `packages/shared/src/session.ts`.
- **The account:** `twitch-data-{id}` and `token-data-{token}`. Since then, the `User` DO's `Account` plugin has become the single writer of those KV records (`ensure`, `setScopes`, `clearScopes`, `rotateToken`). It serializes every operation for a user through an in-memory `exclusive` queue.

Two follow-ups were left open and are approved in `proposal.md`: ending all of a user's sessions, and deleting an account properly. There is also no account settings page. The header's Twitch name opens a menu with only "Sign out", and `RotateOverlayKey` lives on `/welcome`.

Per-user data lives in four places:

| Store | Key | What |
|---|---|---|
| KV `PVTCH_ACCOUNTS` | `twitch-data-{id}`, `token-data-{token}`, `session-{s}` | account read model, overlay key index, sessions |
| `User` DO (core) | `twitch:{id}` | account row, progress, Lingo, profile, boards, scheduler |
| `PvtchBackend` DO (core) | `normalizeKey(token, 'lingo-config')` | legacy Lingo config not yet migrated |
| `TwitchChannel` DO (pvtch-storage) | `twitch:{id}` | handler state, EventSub subscription records, Lingual settings, flags, scheduler; message cache in memory |

pvtch stores no user access token. The only Twitch token is the app token in `PVTCH_KV`.

## Goals / Non-Goals

**Goals:**

- One `/account` page for every account control, reached from the header.
- Sign out everywhere, without breaking overlays.
- Self-service account deletion that removes every pvtch record for the user and survives partial failure.
- After deletion, tell the user exactly what's left for them to do on Twitch.

**Non-Goals:**

- Separate read and write overlay keys.
- Data export.
- Admin deletion of other accounts.
- Logging deletions. We keep our logging footprint small.
- A "new sign-in" banner.

## Decisions

### `/account` is the home for account controls

- **`/account` is a signed-in route** behind `authMiddleware`. A signed-out visitor is redirected to `/auth/start`.
- **It has three sections:**
  - **Sessions:** Sign out, and Sign out everywhere.
  - **Overlay key:** `RotateOverlayKey`, moved from `/welcome`.
  - **Danger zone:** a link to `/account/delete`.
- **`/welcome` loses `RotateOverlayKey`** and gets nothing in its place.
- **The header's Twitch name menu** in `twitch-login.tsx` gains "Account" (a link to `/account`) above "Sign out".
  - The private-instance unauthorized variant still links to `/private` and is unchanged.

### `sessionsNotBefore`: owned by the DO, read from KV

The `Account` plugin's migration 3 adds `sessions_not_before INTEGER` (nullable) to the `account` table.

- **New op `endSessions(userId)`:**
  - runs in `exclusive`;
  - sets the column to `Date.now()`;
  - publishes, so the cutoff is serialized with logins, scope grants and rotation.
- **`publish` writes the cutoff to the KV record.** `OwnedFields` gains `sessionsNotBefore?: number`, and `publish` writes it onto `twitch-data-{id}`. KV stays the read model, so no request path makes a DO call to check sessions.
- **Existing records:** `read()` selects the column, and `imported()` copies `sessionsNotBefore` from an existing KV record. An account first touched by an older code path therefore keeps its cutoff.
- **Session records gain `issuedAt`** (epoch ms), in both `sessionRecord` and `accountRecord.sessionsNotBefore`:
  - `resolveSession` rejects a session when `account.sessionsNotBefore` is set and `(session.issuedAt ?? 0) < account.sessionsNotBefore`;
  - `issuedAt` is optional in the schema, so sessions written before this change still parse and count as issued at 0.
- **Every writer of a session record sets `issuedAt`:**
  - the callback;
  - token rotation's re-issue;
  - the new end-sessions action.

  A shared `newSessionRecord(userId, token)` helper in `packages/shared/src/session.ts` builds the record, so callers can't forget it.

**Why not a list of sessions in the DO:** keeping it correct needs an update on every sign-in, sign-out and expiry, and KV expiry doesn't notify us. Deleting keys propagates no faster than updating `twitch-data-`; both take up to about 60 seconds at other locations.

### `POST /account/sessions/end`

1. **Checks:** `authMiddleware`, the same Origin check as `/auth/logout`, and 401 without a user.
2. **Ends sessions:** calls `PVTCH_USER…endSessions(user.id)`.
3. **Re-issues the current session:** if the request has a `pvtch_token`, it re-writes `session-{cookie}` with `newSessionRecord(user.id, account.token)`. `issuedAt` is now at or after the cutoff, so this browser stays signed in. This is the same pattern as `account.token.rotate.tsx`.
4. **Returns** `{ ok: true }`.

Equal timestamps are allowed (`issuedAt >= notBefore` survives), which is why the re-issue happens after `endSessions` returns.

### Account deletion: a `delete-account` job on the `User` DO

**`deleteAccount(userId)`** on `User`:

1. Inside `Account.exclusive`, writes a `deleting` row (new `account_deletion` table in migration 3: `user_id`, `started_at`).
2. Schedules `delete-account` on the existing `JobScheduler` with idempotency key `delete-account`, due immediately.
3. Returns. A second call while the row exists does nothing and returns.

**While `account_deletion` has a row:**

- `Account.ensure` throws `AccountDeletionInProgress`. The callback turns that into a redirect to `/account/deleted`.
- `setScopes`, `clearScopes`, `rotateToken` and `endSessions` also refuse.

**The `delete-account` task** re-runs from the top on each attempt, and every step is idempotent:

1. **TwitchChannel:** call `channel.purge()` (below).
   - If it returns `{ done: false }`, reschedule `delete-account` in 60 seconds and stop this attempt.
2. **Legacy Lingo:** delete the `PvtchBackend` legacy Lingo entry for the account's token, using the same key `lingo-legacy.ts` reads. A missing entry is fine.
3. **KV:** delete `token-data-{token}`, every pending-revocation token's `token-data-`, and `twitch-data-{id}`. `session-` records are left to expire: `resolveSession` already fails without `twitch-data-`.
4. **The DO itself:** `ctx.storage.deleteAlarm()`, then `ctx.storage.deleteAll()`. This removes the `account_deletion` row, the scheduler's tables and every plugin's tables at once.

The token for steps 2 and 3 comes from the DO's `account` row, which survives until step 4. If the DO never had an account row (a KV-only account), `deleteAccount` imports it first, as `require` does today.

A thrown error in any step propagates to the scheduler, which retries with its existing backoff. Errors log without user data.

**Why the scheduler:** `revoke-tokens` and `sync-profile` already run on it, with idempotency keys and alarm-driven retries. Deletion needs exactly that and nothing new.

### `TwitchChannel.purge()`

A new RPC on the storage DO returns `{ done: boolean }`:

1. **Mark the purge.** Set a `purging` flag in its core table (a new migration), so `enableHandler` refuses while purging.
2. **Disable handlers.** `disableHandler` each id from `listHandlers()`. Already-disabled ones are no-ops; changed ones schedule `sync-subscriptions:<senderId>` as today, which unsubscribes EventSub and so takes the bot out of the channel.
3. **Wait for the unsubscribes.** If any sender still has subscription records, return `{ done: false }`.
4. **Delete everything.** Otherwise, clear the in-memory message cache, `deleteAlarm()`, `deleteAll()`, and return `{ done: true }`.

It's added to the `Expect<AssertRPCSerializable<TwitchChannel>>` coverage and returns a plain object. pvtch-storage deploys before core, as the deploy workflow already guarantees.

**Why the TwitchChannel checks for leftover subscriptions itself:** it owns the subscription records, and the sync job that clears them. The `User` DO only needs a yes or no.

### `/account/delete` and `/account/deleted`

**`/account/delete` (GET, signed in):**

- explains what will be deleted;
- warns that overlays stop working immediately, including mid-stream;
- previews the Twitch next steps;
- has a form where the user types their Twitch login.

**`POST /account/delete`:**

1. **Checks:** `authMiddleware`, the Origin check, and the typed login compared case-insensitively with `user.login`. A mismatch returns 400 with the form data, per the UI conventions.
2. **Deletes:** calls `deleteAccount(user.id)`.
3. **Signs out:** deletes this request's `session-` record and clears `pvtch_token` and `pvtch_name`.
4. **Redirects** to `/account/deleted`.

**`/account/deleted`** is a static page with no session and no loader data. It says all pvtch data is deleted and lists the next steps:

1. Disconnect pvtch under Twitch → Settings → Connections.
2. Unmod pvtchbot (`/unmod pvtchbot`) if it was made a moderator for Lingual.
3. Remove pvtch browser sources from OBS and any chat-bot commands that call pvtch URLs.

The page states the deletion as done even though the job may still be running. The KV read model is gone within seconds, and the job retries until the DO data is gone.

## Risks / Trade-offs

- **KV propagation:** for up to about 60 seconds after either action, another location may still accept an ended session or resolve a deleted overlay key. The same trade-off was accepted for logout.
- **A stuck TwitchChannel purge:** if the subscription sync keeps failing, `delete-account` keeps rescheduling every 60 seconds. The account is already unusable at that point, because the `deleting` row blocks logins. The DO data remains until the sync succeeds. An error log without user data makes it visible.
- **Re-signup during deletion:** blocked by `AccountDeletionInProgress` until the job finishes. The user sees `/account/deleted` again.
- **Late Twitch events:** an `authorization.revoke` or chat event arriving after the purge recreates an empty `TwitchChannel` or `User` instance. `clearScopes` on an unknown user is already a no-op. The empty instance holds no user data.
- **Moving rotation off `/welcome`:** users who knew where it was will find it under Account in the header menu.

## Migration Plan

1. Deploy pvtch-storage with `purge()` and its migration (phase 1, as usual).
2. Deploy core.
   - The `Account` migration 3 runs lazily per DO.
   - Old sessions keep working until the user's first "sign out everywhere".
3. Rollback: core can roll back freely.
   - `issuedAt` and `sessionsNotBefore` are extra fields that older code ignores.
   - An in-flight deletion would stall until core is redeployed. Its `deleting` row stays, so it resumes afterwards.
