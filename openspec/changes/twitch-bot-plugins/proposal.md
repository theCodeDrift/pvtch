## Why

`TwitchChannel` and `pvtch-twitch` are built around one bot. `bot_state`, `send_bucket` and `lingual_settings` are single-row tables in the DO's core schema. Subscriptions are keyed by EventSub type alone. The consumer hard-codes Lingual's pipeline behind `channel.chat.message`, and `TWITCH_BOT_USER_ID` names a single account. pvtch's design calls for several purpose-built bots, so a second bot today would mean threading `if (bot === …)` through the DO, the webhook and the consumer. There is also no way to try an unreleased Lingual behavior on one channel without shipping it to every channel.

Nobody but the maintainer uses Lingual yet, so this change reshapes storage and RPC names with no compatibility layer.

## What Changes

- **Bot plugins on `TwitchChannel`**, following the core `User` DO's pattern: each bot is an `RpcTarget` plugin class with its own tables and migrations (its own version table, like `JobScheduler`), exposed through an accessor such as `lingual()`. Callers write `using lingual = await channel.lingual()` and then `await lingual.getSettings()`. Lingual's settings move out of the DO's core schema into the plugin.
- **Generic, per-bot channel state**: the DO keeps what every bot shares, keyed by `botId`: enablement (`enableBot(botId)` / `disableBot(botId)` / `getBot(botId)`), EventSub subscription records (`(botId, type)`), the chat-send token bucket, the subscribe/unsubscribe requests and the reconcile cron. Message dedupe and the scheduler stay channel-wide.
- **Bot registry** in `@pvtch/shared/twitch-bots`: `botId → { userId, login, eventTypes }`. It replaces the `TWITCH_BOT_USER_ID` and `LINGUAL_BOT_LOGIN` vars. Each bot is its own Twitch account.
- **Event routing in five steps**:
  1. _Is this event tracked?_ The worker checks the type against the registry, plus channel-level types such as `user.authorization.revoke`. Anything else is logged and acked.
  2. _Who is it for?_ The worker resolves the channel (and, for bot subscriptions, the bot from `condition.user_id`) and gets that channel's DO.
  3. _Does the channel support it?_ A single DO call, `routeEvent(...)`, claims the message for dedupe and returns the enabled bots that handle this type, plus the channel's feature flags.
  4. _Route._ The worker calls each returned bot's handler.
  5. _Act._ The handler reads what it needs from the DO (`channel.lingual()`) and acts.
- **Bot handlers in the worker**: `workers/twitch/src/bots/<botId>/` implements a `BotHandler` interface. Lingual's pipeline moves to `bots/lingual/`.
- **Feature flags** instead of a second worker: a channel-level `Flags` plugin (`channel.flags()`) stores named flags such as `lingual.reply-threading`. `routeEvent` returns them, and handlers check `flags.has(...)`. Admins toggle them at `/admin/flags`, and `/admin/status` shows them. Experimental code ships dark through normal CI.
- **Queue and webhook**: notification messages carry the subscription's `condition`, so the consumer can tell which bot a delivery belongs to. Work messages carry `botId`. Callback verification and revocation resolve the bot from `condition.user_id`.
- **www and bot authorization**: `/bots/lingual` calls `enableBot('lingual')`, `disableBot('lingual')` and `lingual().setSettings()`. `/bot/authorize?bot=<botId>` checks against that bot's registry user id.
- **Out of scope**: a second bot (this change makes room for one), a separate experimental worker, and migrating data. Lingual's state is reset, and the maintainer re-enables it after deploy.

## Capabilities

### New Capabilities

_(none; every behavior extends an existing capability)_

### Modified Capabilities

- `twitch-channel`: Per-bot enablement, subscriptions, send bucket, work requests and reconcile. Adds bot plugins, `routeEvent` and flags. Lingual settings move to the `Lingual` plugin.
- `twitch-eventsub-ingest`: Bot resolved from `condition.user_id` on verification and revocation. Queue messages carry `condition`. The consumer routes in five steps. Adds `/admin/flags`, and `/admin/status` shows bots and flags.
- `twitch-chat-bot`: Subscription work, filtering, send tier and sending are per bot, using the registry instead of `TWITCH_BOT_USER_ID`. App-level revoke disables every bot on the channel.
- `lingo-bot`: Settings are read through `channel.lingual().getSettings()`. The pipeline is the `lingual` bot handler.
- `bot-consent`: Enable/disable/settings calls name the bot. Bot authorization is per registered bot.

## Impact

- `workers/storage/src/durable-objects/twitch-channel.ts`: generic per-bot state, `routeEvent`, `lingual()` and `flags()` accessors. New `twitch-channel/plugins/lingual.ts` and `twitch-channel/plugins/flags.ts`. A new core migration recreates the per-bot tables and drops `bot_state`, `subscriptions`, `send_bucket` and `lingual_settings`.
- `packages/shared`: new `twitch-bots` subpath. The work-message types in `twitch-queue` gain `botId`, and events gain `condition`.
- `workers/twitch/src`: `consumer.ts` becomes the five-step router. New `bots/lingual/` holds the existing `bot/chat.ts` and `lingo/` pipeline. `eventsub/webhook.ts`, `twitch/subscriptions.ts`, `routes/bot-authorize.ts`, `routes/admin-status.ts` and a new `routes/admin-flags.ts` change.
- `workers/core`: `/bots/lingual` route and its loader/action, and the removal of `LINGUAL_BOT_LOGIN`.
- `wrangler.jsonc`: removes `TWITCH_BOT_USER_ID` (twitch) and `LINGUAL_BOT_LOGIN` (core), then regenerate types.
- Deploy: storage first, as always. Lingual is broken for the maintainer's channel between the storage and twitch/core deploys, then must be re-enabled.
