# lingo-bot Specification

## Purpose

Lingual's translation pipeline in `pvtch-lingual`: its own settings in `TwitchChannel`, fragment-based detection input, and reply formatting. Detection and translation models are the OpenRouter flow in `lingual-worker`.

## Requirements

### Requirement: Lingual settings live in TwitchChannel

Lingual SHALL keep its own settings, a target `language` and a list of `ignoredChatters`, in the broadcaster's `TwitchChannel` `Lingual` plugin, read by `pvtch-lingual` through `using lingual = await channel.lingual()` and `lingual.getSettings()`. They are separate from the Lingo helper's config. `pvtch-lingual` SHALL NOT bind or read core's `User` DO. If no `language` is set, the handler message SHALL be acked without translating.

#### Scenario: Configured channel

- **WHEN** a chat event arrives for a broadcaster whose Lingual language is `english`
- **THEN** the pipeline targets English

#### Scenario: Unconfigured channel

- **WHEN** a chat event arrives for a broadcaster with no Lingual language set
- **THEN** no translation or `send` occurs

#### Scenario: Lingo helper settings are not used

- **WHEN** a broadcaster has a Lingo helper language but no Lingual language
- **THEN** no translation or `send` occurs

### Requirement: Fragment-based detection input

The bot pipeline SHALL build its detection input from `event.message.fragments` by concatenating only fragments of type `text`, excluding `emote`, `cheermote`, and `mention` fragments. It SHALL then strip URLs, strip emote-shaped tokens (for third-party emotes delivered as text), collapse whitespace, and collapse runs of 3+ identical characters to 2. The translator's input is set by the OpenRouter flow in `lingual-worker`.

#### Scenario: Native emotes and mentions removed

- **WHEN** fragments are `[mention "@bob", text " hola amigo ", emote "Kappa"]`
- **THEN** the detection input is `hola amigo`

#### Scenario: Third-party emote in text

- **WHEN** a text fragment is `KEKW que risa`
- **THEN** the detection input is `que risa`

### Requirement: Reply formatting

The reply text SHALL be the translation only (no `ImTyping` prefix), truncated to 500 characters, and requested as a `send` for the handler's sender. A translation that is empty after removing `@usernames` SHALL NOT be sent. The pipeline SHALL NOT cache translations.

#### Scenario: Long translation

- **WHEN** the translation exceeds 500 characters
- **THEN** the requested reply is truncated to 500 characters

#### Scenario: Only usernames

- **WHEN** the translation is `@bob @alice`
- **THEN** no `send` is enqueued

### Requirement: Shared bot list and language constants

`knownBots`, `LANGUAGES`, `normalizeLanguage`, `isKnownLanguage`, `SUPPORTED_TARGET_LANGUAGES`, and `findSupportedTargetLanguage` SHALL live in `packages/shared` (`@pvtch/shared`) with per-module subpath exports and no barrel. `workers/core` and `workers/lingual` SHALL import them from there, and the copies in `workers/core/app/lib` SHALL be removed.

#### Scenario: Single source for bot list

- **WHEN** a bot username is added to `@pvtch/shared/known-bots`
- **THEN** both the existing translate endpoint and Lingual ignore that user
