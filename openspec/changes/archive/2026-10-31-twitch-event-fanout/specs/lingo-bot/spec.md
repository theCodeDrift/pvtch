## MODIFIED Requirements

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

### Requirement: Translation via Workers AI and reply formatting

On `TRANSLATE`, the pipeline in `pvtch-lingual` SHALL call Workers AI with the bot's own copy of the translation prompt and schema, and SHALL skip replying when the LLM fails, reports the same language as the target, or yields an empty string after removing `@usernames`. The reply text SHALL be the translation only (no `ImTyping` prefix), truncated to 500 characters, and requested as a `send` for the handler's sender threaded to the source message. The pipeline SHALL NOT cache translations.

#### Scenario: Successful translation

- **WHEN** `hola amigo` is translated to English as `hello friend`
- **THEN** a `send` of `hello friend` threaded to the source message is enqueued

#### Scenario: LLM says same language

- **WHEN** the LLM reports the detected language equals the target
- **THEN** no `send` is enqueued

#### Scenario: Long translation

- **WHEN** the translation exceeds 500 characters
- **THEN** the requested reply is truncated to 500 characters

### Requirement: Shared bot list and language constants

`knownBots`, `LANGUAGES`, `normalizeLanguage`, `isKnownLanguage`, `SUPPORTED_TARGET_LANGUAGES`, and `findSupportedTargetLanguage` SHALL live in `packages/shared` (`@pvtch/shared`) with per-module subpath exports and no barrel. `workers/core` and `workers/lingual` SHALL import them from there, and the copies in `workers/core/app/lib` SHALL be removed.

#### Scenario: Single source for bot list

- **WHEN** a bot username is added to `@pvtch/shared/known-bots`
- **THEN** both the existing translate endpoint and Lingual ignore that user
