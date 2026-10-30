## Context

- **`TwitchChannel` today** (`workers/storage`): one SQLite schema (`twitchChannelMigrations`) with `bot_state`, `subscriptions` (keyed by `type`), `message_claims`, `send_bucket` and `lingual_settings`. Flat RPC methods: `getBot`, `enableBot`, `disableBot`, `get/setLingualSettings`, `get/set/clearSubscription`, `claimMessage`, `acquireSendSlot`, `setSendTier`. A `JobScheduler` runs `prune-dedupe`, `request-subscribe`/`request-unsubscribe` and the `reconcile-subscription` cron, all assuming one bot.
- **`pvtch-twitch` today**: `/eventsub` verifies the request, handles challenges and revocations inline, and enqueues `{ kind: 'event', messageId, subscriptionType, timestamp, event }`, dropping `subscription.condition`. The consumer claims the message and then switches on `subscriptionType`: `channel.chat.message` → Lingual's `handleChatMessage`, `user.authorization.revoke` → `handleAuthorizationRevoke`. Work messages are `{ kind, broadcasterId }`. `TWITCH_BOT_USER_ID` is the one bot account.
- **The plugin pattern already in use**: the core `User` DO (`workers/core/do/user.ts`) builds `Progress`, `Lingo`, `Profile` and `Board` plugins. Each is an `RpcTarget` taking `sql` and running its own `migrate(sql, …, '_<plugin>_version')`. The DO exposes accessors (`lingo(): Lingo`), and callers write `using lingo = await stub.lingo()`. An `RpcTarget` return value is `Rpc.Serializable`, so the `AssertRPCSerializable` check on `TwitchChannel` still holds.
- **Twitch fact that drives the per-bot keys**: a `channel.chat.message` subscription's condition is `{ broadcaster_user_id, user_id }`, where `user_id` is the reading/sending bot account. Two bots on one channel are two subscriptions, and each chat line is delivered once per subscription with a distinct `message_id`. The notification event doesn't say which bot it's for; only `subscription.condition.user_id` does.

## Goals / Non-Goals

**Goals:**

- Adding a bot means a plugin, a registry entry and a handler, with no edits to generic DO, webhook or consumer code.
- Keep the DO readable: generic channel state in the DO, bot-specific tables and logic in plugins.
- One DO round trip per event to decide whether to handle it, for whom, and with which flags.
- Try unreleased behavior on chosen channels with feature flags.

**Non-Goals:**

- Building a second bot.
- A separate experimental worker or version-based routing.
- Preserving existing Lingual state or keeping old RPC names working.
- Several bots sharing one Twitch account. Each bot is its own account; see Risks.

## Decisions

### 1. Bot registry in `@pvtch/shared/twitch-bots`

```ts
export const TWITCH_BOTS = {
  lingual: {
    userId: '1591556954',
    login: 'botlingual',
    eventTypes: ['channel.chat.message'],
  },
} as const satisfies Record<string, TwitchBot>;
export type BotId = keyof typeof TWITCH_BOTS;
export function botForUserId(userId: string): BotId | undefined;
```

Twitch user ids and logins are public, so they belong in code rather than vars. That also lets storage, twitch and core share one source. It replaces `TWITCH_BOT_USER_ID` (twitch) and `LINGUAL_BOT_LOGIN` (core).

### 2. `TwitchChannel` keeps the generic, per-bot state

The core migration (a new version) drops `bot_state`, `subscriptions`, `send_bucket` and `lingual_settings` and creates:

- `bots (bot_id TEXT PRIMARY KEY, enabled, enabled_at, updated_at)`
- `subscriptions (bot_id, type, subscription_id, status, updated_at, PRIMARY KEY (bot_id, type))`
- `send_buckets (bot_id TEXT PRIMARY KEY, tier, tokens, updated_at)`

`message_claims` and the scheduler stay as they are. The RPC methods take `botId`: `getBot(botId)`, `listBots()`, `enableBot(botId)`, `disableBot(botId)`, `getSubscription(botId, type)`, `setSubscription(botId, type, id, status)`, `clearSubscription(botId, type)`, `acquireSendSlot(botId)`, `setSendTier(botId, tier)`. Scheduler task names are suffixed by bot: `request-subscribe:<botId>`, `request-unsubscribe:<botId>`, `reconcile-subscription:<botId>`. `runJob` parses the suffix.

`claimMessage` is removed, and `routeEvent` replaces it (decision 4).

Dropping the old data is acceptable: the maintainer re-enables Lingual after deploy. The subscribe flow already treats Twitch's 409 (subscription exists) as "look it up and record it", so the live subscription is picked up again.

### 3. Bot and channel plugins (`RpcTarget`)

`durable-objects/twitch-channel/plugins/lingual.ts`:

```ts
export class Lingual extends RpcTarget {
  constructor(sql: SqlStorage) {
    super();
    this.sql = sql;
    migrate(sql, lingualMigrations, '_lingual_version');
  }
  getSettings(): LingualSettings { … }
  setSettings(settings: LingualSettings): LingualSettings { … }
}
```

`durable-objects/twitch-channel/plugins/flags.ts` is the same shape over a `flags (name TEXT PRIMARY KEY, updated_at)` table, with `list(): string[]` and `set(name, on): string[]`. A row means the flag is on.

`TwitchChannel` builds both in its constructor and exposes `lingual(): Lingual` and `flags(): Flags`, matching `User`. Generic code never imports a bot plugin. A bot's plugin is only reached through its accessor by that bot's handler or by www.

### 4. Event routing: five steps

In the consumer, for `kind: 'event'`:

1. **Tracked?** Look up `subscriptionType` in a dispatch table built from the registry (`eventTypes` of every bot → bot handlers) plus channel-level handlers (`user.authorization.revoke`). If it's missing, log and ack.
2. **Who for?** Each handler type supplies `channelOf(event)`: `broadcaster_user_id` for chat, `user_id` for revoke. For bot subscriptions, `botForUserId(condition.user_id)` names the bot. If the condition names an unknown bot, log and ack.
3. **Supported?** Make one call: `channel.routeEvent({ messageId: attempts === 1 ? id : null, subscriptionType, botId })` → `{ fresh, bots: BotId[], flags: string[] }`. It claims the message (same statement as today's claim), then returns the enabled bots whose registry `eventTypes` include the type, narrowed to `botId` when one is given. If `fresh` is false, ack.
4. **Route.** Call `handlers[botId].handle(ctx)` for each returned bot. Channel-level handlers run whatever `bots` contains (revoke uses it to disable each one).
5. **Act.** `ctx` is `{ env, channel, botId, event, timestamp, flags: Set<string> }`. The handler reads what it needs, e.g. `using lingual = await ctx.channel.lingual()`, and returns an `Outcome`.

With `max_batch_size: 1` and one bot per subscription, a delivery normally reaches exactly one handler. If several handlers do run, the consumer acks only when all of them ack, and retries with the largest requested delay otherwise. Handlers already treat a retry as safe, because the claim is held (`attempts > 1` skips the claim).

Work messages (`subscribe` / `unsubscribe` / `reconcile`) carry `botId` and go to the generic subscription code in `twitch/subscriptions.ts`. That code creates one subscription per type in the bot's `eventTypes`, with `user_id` set to the bot's registry `userId`.

### 5. Bot handlers in the worker

```ts
export interface BotHandler {
  readonly botId: BotId;
  handle(ctx: BotEventContext): Promise<Outcome>;
}
```

`workers/twitch/src/bots/lingual/` holds today's `bot/chat.ts` and `lingo/` pipeline, unchanged apart from reading settings via the plugin, using `TWITCH_BOTS.lingual.userId` for loop prevention and `sender_id`, and calling `acquireSendSlot('lingual')` / `setSendTier('lingual', …)` / `disableBot('lingual')`. The registry-to-handler map lives in `bots/index.ts`. That's the one place a new bot is wired in. It's a dispatch table, not a re-export barrel.

### 6. Feature flags

Flags are per channel and namespaced by bot: `<botId>.<feature>`. `routeEvent` returns them so the hot path doesn't need a second RPC. `/admin/flags` (admin only; GET lists, POST `name` + `on`; `?broadcaster=` override, same SameSite=Lax rationale as `/admin/bootstrap`) calls `channel.flags().set(...)`. There's no global flag tier. A flag that ships to everyone is removed from the code.

### 7. Webhook changes

- Notifications: the queue message gains `condition: Record<string, string>` (from `subscription.condition`).
- Callback verification and revocation: `botForUserId(condition.user_id)` names the bot. Then `setSubscription(botId, type, id, 'enabled')` / `clearSubscription(botId, type)`, and `disableBot(botId)` on authorization loss. A condition without a known bot is logged and gets its normal response, with no DO write.

## Risks / Trade-offs

- **[Bots sharing one Twitch account]** → Two bots with the same `userId` would collide on the `channel.chat.message` subscription (Twitch 409) and get the same deliveries. The registry SHALL reject duplicate `userId`s with a module-load check and a unit test. Supporting a shared account later means fanning one subscription out to several bots, which step 3 already returns as a list.
- **[Deploy gap]** → Between the storage deploy and the twitch/core deploys, the old workers call removed RPC methods and fail. Accepted, because only the maintainer's channel is affected. Deploy all three in one CI run.
- **[Per-message RPC cost]** → It's still one DO call per event. `routeEvent` folds the claim, the enablement check and the flags into it.
- **[Plugin migrations run on every DO construction]** → They're the same cheap version-table read the `User` plugins already do.

## Migration Plan

1. Ship `@pvtch/shared/twitch-bots` and the updated `twitch-queue` types.
2. Ship storage (the new core migration, plugins, `routeEvent`, per-bot methods), then twitch and core in the same CI run.
3. Re-enable Lingual on `/bots/lingual`, then confirm `/admin/status` shows the bot enabled, its subscription `enabled`, and the expected flags.
4. Rollback is forward-only. Once the migration has run, the old tables are gone and the version table is ahead of the old code, so reverting the workers leaves Lingual broken. Fix forward instead.
