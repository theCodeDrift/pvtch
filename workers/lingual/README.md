# @pvtch/lingual

The `pvtch-lingual` worker: **Lingual**, the handler that translates Twitch chat for channels that turned it on (Bots → Lingual on www). It has no routes and no Twitch credentials.

## How it works

```
lingual-events (from pvtch-twitch's router)
  ─▶ claim lingual:<messageId> on TwitchChannel (first attempt only)
  ─▶ skip Shared Chat from other channels, commands, known bots, stale messages
  ─▶ skip repeats of a normalized message (channel.messageCache(), first attempt only)
  ─▶ channel.lingual().getSettings() ─▶ lingo pipeline ─▶ Workers AI
  ─▶ { kind: 'send', sendId: 'lingual:<messageId>', ... } on twitch-events
```

- **Routing happens upstream.** `pvtch-twitch` only fans events out to `lingual-events` for channels with `lingual` enabled, and never forwards a pvtch bot's own messages.
- **Sending happens upstream too.** Replies go back to `pvtch-twitch` as `send` requests; it applies the channel's rate limit for the sender (`pvtchbot`) and calls Helix.
- **Translation flows:** `lingual.translate-v2` picks the flow per channel. Without it, a message takes **v1** below. **v2** (`pipeline-v2.ts`) asks a decision model whether all of the message is in the target language, and only translates when that probability is at or below a threshold. Past that point a translation is required, so a chat model translates without judging the language again. It doesn't receive native emotes or cheermotes, so they don't appear in the reply. Both go through OpenRouter, and any failure or uncertain answer stays quiet.
- **Translation (v1):** `src/lingo/` is Lingual's own copy of Lingo detection. It reads EventSub message fragments, so native emotes and mentions are dropped exactly rather than guessed at. The language and ignore list are Lingual's own settings in the `TwitchChannel` `Lingual` plugin, separate from the Lingo helper's.
- **Feature flags** arrive on each event as `flags` (`lingual.<feature>`); set them at `https://twitch.pvtch.com/admin/flags`. `lingual.no-thread` posts replies as plain messages.

## Configuration

The v2 flow reads these vars, set in `wrangler.jsonc`. `wrangler.harness.jsonc` carries a copy for `/evals`, so change both. For a local override, set them in `workers/lingual/.dev.vars`.

| Var                                 | Default                        | Meaning                                                                                     |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `LINGUAL_V2_DETECTOR_API`           | `decisions`                    | `decisions` for decisions models, `chat` for any other model                                |
| `LINGUAL_V2_DETECTOR_MODEL`         | `perplexity/pplx-decider-v1.2` | `provider/model`                                                                            |
| `LINGUAL_V2_MAX_TARGET_PROBABILITY` | `0.1`                          | Translate at or below this score. Scores are model-specific, so change it with the detector |
| `LINGUAL_V2_TRANSLATOR_MODEL`       | `google/gemma-3-12b-it`        | `provider/model`                                                                            |
| `LINGUAL_V2_DISABLE_THINKING`       | `false`                        | `true` sends `reasoning` off, which the models must support                                 |

An invalid value logs an error and keeps v2 quiet.

## Setup

Create `lingual-events` and `lingual-events-dlq` before the first deploy, and put `PVTCH_OPENROUTER_API_KEY` in the account's Secrets Store (the `store_id` in `wrangler.jsonc`). CI deploys this worker after `pvtch-storage`.

## Dev harness

A local form that sends a fake chat message through the real Lingual path. Enter a broadcaster's numeric Twitch ID and a message, and `pvtchbot` posts the English translation to that channel.

```bash
pnpm --filter @pvtch/lingual harness   # http://localhost:8790, or the machine's LAN IP or .local name
```

`src/dev/harness.ts` runs from `wrangler.harness.jsonc` alongside `pvtch-lingual`, `pvtch-twitch` and `pvtch-storage`. It puts a `handler-event` on `lingual-events`, so only the router is skipped. Nothing deploys that config. The harness listens on the LAN so other devices can reach it by mDNS name, and it only answers on localhost, private LAN addresses and `.local` hostnames. If a `.local` name fails from another machine, use the LAN IP: the name can resolve to addresses that machine can't reach. Anyone on that network can post as the bot while it runs.

- **Flow:** pick v1 or v2 on the form. v2 needs `PVTCH_OPENROUTER_API_KEY` in this checkout's local secrets store.
- **Evals:** `/evals` runs the fixtures in `src/dev/eval-fixtures.ts`, plus any messages you add, through the real v2 path and shows a table to review by hand. It calls OpenRouter but never posts to Twitch. Set a detector, translator and threshold there to try another pair, or a second pair to compare per message. These apply to that run only; production uses the `LINGUAL_V2_*` vars. Chat models must support structured outputs, and thinking is turned off where a model allows it.
- **Language:** hardcoded to English. The harness writes it to the channel's local Lingual settings on each send.
- **Threading:** the fake message has no real Twitch id to reply to, so it carries the `lingual.no-thread` flag.
- **Results:** a post shows up in Twitch chat and failures in the terminal. A message the handler skips, such as a command or "lol", produces nothing.
- **Needs:** `wrangler` logged into the pvtch account for Workers AI, the real `TWITCH_SECRET` in this checkout's local secrets store, and a broadcaster who has granted `channel:bot`.
- **Don't enable Lingual locally:** with the real secret, pvtch-twitch's local subscription sync would change real EventSub subscriptions. The harness doesn't need it.

`pnpm --filter @pvtch/lingual test` covers the handler and the lingo pipeline with in-memory fakes.
