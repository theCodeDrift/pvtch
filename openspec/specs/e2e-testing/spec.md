# e2e-testing Specification

## Purpose

End-to-end tests for `workers/core`, run with vitest from the `e2e/` directory.

## Requirements

### Requirement: Vitest e2e test infrastructure

The system SHALL provide a vitest configuration at `workers/core/vitest.config.ts` that runs e2e tests from the `e2e/` directory. The configuration SHALL resolve the `@/` path alias to `app/` (via `resolve.alias`), SHALL NOT alias `cloudflare:workers` (Miniflare needs the real module), and SHALL set a test timeout of at least 30 seconds.

#### Scenario: Running e2e tests

- **WHEN** a developer runs `pnpm test:e2e` from `workers/core/`
- **THEN** vitest executes all `e2e/**/*.test.ts` files and reports pass/fail results

### Requirement: Test script in package.json

The `workers/core/package.json` SHALL include a `test:e2e` script that runs vitest with the e2e configuration.

#### Scenario: Script is available

- **WHEN** a developer runs `pnpm test:e2e` from `workers/core/`
- **THEN** vitest runs using `vitest.config.ts` and executes the e2e test suite
