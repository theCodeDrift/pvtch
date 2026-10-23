## Context

- **Lingo today**: a third-party chatbot calls `GET|POST /lingo/translate/:token` on `pvtch-api`. The route checks the known-bots list, `!` commands, `imtyping`, and the user's ignore list. It loads `{ bots, language }` from the `User` DO's `lingo` plugin, runs `decide()` (preprocess, length gate, script gate, tinyld + franc ensemble), calls Workers AI (`translator.ts`), and returns `ImTyping <translation>`.
- **Auth today**: Twitch OAuth with no scopes. Session tokens live in the `PVTCH_ACCOUNTS` KV (`token-data-*` → userId, `twitch-data-*` → profile).
- **After `twitch-storage-foundation`**: `pvtch-storage` hosts `TwitchChannel` (bot state, subscription record, `claimMessage`, `acquireSendSlot`, `JobScheduler` with cron).
- **Twitch facts this design relies on**:
  - EventSub webhooks sign `message_id + timestamp + raw_body` with HMAC-SHA256 (header `Twitch-Eventsub-Message-Signature: sha256=<hex>`).
  - Twitch expects a 2xx within a few seconds. Repeated failures revoke the subscription (`notification_failures_exceeded`).
  - `channel.chat.message` over webhook uses an app token. It requires the bot user to have granted `user:read:chat` + `user:bot`, and the broadcaster to have granted `channel:bot` (or the bot to be a mod).
  - `POST /helix/chat/messages` with an app token posts with the Chat Bot badge. It returns 200 with `is_sent` and `drop_reason`.
  - Helix sends `Ratelimit-*` headers and returns 429 when the limit is exceeded. Twitch does not back off on the client's behalf.

## Goals / Non-Goals

**Goals:**

- A bot that streamers enable from pvtch and that replies to translated messages in their chat, running entirely on Workers.
- A webhook endpoint that never makes Twitch wait on the LLM, and never processes a delivery twice.
- Subscriptions that recover from revocation without manual work.
- Detection logic that can change independently of the third-party-chatbot endpoint.

**Non-Goals:**

- Retiring or changing `/lingo/translate/:token`.
- A translation cache.
- Moving the `User` DO.
- Chat commands, moderation actions, or any event type besides chat messages and authorization revokes.
- Conduits. One webhook endpoint is enough; conduits solve scaling for WebSocket transports.

## Decisions

### 1. Ingest is verify → enqueue → 2xx; challenge and revocation are handled inline

The handler reads the body as **text**, verifies the HMAC with `crypto.subtle` and a constant-time compare, and rejects any timestamp more than 10 minutes old. Then:

- `webhook_callback_verification`: return the `challenge` as `text/plain` 200. If the subscription matches a `TwitchChannel`, record its status as `enabled`.
- `revocation`: update `TwitchChannel` with `clearSubscription`, plus `disableBot` when the status is `authorization_revoked` or `user_removed`. Return 204.
- `notification`: enqueue `{ messageId, subscriptionType, timestamp, event }` to `twitch-events` and return 204.

The challenge reply can't go through the queue because it must be in the HTTP response. Revocation is rare and needs no LLM, so it stays inline too. Invalid signatures return 403 and are never enqueued.

The queue consumer uses Taskless's settings: `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, a DLQ, and `max_concurrency` 10. Chat latency matters more here than it did for GitHub events.

### 2. Dedupe happens in the consumer, through `TwitchChannel.claimMessage`

Both Twitch and Queues deliver at least once. The consumer calls `claimMessage(messageId)` on the broadcaster's `TwitchChannel` and stops on `false`. Doing this in the consumer instead of the handler keeps the webhook path down to one queue write.

`user.authorization.revoke` events carry no broadcaster in the condition, so they are deduped on the revoked user's `TwitchChannel`.

### 3. Every Twitch API call happens in the twitch worker's consumer

`pvtch-api` and `TwitchChannel` never call Twitch. `pvtch-api` only calls `enableBot()` / `disableBot()`. On a state change, `TwitchChannel` enqueues the work message itself, and its reconcile cron enqueues too, so no caller can forget the side effect. The messages go to `twitch-events`:

- `{ kind: 'subscribe', broadcasterId }`
- `{ kind: 'unsubscribe', broadcasterId }`
- `{ kind: 'reconcile', broadcasterId }`

This keeps the app token, the Helix error handling and the backoff in one place.

_Alternative considered:_ a service binding RPC from `pvtch-api` to `pvtch-twitch`. Rejected: it makes the UI wait on Twitch, and retries would need a second mechanism.

### 4. Use an app access token; store no user tokens

The consumer gets an app token through client credentials and caches it in KV (`PVTCH_KV`, key `twitch-app-token`) with a TTL of `expires_in - 300` seconds. On a 401 it refreshes once.

The bot account authorizes `user:bot user:read:chat user:write:chat` once, through `twitch.pvtch.com/bot/authorize`, which is restricted to `ALLOWED_USERS`. Its user id is a var, `TWITCH_BOT_USER_ID`. Broadcasters grant `channel:bot` through the general `/auth/grant` flow on www (Decision 11). Their token is thrown away after the code exchange confirms who they are.

Because pvtch stores no user tokens, there is nothing to refresh and nothing to leak.

### 5. Send path: token bucket, Helix headers, `is_sent`

For each reply, the consumer:

1. Drops the reply if the source message is more than 60 seconds old (`timestamp`). A late translation is noise.
2. Calls `acquireSendSlot()`. If it returns `ok: false`, calls `message.retry({ delaySeconds: ceil(retryAfterMs/1000) })`.
3. Calls `POST /helix/chat/messages` with `{ broadcaster_id, sender_id: TWITCH_BOT_USER_ID, message, reply_parent_message_id }`.
4. Handles the response:
   - On 429, retries with a delay of `Ratelimit-Reset - now`.
   - On 5xx, retries with Queues' backoff.
   - On 200 with `is_sent: false`, logs `drop_reason.code` and acks without retrying. A dropped message won't succeed if resent.
   - On 403 (bot lost `channel:bot`), calls `disableBot` and acks.

### 6. Loop prevention and filtering

Skip the event when any of these hold:

- `chatter_user_id === TWITCH_BOT_USER_ID`
- the chatter is in `knownBots` or the channel's `bots` list
- the text starts with `!`
- `source_broadcaster_user_id` is set and differs from `broadcaster_user_id`. In Shared Chat sessions every participating channel receives each message, and only the source channel's bot should translate it.

### 7. Read lingo config from the `User` DO via `script_name: "pvtch-api"`

`pvtch-twitch` binds `PVTCH_USER` with `script_name: "pvtch-api"` and calls `lingo().getConfig()`. This is a read-only cross-worker binding. It doesn't migrate the DO, and the streamer keeps a single place to set their language.

Typing uses multi-config typegen (`-c ../core/wrangler.jsonc`) with `import type` only.

_Alternatives considered:_

- Copying the config into `TwitchChannel` on save. Rejected: dual writes drift apart.
- A service binding RPC. Possible later if `User`'s import graph makes typegen painful.

### 8. `packages/shared` holds data both workers need, not detection logic

`@pvtch/shared` exports `knownBots`, `LANGUAGES`, `normalizeLanguage`, `isKnownLanguage`, `SUPPORTED_TARGET_LANGUAGES` and `findSupportedTargetLanguage`. Each module has its own subpath export; there is no barrel, per the style guide. `workers/core` switches to these imports.

Detection (`lang-detect/*`) and `translator.ts` are **not** shared. The bot gets its own copy, so its detection can change without affecting the third-party-chatbot endpoint.

### 9. Fragment-based preprocessing

`channel.chat.message` delivers `message.fragments[]` typed as `text | emote | cheermote | mention`. The bot's preprocess step concatenates only the `text` fragments, then removes URLs and collapses repeated characters.

This removes the guesswork in the current emote-shaped-token rule (the `LULW`/`PogChamp` regex). One exception: third-party emotes (7TV, BTTV, FFZ) arrive as plain text, so the bot keeps the emote-shape check, applied to text fragments only.

The original `message.text` remains the LLM input, same as today.

### 10. Reply format

Replies are threaded (`reply_parent_message_id`) and contain only the translation, truncated to 500 characters. There is no `ImTyping` prefix. The badge and the thread make it clear who is speaking, and the bot never processes its own messages.

### 11. One general scope grant flow for pvtch, not one per feature

The user authorizes pvtch as a whole, not Lingual on its own. `/auth/grant?scopes=…&return_to=…` is the only place pvtch asks a user for extra Twitch scopes. It records the granted `scope` array on `twitch-data-{userId}` and returns to the feature. Features check the recorded scopes and send the user through the grant when something is missing. They never run their own OAuth.

Two properties follow:

- **One redirect URI to register** (`/auth/grant/callback`).
- **The union rule:** a new grant requests every scope already recorded plus the new ones, so adding a second feature can't narrow what the first one relies on.

A `GRANTABLE_SCOPES` allowlist keeps `/auth/grant` from becoming a way to ask for arbitrary permissions.

The bot-account authorization is the one exception, on `twitch.pvtch.com/bot/*`. There the Twitch account doing the authorizing is the bot, not the logged-in pvtch user, so the grant flow's check that the two ids match would fail.

## Risks / Trade-offs

- [A later scope-free login may narrow the Twitch authorization and silently drop `channel:bot`] → Verify Twitch's behavior before rollout (Open Questions). If it does narrow, `/auth/start` must request the returning user's recorded scopes, identified by the existing `pvtch_token` cookie.

- [The webhook endpoint becomes a target for spam] → HMAC is checked before any other work, invalid requests are rejected with 403 without a body, and Cloudflare rate-limiting rules apply to `/eventsub`.
- [The queue is down or slow, so Twitch sees failures and revokes subscriptions] → Return 2xx after the enqueue succeeds; return 5xx if the enqueue fails so Twitch retries. The reconcile job recreates revoked subscriptions within its period.
- [Cross-worker binding to `pvtch-api`'s `User` DO couples deploys] → The bot only calls `lingo().getConfig()`. Renaming or removing that method breaks the bot, so add a comment on the `User` DO noting the external caller.
- [Bot gets modded but stays on the standard tier] → It sends at most 20 per 30 seconds, which is conservative but safe. Detecting the mod tier is an open question.
- [Translations land in chat before the streamer expects it] → The bot is off by default. Enabling it requires a deliberate consent step, and the settings show the current subscription status.
- [Twitch scope semantics change] → The `channel:bot` flow is isolated in `bot-consent`, and the reconcile job surfaces failures through the subscription status.

## Migration Plan

1. Create the bot Twitch account, then register both redirect URIs on the Twitch app.
2. Create the queues `twitch-events` and `twitch-events-dlq` and the custom domain `twitch.pvtch.com`.
3. Merge to main. The GitHub deploy workflow deploys `pvtch-storage` first (queue producer and reconcile job), then the affected workers (`pvtch-twitch` and `pvtch-api`).
4. On `pvtch-twitch`, visit `/bot/authorize` once as an allowed user to grant the bot's scopes. Create the app-level `user.authorization.revoke` subscription (a one-off admin action at `/admin/bootstrap`, restricted to `ALLOWED_USERS`).
5. Roll out behind `ALLOWED_USERS` first. The enable button only appears for allowed users until we're confident.
6. Rollback: hide the enable UI and enqueue `unsubscribe` for every enabled channel. Workers can be rolled back on their own, because the enable flag lives in `TwitchChannel`.

## Open Questions

- What period should the reconcile cron use? Proposed: every 6 hours, plus once immediately after enable.

- Does re-authorizing with fewer scopes (a scope-free `/auth/start` login after a `channel:bot` grant) remove `channel:bot` from the user's Twitch authorization? To test: grant `channel:bot` on a test account, log in again, then check whether a `channel.chat.message` subscription can still be created.

## Resolved Questions

- **Mod tier (yes):** the bot receives its own messages as `channel.chat.message` events, and their `badges` show whether it is a moderator. The consumer reads them, sets `setSendTier` accordingly, and then skips the event. No bot user token or extra scope is needed. While the bot is unmodded it stays on the standard tier.
- **UI placement:** a new "Bots" section in the dashboard sidebar. Its first entry is "Lingual" at `/bots/lingual`. Scope consent goes through the general `/auth/grant` flow rather than routes specific to Lingual. Language and ignore-list settings stay on `/helpers/lingo`.
- **`PVTCH_TRANSLATIONS`:** belongs to the old non-bot translation cache, which is abandoned. `twitch-storage-foundation` removes the binding from `workers/core`, the README, and the deploy-your-own guide. The bot never uses it.
