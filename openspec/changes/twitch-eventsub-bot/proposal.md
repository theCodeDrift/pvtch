## Why

Lingo reaches Twitch chat only through a third-party chatbot (Nightbot, StreamElements and similar) that calls `/lingo/translate/:token` and posts whatever text comes back. Streamers have to set up a custom command in another product, and pvtch can't control reply threading, see what actually reached chat, or react to chat events. Twitch now delivers chat over EventSub webhooks and accepts sends through Helix, so pvtch can run its own bot entirely on Workers with no long-lived connection.

**Depends on:** `twitch-storage-foundation`, which provides `workers/storage` and the `TwitchChannel` Durable Object.

## What Changes

- **New worker `workers/twitch`** (`pvtch-twitch`) on the custom domain `twitch.pvtch.com`. It serves the EventSub webhook endpoint and the one-time bot-account authorization, and nothing user-facing.
- **Ingest pipeline**: `Twitch → verify HMAC → (challenge | revocation handled inline) → Queue → 2xx`. The queue consumer handles dedupe, processing and sending. Same shape as `taskless/taskless` `workers/webhooks`.
- **Chat bot**: a dedicated pvtch bot account sends replies with `POST /helix/chat/messages` and an app access token, threaded with `reply_parent_message_id`. It shows the Twitch Chat Bot badge. Sends respect the `TwitchChannel` token bucket, Helix rate-limit headers, and `is_sent`/`drop_reason`.
- **Subscription lifecycle**: enabling the bot creates a `channel.chat.message` subscription. Disabling deletes it. `TwitchChannel` runs a recurring reconcile job that recreates subscriptions Twitch has revoked or failed. A single app-level `user.authorization.revoke` subscription detects streamers who disconnect pvtch from Twitch.
- **General scope grant (on www / `pvtch-api`)**: `/auth/grant` is one feature-agnostic flow through which pvtch requests extra Twitch scopes for the tools as a whole. It requests the union of the new scopes and the ones already granted, records granted scopes per user, and never stores tokens. Login itself still requests no scopes.
- **Bots dashboard**: a new "Bots" section with "Lingual" as its first entry (`/bots/lingual`). Enabling Lingual sends the user through `/auth/grant` for `channel:bot` when that scope isn't already recorded.
- **Re-implemented lingo pipeline for the bot**: the detection logic is new and uses EventSub message fragments (emotes and mentions arrive typed), so it no longer guesses which tokens are emotes. It reads per-channel language and ignore-list config from the existing `User` DO (bound read-only via `script_name: "pvtch-api"`). The existing `/lingo/translate/:token` endpoint is unchanged.
- **New `packages/shared`** (`@pvtch/shared`): moves `knownBots`, `LANGUAGES`/`normalizeLanguage` and `SUPPORTED_TARGET_LANGUAGES` out of `workers/core` so both workers use one source. `workers/core` switches to importing them from there.
- **`TwitchChannel` additions**: a queue producer binding plus a recurring `reconcile-subscription` job that enqueues work. The DO itself still makes no Twitch API calls.
- **Out of scope**: a translation cache (tried and rejected), retiring the third-party chatbot endpoint, and chat commands beyond translation.

## Capabilities

### New Capabilities

- `twitch-eventsub-ingest`: Webhook endpoint on `twitch.pvtch.com`. Covers signature verification, timestamp window, challenge response, revocation handling, enqueueing, consumer dedupe, and DLQ.
- `twitch-chat-bot`: Bot identity and app token. Covers subscription create/delete/reconcile, the `user.authorization.revoke` handling, sending replies with rate limiting, drop-reason handling and loop prevention, and the shared-chat source filter.
- `bot-consent`: The Lingual enable/disable UI on www (using `/auth/grant`), plus the one-time bot-account authorization on `twitch.pvtch.com`.
- `lingo-bot`: The bot's translation pipeline. Covers fragment-based preprocessing, a re-implemented detection decision, reading config from the `User` DO, the LLM call, and reply formatting.

### Modified Capabilities

- `auth`: Adds the general `/auth/grant` scope grant flow, recorded scopes on `twitch-data-*`, and clearing them on revoke. Login stays scope-free.
- `twitch-channel`: Adds the `reconcile-subscription` recurring job and a queue producer binding, so the DO can request Twitch work without calling Twitch itself.

## Impact

- **New code**: `workers/twitch/`, `packages/shared/`, and pvtch-api routes for bot consent and settings.
- **Changed code**: `workers/core` imports `knownBots` and the language constants from `@pvtch/shared`. `workers/core/wrangler.jsonc` gains a `TWITCH_CHANNEL` binding (`script_name: "pvtch-storage"`). `workers/storage` gains a queue producer binding.
- **pnpm workspace**: `pnpm-workspace.yaml` adds `packages/*`.
- **Twitch app config**: register the redirect URIs `https://www.pvtch.com/auth/grant/callback` and `https://twitch.pvtch.com/bot/callback`. Create the bot Twitch account.
- **Cloudflare**: the custom domain `twitch.pvtch.com`, the queues `twitch-events` and `twitch-events-dlq`, and secrets `TWITCH_SECRET` and `TWITCH_EVENTSUB_SECRET` on `pvtch-twitch`.
- **Deploy**: through the storage-first GitHub workflow from `twitch-storage-foundation`. The queues must exist before storage deploys its producer binding.
