## MODIFIED Requirements

### Requirement: Lingual settings live in TwitchChannel

Lingual SHALL keep its own settings, a target `language` and a list of `ignoredChatters`, in the broadcaster's `TwitchChannel` `Lingual` plugin, read by the `lingual` bot handler (`workers/twitch/src/bots/lingual/`) through `using lingual = await channel.lingual()` and `lingual.getSettings()`. They are separate from the Lingo helper's config. `pvtch-twitch` SHALL NOT bind or read core's `User` DO. If no `language` is set, the event SHALL be acked without translating.

#### Scenario: Configured channel

- **WHEN** a chat event arrives for a broadcaster whose Lingual language is `english`
- **THEN** the pipeline targets English

#### Scenario: Unconfigured channel

- **WHEN** a chat event arrives for a broadcaster with no Lingual language set
- **THEN** no translation or send occurs

#### Scenario: Lingo helper settings are not used

- **WHEN** a broadcaster has a Lingo helper language but no Lingual language
- **THEN** no translation or send occurs
