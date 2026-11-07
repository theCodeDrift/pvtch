# lingual-worker Specification

## Purpose

The `pvtch-lingual` worker consumes the `lingual-events` queue and translates chat for channels that enabled Lingual. It reads channel settings and flags from the TwitchChannel DO and asks pvtch-twitch to send replies through a `send` queue message; it never calls Helix itself.

## Requirements

### Requirement: Lingual worker

`workers/lingual` SHALL deploy as `pvtch-lingual` with `workers_dev: false`, no routes, and `observability.enabled: true`. It SHALL bind `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`), a `TWITCH_EVENTS` producer on `twitch-events`, `AI`, and the Secrets Store secret `PVTCH_OPENROUTER_API_KEY`. It SHALL NOT bind Twitch secrets or `PVTCH_ACCOUNTS`. It SHALL consume `lingual-events` with `max_batch_size: 1`, `max_batch_timeout: 1`, `max_retries: 3`, `max_concurrency: 10`, and dead-letter queue `lingual-events-dlq`. It SHALL deploy through the existing CI workflow after `pvtch-storage`.

#### Scenario: No public surface

- **WHEN** `pvtch-lingual` is deployed
- **THEN** it has no route, custom domain, or `workers.dev` URL

#### Scenario: Unknown message

- **WHEN** a message that is not a `lingual` handler message is consumed
- **THEN** it is logged and acked

### Requirement: Lingual handler flow

For each `lingual` handler message, `pvtch-lingual` SHALL apply handler dedupe, then skip without replying when any of: `chatter_user_login` is in `knownBots` (case-insensitive); `message.text` starts with `!`; `source_broadcaster_user_id` is non-null and differs from `broadcaster_user_id`. On its first attempt it SHALL also skip a message whose normalized text (no emotes, mentions or URLs, ignoring case, punctuation and spacing) `messageCache()` has already seen, keyed by a hash so the channel never holds chat text. Otherwise it SHALL run the lingo pipeline and, on a translation, enqueue a `send` request. A thrown error SHALL retry the message.

#### Scenario: Repeated message

- **WHEN** two chatters send `HOLA, amigos!!!` and `hola amigos` within the cache window
- **THEN** only the first is translated

#### Scenario: Retry of a seen message

- **WHEN** a message's first attempt throws after it was recorded in `messageCache()`
- **THEN** the retry still translates it

#### Scenario: Command message

- **WHEN** a chat message starting with `!` is handled
- **THEN** no translation or `send` occurs

#### Scenario: Shared Chat message from another channel

- **WHEN** an event has `source_broadcaster_user_id: "999"` and `broadcaster_user_id: "123"`
- **THEN** no translation or `send` occurs

### Requirement: Translation flow selection

The `lingual.translate-v2` channel flag SHALL select the OpenRouter flow (v2) for that channel. Without it, a message SHALL take the Workers AI flow (v1). The `lingual.no-thread` flag SHALL post a reply as a plain message instead of a threaded reply. Both flows SHALL share the handler's skips, dedupe, and `send` request.

#### Scenario: Flag on

- **WHEN** a message is handled for a channel with `lingual.translate-v2` on
- **THEN** it takes the OpenRouter flow and Workers AI isn't called

#### Scenario: No thread

- **WHEN** a reply is sent for a channel with `lingual.no-thread` on
- **THEN** the `send` request has `replyParentMessageId: null`

### Requirement: OpenRouter translation flow

The v2 flow SHALL ask a decision model how likely it is that all of the message is in the target language, using the message's text fragments cleaned by `preprocess`. It SHALL translate only when that probability is at or below `LINGUAL_V2_MAX_TARGET_PROBABILITY`. Past that check a translation is required, so the translator SHALL NOT judge the language again. The translator SHALL NOT receive emotes, cheermotes or URLs. The source language SHALL NOT be restricted. Any failure, refusal or doubt SHALL stay quiet without a reply, including a translation that repeats the message or is empty after removing `@usernames`.

#### Scenario: Confident it's another language

- **WHEN** detection scores a message at or below the threshold and translation succeeds
- **THEN** a reply is requested

#### Scenario: Likely the target language

- **WHEN** detection scores a message above the threshold
- **THEN** the translator isn't called and no reply is requested

#### Scenario: Nothing to detect

- **WHEN** a message has only emotes and mentions
- **THEN** no model is called

#### Scenario: Detection fails

- **WHEN** the decision call fails or refuses
- **THEN** the translator isn't called and no reply is requested

#### Scenario: Translator input

- **WHEN** a message has a native emote, a URL and words
- **THEN** the translator receives only the words

### Requirement: OpenRouter flow configuration

The v2 flow SHALL read `LINGUAL_V2_DETECTOR_API` (`decisions` or `chat`), `LINGUAL_V2_DETECTOR_MODEL`, `LINGUAL_V2_TRANSLATOR_MODEL`, `LINGUAL_V2_MAX_TARGET_PROBABILITY` and `LINGUAL_V2_DISABLE_THINKING` from vars. Model ids SHALL include their provider prefix. An invalid value SHALL log an error and keep the flow quiet. `wrangler.harness.jsonc` SHALL carry the same `LINGUAL_V2_*` values as `wrangler.jsonc`.

#### Scenario: Invalid value

- **WHEN** `LINGUAL_V2_DETECTOR_MODEL` has no provider prefix
- **THEN** an error is logged and no reply is requested

### Requirement: Dev harness

`wrangler.harness.jsonc` SHALL run a local-only entry point beside the real workers, and no deploy SHALL read it. It SHALL only answer on localhost, private network addresses and `.local` hostnames. `/send` SHALL put a fake chat message on `lingual-events`, so only the router is skipped. `/evals` SHALL run messages through the v2 path and show the results for review, without posting to Twitch.

#### Scenario: Public host

- **WHEN** a request reaches the harness from a public hostname
- **THEN** it is refused

#### Scenario: Evals never post

- **WHEN** `/evals/run` translates a message
- **THEN** no `send` request is enqueued
