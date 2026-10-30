# @pvtch/lingual

The `pvtch-lingual` worker: **Lingual**, the handler that translates Twitch chat for channels that turned it on (Bots → Lingual on www). It has no routes and no Twitch credentials.

## How it works

```
lingual-events (from pvtch-twitch's router)
  ─▶ claim lingual:<messageId> on TwitchChannel (first attempt only)
  ─▶ skip Shared Chat from other channels, commands, known bots, ignored chatters, stale messages
  ─▶ channel.lingual().getSettings() ─▶ lingo pipeline ─▶ Workers AI
  ─▶ { kind: 'send', sendId: 'lingual:<messageId>', ... } on twitch-events
```

- **Routing happens upstream.** `pvtch-twitch` only fans events out to `lingual-events` for channels with `lingual` enabled, and never forwards a pvtch bot's own messages.
- **Sending happens upstream too.** Replies go back to `pvtch-twitch` as `send` requests; it applies the channel's rate limit for the sender (`botlingual`) and calls Helix.
- **Translation:** `src/lingo/` is Lingual's own copy of Lingo detection. It reads EventSub message fragments, so native emotes and mentions are dropped exactly rather than guessed at. The language and ignore list are Lingual's own settings in the `TwitchChannel` `Lingual` plugin, separate from the Lingo helper's.
- **Feature flags** arrive on each event as `flags` (`lingual.<feature>`); set them at `https://twitch.pvtch.com/admin/flags`.

## Setup

Create `lingual-events` and `lingual-events-dlq` before the first deploy. CI deploys this worker after `pvtch-storage`.

`pnpm --filter @pvtch/lingual test` covers the handler and the lingo pipeline with in-memory fakes.
