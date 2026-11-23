# Plan: account settings, sign out everywhere, and delete my account

**Status:** draft for review, revision 3 · **Follows:** `2026-11-01-separate-session-token`

## Decision needed

Approve this scope and these five choices before I write the full OpenSpec change (design, spec deltas, tasks):

1. **A new `/account` settings page** holds every account control: sign out, sign out everywhere, overlay key rotation and account deletion. It's reached from the Twitch name in the header.
2. **Sign out everywhere uses a `sessionsNotBefore` cutoff.** The `User` DO's account table is the source of truth, and it's published to the `twitch-data-` KV record that sessions are already checked against. There's no per-user list of sessions.
3. **Account deletion is immediate and complete:** no grace period or soft delete, and the user confirms by typing their Twitch login.
4. **Deletion runs on the `User` DO's existing `JobScheduler`**, so a partial failure finishes on retry instead of leaving half an account.
5. **Nothing is logged about deletions, and a `/account/deleted` page walks the user through the Twitch side.** It confirms that all pvtch data is gone, then lists what only they can do on Twitch: disconnect the pvtch app, unmod pvtchbot, and remove pvtch overlays and bot commands. pvtch stores no user access token, so it can't revoke the Twitch grant itself.

**My recommendation:** approve all five.

## Why

`separate-session-token` closed the leaked-overlay-URL hole first, because that exposure was the most pressing. It deliberately left two gaps for a change that does them properly:

- **Other sessions can't be ended.** Signing out ends only the current browser. Today the only way to kill a session on a lost laptop is "Rotate overlay key" on `/welcome`. That does end every other session, but it also breaks every OBS source and bot command, so it's the wrong tool for that job.
- **There's no way to delete an account.** `/auth/remove` was removed because anyone with an overlay URL could call it. We do want users to be able to clean up their data, but it has to be behind a real session.

Both need a home. pvtch has no account settings page today: the header's Twitch name opens a menu with only "Sign out", and overlay key rotation sits on `/welcome`. This change adds that page.

## What changes

### 1. Account settings page

- **New route `/account`**, signed-in only, behind `authMiddleware`. Signed-out visitors are sent to sign in.
- **Header:** the Twitch name menu in `twitch-login.tsx` gains an "Account" item linking to `/account`, above "Sign out".
- **Sections on the page:**
  - **Sessions:** "Sign out" (this browser) and "Sign out everywhere".
  - **Overlay key:** the existing `RotateOverlayKey` component, moved from `/welcome`. `/welcome` drops it entirely and gets no link in its place.
  - **Danger zone:** "Delete account", linking to the confirmation page.

### 2. Sign out everywhere

- **New action: `POST /account/sessions/end`.** It sits behind `authMiddleware` with the same Origin check as `/auth/logout`.
- **Where the cutoff lives:**
  - The `User` DO's `Account` plugin is the source of truth. Migration 3 adds `sessions_not_before INTEGER` to its `account` table.
  - New op: `endSessions(userId)` sets it to `Date.now()` inside `exclusive`, so it's serialized with logins, scope grants and rotation.
  - `publish` copies it onto the `twitch-data-{id}` KV record as `sessionsNotBefore`. KV stays the read model, as it is today for the token and scopes.
- **Session records get `issuedAt`.** `resolveSession` in `packages/shared/src/session.ts` rejects any session issued before `sessionsNotBefore`.
  - It already reads `twitch-data-` after the session, so the check costs no extra KV read and needs no DO call per request.
  - Sessions written before this change have no `issuedAt` and count as 0. They end on the first "sign out everywhere".
- **The current browser stays signed in.** The action re-issues this request's session with a fresh `issuedAt`, the same way `account.token.rotate.tsx` re-issues against the new token.
- **Rotation keeps ending sessions as a side effect**, and its copy on `/account` says so.

### 3. Delete my account

- **New page `/account/delete` and action `POST /account/delete`.** Signed-in only, with an Origin check.
  - The user types their Twitch login to confirm. A mismatch is rejected server-side, not only in the form.
  - The page says plainly that overlays stop working immediately, including during a live stream.
- **The action calls `deleteAccount(userId)` on the `User` DO.** That records a `deleting` marker and schedules a `delete-account` job on the DO's existing `JobScheduler`, with key `delete-account`, so a second click doesn't queue a second job.
- **The job runs these steps in order.** Each step is idempotent, so a retry repeats from the top safely:
  1. **Twitch side, in `TwitchChannel` (pvtch-storage).** `disableHandler` runs for every enabled handler, which schedules the EventSub unsubscribe and takes the bot out of the channel. Once the subscriptions are gone, a new `purge()` RPC clears Lingual config, flags and the message cache, and cancels that DO's alarm.
  2. **Legacy Lingo config** under the overlay token in `PvtchBackend`, if any (`lingo-legacy.ts` already knows the key).
  3. **The account read model in KV:** `twitch-data-{id}` and `token-data-{token}`. After this, every session for the user fails `resolveSession` (they expire from KV within 30 days), and the user's overlay URLs return 404.
  4. **The `User` DO's storage:** progress, Lingo, profile, boards, the account row and the scheduler's own tables (`deleteAlarm` + `deleteAll`). This runs last, so the marker and the job disappear with everything else.
- **The request clears `pvtch_token` and `pvtch_name`** and redirects to `/account/deleted`. The rest of the deletion finishes in the background, normally within seconds.
- **New page `/account/deleted`.** A static page that needs no session, since the user no longer has one.
  - **It confirms the deletion:** all pvtch data is deleted, including overlays, progress bars, boards, Lingo and Lingual settings and the account itself.
  - **Then it lists what's left for the user to do on Twitch**, because pvtch can't do these for them:
    1. Disconnect pvtch under Twitch → Settings → Connections, which removes the permissions they granted.
    2. Unmod pvtchbot in their channel (`/unmod pvtchbot`) if they made it a moderator for Lingual.
    3. Remove pvtch browser sources from OBS and any chat-bot commands that call pvtch URLs. They return 404 now, but leftover sources and commands keep making requests that fail.
- **No record of the deletion is kept**, in line with keeping our logging footprint small. Failures still log an error without user data, so a stuck job is visible.
- **Signing in again later is a fresh start:** a new overlay token and no data. That's already how `Account.ensure` behaves when it finds no record.

## Key choices

### `sessionsNotBefore` instead of tracking sessions

The alternative is to keep a list of session tokens in the `User` DO and delete each `session-` key.

- **That's more state to keep correct.** Every sign-in, sign-out and expiry has to update the list, and expired keys disappear from KV without telling us.
- **It's no faster.** A deleted KV key can still be served from another location's cache for about 60 seconds, the same delay as a changed `twitch-data-` record.

The cutoff is one DO write plus the KV publish that already happens, and checking it piggybacks on a read we already do. This is the follow-up the session-token design named.

### Immediate, complete deletion

- A grace period needs a scheduled purge and a "restore" path. That's more surface for a feature that will be rare.
- Typing your login to confirm guards against a mis-click.
- Because a session is required, a leaked overlay URL can't reach this action.

### Deletion on the existing scheduler

Deletion touches three stores: TwitchChannel in another worker, KV and DO storage. Any of them can fail partway. The `User` DO already has a `JobScheduler` with idempotency keys and alarm-driven retries, which `revoke-tokens` and `sync-profile` use. Deletion becomes another task on it rather than new infrastructure.

- **While the `deleting` marker is set:**
  - `Account.ensure` refuses to recreate the account, so a sign-in mid-delete can't race it.
  - `/account/delete` reports "Deletion in progress".
- **The final `deleteAll()` clears the marker and the scheduler together.** Nothing is left behind to fire again.

### Twitch authorization

We don't store user access tokens; only the app token is in `PVTCH_KV`. So there's nothing for us to revoke, and moderator status is the streamer's to remove. `/account/deleted` hands both to the user as next steps. If they disconnect pvtch on Twitch, the existing `authorization.revoke` handler runs harmlessly against a deleted account.

The delete confirmation page previews these same steps, so nobody is surprised by them afterwards.

## Out of scope

- Separate read and write overlay keys.
- Exporting data before deletion.
- Admin-initiated deletion of another user's account.
- A "new sign-in" banner offering to sign out elsewhere. Session controls live only on `/account`.

## Risks

- **KV propagation.** For up to about 60 seconds after either action, another location may still accept an ended session. The same trade-off was accepted for logout.
- **Deleting the account during a live stream** breaks that stream's overlays immediately. The confirmation page says so.
- **Bot departure is asynchronous.** `disableHandler` schedules the EventSub unsubscribe instead of doing it inline, so the bot can linger for one sync cycle. The deletion job waits for the subscriptions to clear before calling `purge()`.
- **Moving rotation off `/welcome`** changes where existing users find it. The "Account" item in the header menu is the one place to look, and we don't leave a technical pointer behind on `/welcome`.
