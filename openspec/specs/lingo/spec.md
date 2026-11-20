# lingo Specification

## Purpose

The retired Lingo chatbot translation API and its remaining configuration page. Lingual (`lingual-worker`, `lingo-bot`) replaces it.

## Requirements

### Requirement: Retired translation API endpoint

`/lingo/translate/:token` SHALL be retired: GET and POST SHALL return `handleDeprecatedRoute`'s response, HTTP 410 with a chat-safe notice body on the first request per token per day and an empty body after that. It SHALL NOT call a model.

#### Scenario: Chatbot calls the retired endpoint

- **WHEN** a chatbot requests `/lingo/translate/:token` for the first time in a day
- **THEN** it gets HTTP 410 with a notice to see pvtch.com

#### Scenario: Later calls the same day

- **WHEN** the same token requests it again within 24 hours
- **THEN** it gets HTTP 410 with an empty body

### Requirement: Lingo configuration

The system SHALL store per-user lingo configuration in a Durable Object with key `lingo-config`. The configuration SHALL contain `bots` (array of usernames to ignore, max 15) and `language` (target language string, max 60 characters). Configuration SHALL be validated against a Zod schema.

#### Scenario: Valid config save

- **WHEN** a valid configuration is submitted to `/lingo/config/:token/set`
- **THEN** it is stored in the Durable Object with 30-day TTL (PRESERVE_ON_FETCH)

#### Scenario: Invalid config

- **WHEN** an invalid configuration is submitted (fails Zod validation)
- **THEN** the system returns HTTP 400 with an error message

### Requirement: Lingo dashboard

The system SHALL provide a page at `/helpers/lingo` that says Lingo was retired early, that its translate URL no longer translates, and that Lingo users will be upgraded automatically to a translation bot in development. It SHALL NOT link to Lingual, which is still in preview. Authenticated users SHALL still be able to view and save their target language and ignored bots list. The page SHALL NOT show the translate URL or chatbot setup guides.

#### Scenario: Retirement notice

- **WHEN** anyone visits `/helpers/lingo`
- **THEN** the page shows the retirement notice without a link to Lingual

#### Scenario: Authenticated user configures lingo

- **WHEN** an authenticated user visits `/helpers/lingo`
- **THEN** the existing configuration is loaded and displayed in an editable form

#### Scenario: Save configuration from dashboard

- **WHEN** a user submits the configuration form
- **THEN** bots are parsed from comma-separated input, each trimmed, limited to 64 chars and 15 entries, and saved with the target language

#### Scenario: Unauthenticated user

- **WHEN** an unauthenticated user visits `/helpers/lingo`
- **THEN** the system displays a login prompt
