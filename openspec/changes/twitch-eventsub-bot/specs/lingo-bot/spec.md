## ADDED Requirements

### Requirement: Bot config read from the User Durable Object

The bot pipeline SHALL read `{ bots, language }` from the broadcaster's existing `User` DO (`PVTCH_USER` bound with `script_name: "pvtch-api"`, addressed `twitch:{broadcasterId}`) via `lingo().getConfig()`. If no config or no `language` exists, the event SHALL be acked without translating. The bot SHALL NOT write to the `User` DO.

#### Scenario: Configured channel

- **WHEN** a chat event arrives for a broadcaster whose lingo language is `english`
- **THEN** the pipeline targets English

#### Scenario: Unconfigured channel

- **WHEN** a chat event arrives for a broadcaster with no lingo config
- **THEN** no translation or send occurs

### Requirement: Fragment-based detection input

The bot pipeline SHALL build its detection input from `event.message.fragments` by concatenating only fragments of type `text`, excluding `emote`, `cheermote`, and `mention` fragments. It SHALL then strip URLs, strip emote-shaped tokens (for third-party emotes delivered as text), collapse whitespace, and collapse runs of 3+ identical characters to 2. The original `event.message.text` SHALL remain the LLM input.

#### Scenario: Native emotes and mentions removed

- **WHEN** fragments are `[mention "@bob", text " hola amigo ", emote "Kappa"]`
- **THEN** the detection input is `hola amigo`

#### Scenario: Third-party emote in text

- **WHEN** a text fragment is `KEKW que risa`
- **THEN** the detection input is `que risa`

### Requirement: Independent detection decision

The bot SHALL have its own detection module under `workers/twitch/src/lingo/` that returns `TRANSLATE` or a skip action, initially equivalent in behavior to `workers/core`'s `decide()` (length gate, script gate, classifier ensemble with the same thresholds), and SHALL NOT import from `workers/core`. Changes to the bot's detection SHALL NOT affect `/lingo/translate/:token`.

#### Scenario: Message already in target language

- **WHEN** detection input is confidently in the target language
- **THEN** the pipeline skips without calling the LLM

#### Scenario: Foreign-language message

- **WHEN** detection returns `TRANSLATE`
- **THEN** the LLM is called with the original message text and target language

### Requirement: Translation via Workers AI and reply formatting

On `TRANSLATE`, the pipeline SHALL call Workers AI with the bot's own copy of the translation prompt and schema, and SHALL skip sending when the LLM fails, reports the same language as the target, or yields an empty string after removing `@usernames`. The reply text SHALL be the translation only (no `ImTyping` prefix), truncated to 500 characters, and sent as a threaded reply to the source message. The pipeline SHALL NOT cache translations.

#### Scenario: Successful translation

- **WHEN** `hola amigo` is translated to English as `hello friend`
- **THEN** the bot replies `hello friend` threaded to the source message

#### Scenario: LLM says same language

- **WHEN** the LLM reports the detected language equals the target
- **THEN** no reply is sent

#### Scenario: Long translation

- **WHEN** the translation exceeds 500 characters
- **THEN** the reply is truncated to 500 characters

### Requirement: Shared bot list and language constants

`knownBots`, `LANGUAGES`, `normalizeLanguage`, `isKnownLanguage`, `SUPPORTED_TARGET_LANGUAGES`, and `findSupportedTargetLanguage` SHALL live in `packages/shared` (`@pvtch/shared`) with per-module subpath exports and no barrel. Both `workers/core` and `workers/twitch` SHALL import them from there, and the copies in `workers/core/app/lib` SHALL be removed.

#### Scenario: Single source for bot list

- **WHEN** a bot username is added to `@pvtch/shared/known-bots`
- **THEN** both the existing translate endpoint and the bot ignore that user
