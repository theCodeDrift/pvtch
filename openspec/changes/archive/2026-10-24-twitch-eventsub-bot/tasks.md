## 0. Prerequisites

- [x] 0.1 Confirm `twitch-storage-foundation` is implemented and deployed.
- [x] 0.2 Create the pvtch bot Twitch account and record its user id as `TWITCH_BOT_USER_ID`.
- [x] 0.3 Register the redirect URIs `https://www.pvtch.com/auth/grant/callback` and `https://twitch.pvtch.com/bot/callback` on the Twitch app.
- [x] 0.4 Create the Cloudflare queues `twitch-events` and `twitch-events-dlq`, and the custom domain `twitch.pvtch.com`.

## 1. packages/shared

- [x] 1.1 Add `packages/*` to `pnpm-workspace.yaml`. Create `packages/shared` (`@pvtch/shared`) with subpath exports `./known-bots`, `./languages` and `./supported-languages`, and no barrel.
- [x] 1.2 Move `known-bots.ts`, `constants/languages.ts` and `constants/supported-languages.ts` from `workers/core/app/lib`, then update every `workers/core` import.
- [x] 1.3 Run `pnpm --filter @pvtch/core typecheck`, `lint` and `test:unit` to confirm there is no behavior change.

## 2. TwitchChannel additions (workers/storage)

- [x] 2.1 Add the `TWITCH_EVENTS` queue producer binding to `workers/storage/wrangler.jsonc`, and define the work-message type.
- [x] 2.2 Make `enableBot` / `disableBot` enqueue `subscribe` / `unsubscribe` on state transitions only, and register the `reconcile-subscription` cron (`0 */6 * * *`) or remove it with `scheduler.cancel('reconcile-subscription', '0 */6 * * *')`.
- [x] 2.3 Add a reconcile job handler that enqueues `{ kind: 'reconcile' }`.
- [x] 2.4 Write tests for each scenario in `specs/twitch-channel/spec.md`, using a mock queue.

## 3. workers/twitch scaffolding

- [x] 3.1 Create `workers/twitch` (`@pvtch/twitch`, script `pvtch-twitch`) with a custom-domain route, bindings (`PVTCH_KV`, `PVTCH_ACCOUNTS`, `AI`, `TWITCH_CHANNEL` → `pvtch-storage`, `PVTCH_USER` → `pvtch`, the `TWITCH_EVENTS` producer and consumer, and the DLQ), and vars (`TWITCH_CLIENT_ID`, `TWITCH_BOT_USER_ID`, `ALLOWED_USERS`).
- [x] 3.2 Add a `typegen` script: `wrangler types -c wrangler.jsonc -c ../storage/wrangler.jsonc -c ../core/wrangler.jsonc`. Update tsconfig includes, and confirm the stubs are typed with no casts.
- [x] 3.3 Add a router: `POST /eventsub`, `GET /bot/authorize`, `GET /bot/callback`, `POST /admin/bootstrap`, and 404 for everything else.
- [x] 3.4 Write Zod schemas for the EventSub envelope, `channel.chat.message` v1 event (including fragments and `source_broadcaster_user_id`), the `user.authorization.revoke` event, and the queue messages. These are custom types because Twitch publishes none.

## 4. Ingest (`twitch-eventsub-ingest`)

- [x] 4.1 Implement HMAC verification with Web Crypto over the raw text body, with a constant-time compare.
- [x] 4.2 Add the 10-minute timestamp window.
- [x] 4.3 Answer the challenge inline (`text/plain`) and mark the subscription as `enabled`.
- [x] 4.4 Handle revocation inline (clear the record, and disable the bot when authorization was revoked or the user removed).
- [x] 4.5 Enqueue notifications, returning 204 once the enqueue succeeds and 500 if it fails.
- [x] 4.6 Write the consumer dispatcher, with `claimMessage` dedupe and logging plus ack for unknown kinds and types.
- [x] 4.7 Write tests: signature valid, invalid and re-serialized; stale timestamp; challenge; both revocation paths; queue failure; duplicate delivery.

## 5. Chat bot (`twitch-chat-bot`)

- [x] 5.1 Implement the app-token helper (client credentials, KV cache with TTL, one refresh-and-retry on 401).
- [x] 5.2 Implement subscribe (handling 409 and 403), unsubscribe (treating 404 as success), and reconcile (`GET /eventsub/subscriptions?subscription_id=`).
- [x] 5.3 Add `POST /admin/bootstrap` to create the `user.authorization.revoke` subscription, gated to `ADMIN_USERS`. Add the consumer handler for revoke events: call `disableBot()` and clear `scopes` on `twitch-data-{userId}`.
- [x] 5.4 Add the event filters: bot disabled, self, `knownBots` and the configured bots list, `!` commands, and the Shared Chat source. Before skipping a self event, set `setSendTier` from its `badges` (`moderator`, `lead_moderator` or `broadcaster` mean the moderator tier).
- [x] 5.5 Implement the send path: 60-second staleness, `acquireSendSlot` with retry delay, `POST /helix/chat/messages` with `reply_parent_message_id`, delay from `Ratelimit-Reset` on 429, backoff on 5xx, disable on 403, and log-and-ack when `is_sent: false`.
- [x] 5.6 Write tests for every scenario in `specs/twitch-chat-bot/spec.md`, using a mocked `fetch`.

## 6. Lingo bot pipeline (`lingo-bot`)

- [x] 6.1 Read Lingual's own settings from `TwitchChannel` (`getLingualSettings()`, new `lingual_settings` table). Replaced the original `PVTCH_USER` / `lingo().getConfig()` read; `pvtch-twitch` no longer binds core's `User` DO.
- [x] 6.2 Write fragment-based preprocessing in `workers/twitch/src/lingo/preprocess.ts`.
- [x] 6.3 Create the bot's own detection module (initially a copy of core's `decide`, classifiers and thresholds, with no imports from `workers/core`).
- [x] 6.4 Copy the translator (prompt, schema, `isSameLanguage`) into `workers/twitch/src/lingo/translator.ts`.
- [x] 6.5 Format the reply: translation only, the username-only guard, and truncation to 500 characters.
- [x] 6.6 Write tests for every scenario in `specs/lingo-bot/spec.md`.

## 7. Bot consent (`bot-consent`, in workers/core)

- [x] 7.1 Add the `TWITCH_CHANNEL` binding (`script_name: "pvtch-storage"`) to `workers/core/wrangler.jsonc`. Update `cf-typegen` to multi-config.
- [x] 7.2 Add `GRANTABLE_SCOPES` (`channel:bot`) and the `scopes` field on `TwitchUserData`. Add the routes `auth/grant.tsx` (auth required, allowlist check, relative-only `return_to`, union with recorded scopes, HttpOnly state cookie) and `auth/grant.callback.tsx` (state check, code exchange, id match, record scopes, discard tokens, redirect with `granted` or `grant_error`). Test every scenario in `specs/auth/spec.md`.
- [x] 7.2a Verify whether a scope-free re-login narrows the Twitch authorization (design Open Questions). If it does, make `/auth/start` request the recorded scopes for returning users.
- [x] 7.3 Add a "Bots" section to the sidebar in `app/components/layout/app-layout.tsx`, with "Lingual" as its first entry. Register `bots/lingual`, `auth/grant` and `auth/grant/callback` in `app/routes.ts`.
- [x] 7.4 Build the `/bots/lingual` page: bot status and subscription status, and enable/disable (enable calls `enableBot()` when `channel:bot` is recorded, otherwise redirects through `/auth/grant`, and handles `enable=1` and `grant_error` on return), and a link to `/helpers/lingo` for language settings. Use shadcn `Card`, `Badge` and `Button` and Sonner toasts, gated by `LINGUAL_PREVIEW_USERS`.
- [x] 7.5 Add `/bot/authorize` and `/bot/callback` on `pvtch-twitch`: session check with the `pvtch_token` cookie through the shared KV, `ADMIN_USERS` gate (fail-closed) that also admits the bot account's own session, and a check that the authorizing user is `TWITCH_BOT_USER_ID`.
- [x] 7.6 Add a regression test that login still requests no scopes.

## 8. Verify and roll out

- [x] 8.1 Run `typecheck`, `lint` and `test` for `@pvtch/shared`, `@pvtch/storage`, `@pvtch/twitch` and `@pvtch/core`.
- [x] 8.2 Local end-to-end of the webhook under `wrangler dev` (twitch + storage): signed challenge, bad signature, stale timestamp, notification, revocation and unknown path all behave as specified. The Twitch CLI wasn't installed, so events were signed by a script; the chat-to-reply path is covered by unit tests and gets its live check in 8.3.
- [x] 8.3 Merge to main so the GitHub deploy workflow (from `twitch-storage-foundation`) deploys storage first, then the affected workers. Add `@pvtch/twitch` and `@pvtch/shared` to its turbo inputs if they are not already covered. Grant the bot's scopes through `/bot/authorize`, run `/admin/bootstrap`, enable the bot on an allowed test channel, and confirm a threaded reply.
- [x] 8.3a Extend `app/routes/howto/deploy-your-own.tsx` for self-hosters: add `workers/twitch` to "How PVTCH Is Split Up", plus the queues, the bot account, the `/auth/grant/callback` redirect URI, and the custom domain.
- [x] 8.4 Document setup and deploy order in `workers/twitch/README.md`. Record the answers to the design's open questions.

## 9. Follow-ups from rollout

- [x] 9.1 Let the bot account's own session open `/bot/*`, so it can authorize with a single Twitch login.
- [x] 9.2 Fix sign out to clear the `Domain=pvtch.com` session cookies.
- [x] 9.3 Deploy core as the `pvtch` worker with `www.pvtch.com` declared as a custom domain.
- [x] 9.4 Add Lingual's own settings (language, ignored chatters) to `TwitchChannel` and the Bots → Lingual page.
- [x] 9.5 Add read-only `/admin/status` diagnostics.
