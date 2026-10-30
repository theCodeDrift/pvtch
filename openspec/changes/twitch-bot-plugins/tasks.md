## 1. Shared registry and queue types (packages/shared)

- [ ] 1.1 Add the `@pvtch/shared/twitch-bots` subpath with `TWITCH_BOTS` (`lingual`: user id, `botlingual`, `['channel.chat.message']`), `BotId`, `TwitchBot`, and `botForUserId`.
- [ ] 1.2 Add a unit test that fails when two bots share a `userId`, plus `botForUserId` hit and miss cases.
- [ ] 1.3 In `@pvtch/shared/twitch-queue`, add `botId: BotId` to work messages and `condition: Record<string, string>` to event messages.

## 2. TwitchChannel as a plugin host (workers/storage)

- [ ] 2.1 Add a core migration that drops `bot_state`, `subscriptions`, `send_bucket` and `lingual_settings`, and creates `bots`, `subscriptions (bot_id, type)` and `send_buckets (bot_id)`.
- [ ] 2.2 Rewrite the per-bot methods with a `botId` parameter: `getBot`, `listBots`, `enableBot`, `disableBot`, `get/set/clearSubscription`, `acquireSendSlot`, `setSendTier`. Suffix the scheduler tasks with `:<botId>` and parse the suffix in `runJob`. Work messages carry `botId`.
- [ ] 2.3 Add `twitch-channel/plugins/lingual.ts` (`RpcTarget`, `_lingual_version` migrations, `getSettings` / `setSettings` with today's normalization) and the `lingual()` accessor.
- [ ] 2.4 Add `twitch-channel/plugins/flags.ts` (`RpcTarget`, `_flags_version`, `list` / `set`) and the `flags()` accessor.
- [ ] 2.5 Replace `claimMessage` with `routeEvent({ messageId, subscriptionType, botId })` → `{ fresh, bots, flags }`.
- [ ] 2.6 Update the DO's header comment and keep the `AssertRPCSerializable` check passing.
- [ ] 2.7 Write tests for each scenario in `specs/twitch-channel/spec.md`.

## 3. Five-step routing (workers/twitch)

- [ ] 3.1 Add the `BotHandler` / `BotEventContext` types and `bots/index.ts` (registry `BotId` → handler, plus the channel-level handler for `user.authorization.revoke`).
- [ ] 3.2 Move `bot/chat.ts` and `lingo/` into `bots/lingual/`. Read settings via `channel.lingual()`, and use `TWITCH_BOTS.lingual.userId` and the `'lingual'` bot id for sends, tier and disable. Treat every registered bot's `userId` as self for loop prevention.
- [ ] 3.3 Rewrite `consumer.ts` as tracked → who for → `routeEvent` → route → act, combining multiple handler outcomes as the spec describes.
- [ ] 3.4 Make `twitch/subscriptions.ts` per bot: subscribe, unsubscribe and reconcile over the bot's `eventTypes`, with `user_id` set to the bot's `userId`.
- [ ] 3.5 In `eventsub/webhook.ts`, enqueue `condition`, and resolve the bot from `condition.user_id` on verification and revocation.
- [ ] 3.6 Move `bot/revoke.ts` to the channel-level handler, which disables every bot that `routeEvent` returns.
- [ ] 3.7 In `routes/bot-authorize.ts`, add `?bot=<botId>`, carry it in `state`, check against the registry `userId`, and return 400 for an unknown bot.
- [ ] 3.8 Add `routes/admin-flags.ts` and register `GET|POST /admin/flags`. `routes/admin-status.ts` now reports per-bot state and flags.
- [ ] 3.9 Remove `TWITCH_BOT_USER_ID` from `wrangler.jsonc`, and run `cf-typegen`.
- [ ] 3.10 Update the tests (`consumer`, `webhook`, `chat`, `subscriptions`, `routes`) for each scenario in `specs/twitch-eventsub-ingest`, `specs/twitch-chat-bot`, `specs/lingo-bot` and the authorization part of `specs/bot-consent`.

## 4. www (workers/core)

- [ ] 4.1 In `/bots/lingual`, change the loader and action to `getBot('lingual')`, `getSubscription('lingual', 'channel.chat.message')`, `enableBot('lingual')` / `disableBot('lingual')`, and `using lingual = await channel.lingual()` for the settings.
- [ ] 4.2 Use `TWITCH_BOTS.lingual.login`, remove `LINGUAL_BOT_LOGIN` from `wrangler.jsonc`, and run `cf-typegen`.

## 5. Verify and ship

- [ ] 5.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
- [ ] 5.2 Ship storage, twitch and core in one CI run (storage first).
- [ ] 5.3 Re-enable Lingual and re-enter its settings on `/bots/lingual`. Check `/admin/status`: Lingual is enabled and its subscription is `enabled`.
- [ ] 5.4 Turn a test flag on with `/admin/flags`, confirm it appears in `/admin/status`, then turn it off.
