# e2e-testing Specification

## Purpose

End-to-end tests for `workers/core` that run against real Cloudflare bindings (notably Workers AI) through `getPlatformProxy`, covering the Lingo translation pipeline's output structure and token preservation, and skipping cleanly when the bindings are unreachable.

## Requirements

### Requirement: Vitest e2e test infrastructure

The system SHALL provide a vitest configuration at `workers/core/vitest.config.ts` that runs e2e tests from the `e2e/` directory. The configuration SHALL resolve the `@/` path alias to `app/` (via `resolve.alias`), SHALL NOT alias `cloudflare:workers` (Miniflare needs the real module), and SHALL set a test timeout of at least 30 seconds to accommodate AI API calls.

#### Scenario: Running e2e tests

- **WHEN** a developer runs `pnpm test:e2e` from `workers/core/`
- **THEN** vitest executes all `e2e/**/*.test.ts` files and reports pass/fail results

### Requirement: Cloudflare bindings via getPlatformProxy

The e2e test suite SHALL use `getPlatformProxy` from wrangler to obtain real Cloudflare bindings (including `env.AI`) without starting an HTTP server. The proxy SHALL be initialized once before all tests and disposed after all tests complete.

#### Scenario: AI binding is available in tests

- **WHEN** the lingo e2e test runs
- **THEN** `env.AI` is a live proxy to Cloudflare Workers AI and can execute model inference

#### Scenario: Bindings unreachable

- **WHEN** `getPlatformProxy` fails or the AI binding cannot be reached (for example in CI without Cloudflare credentials, or without `wrangler login`)
- **THEN** the translation tests are skipped with a logged reason instead of failing the run

### Requirement: Lingo translation structural assertions

The lingo e2e test SHALL validate structural properties of translation output for each fixture. For every fixture, the test SHALL assert:

1. The `translate()` call succeeds (`result.success === true`)
2. The detected language matches the fixture's expected language
3. The `detectedCode` is a valid 3-letter ISO 639-3 code (lowercase alpha)
4. The translation output is a non-empty string

#### Scenario: Non-English input is translated

- **WHEN** a Tagalog input like `"galing na curlyg5Wow"` is translated with target language English
- **THEN** the result succeeds, detected language is `"Tagalog"`, detectedCode is 3 lowercase letters, and translation is non-empty

#### Scenario: English input is returned as-is

- **WHEN** an English input like `"Don't mind nanopanther, he's got a case of the drifties"` is translated with target language English
- **THEN** the result succeeds, detected language is `"English"`, and translation is non-empty

#### Scenario: Mixed-language input detects non-target language

- **WHEN** a Korean/English mixed input like `"내 황홀에 취해, you can't look away"` is translated with target language English
- **THEN** the result succeeds and detected language is `"Korean"`

### Requirement: Token preservation in translations

When a fixture specifies tokens that must be preserved (such as `@usernames` or Twitch emotes), the test SHALL assert that each token appears in the translation output.

#### Scenario: @username is preserved

- **WHEN** input contains `@ohaiDrifty` and the fixture marks it as a preserve token
- **THEN** `@ohaiDrifty` appears in the translation output

#### Scenario: Emote token is preserved

- **WHEN** input contains `curlyg5Wow` and the fixture marks it as a preserve token
- **THEN** `curlyg5Wow` appears in the translation output

### Requirement: Test script in package.json

The `workers/core/package.json` SHALL include a `test:e2e` script that runs vitest with the e2e configuration.

#### Scenario: Script is available

- **WHEN** a developer runs `pnpm test:e2e` from `workers/core/`
- **THEN** vitest runs using `vitest.config.ts` and executes the e2e test suite
