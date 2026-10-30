## ADDED Requirements

### Requirement: Experimental worker

`workers/twitch/wrangler.jsonc` SHALL define a wrangler environment `next` that deploys the same source as `pvtch-twitch` under the name `pvtch-twitch-next`, with `workers_dev: false`, no `routes`, and no queue consumer or producer. It SHALL declare the same `vars`, `secrets_store_secrets`, `kv_namespaces`, `ai`, and `TWITCH_CHANNEL` (`script_name: "pvtch-storage"`) bindings as the top-level config. `TWITCH_APP_URL` SHALL be `https://twitch.pvtch.com`, so subscriptions it creates call back to the single EventSub endpoint. It SHALL NOT declare a `TWITCH_NEXT` binding.

#### Scenario: Bindings match prod

- **WHEN** the binding names of the top-level config and `env.next` are compared, ignoring `routes`, `queues`, and `TWITCH_NEXT`
- **THEN** they are identical

#### Scenario: No public surface

- **WHEN** `pvtch-twitch-next` is deployed
- **THEN** it has no route, custom domain, or `workers.dev` URL, and consumes no queue

### Requirement: Universal queue harness

Both workers SHALL export a `QueueHarness` `WorkerEntrypoint` whose `process(message)` re-parses `message` with `twitchQueueMessage` and returns `processQueueMessage(env, parsed)`. That is the same claim-free processing the stable consumer runs locally. An unparseable message SHALL return `ack`. The return value SHALL be the plain `Outcome` object.

#### Scenario: Same result over RPC

- **WHEN** a parsed queue message is processed locally and through `QueueHarness.process`
- **THEN** both calls take the same actions and return the same `Outcome`

#### Scenario: Forwarded message is not re-claimed

- **WHEN** `pvtch-twitch` forwards a first-attempt chat event it has just claimed
- **THEN** `pvtch-twitch-next` processes it and does not call `claimMessage` or `routeMessage`

### Requirement: Prod binds the experimental worker

The top-level (prod) config SHALL declare the service binding `{ "binding": "TWITCH_NEXT", "service": "pvtch-twitch-next", "entrypoint": "QueueHarness" }`. When the consumer routes a message to `experimental` and the call fails or the binding is unavailable, the message SHALL retry and eventually dead-letter. It SHALL NOT fall back to stable processing.

#### Scenario: Experimental worker throws

- **WHEN** `TWITCH_NEXT.process` throws for an experimental channel's message
- **THEN** the message is retried, and after `max_retries` it lands in `twitch-events-dlq`

#### Scenario: Stable channels unaffected

- **WHEN** `pvtch-twitch-next` is failing
- **THEN** messages for `stable` channels are still processed by `pvtch-twitch`

### Requirement: Developer-run deploy

`workers/twitch/package.json` SHALL provide `deploy:next` running `wrangler deploy --env next`. CI SHALL NOT deploy the `next` environment: the existing `deploy` script and the GitHub deploy workflow are unchanged. `pvtch-twitch-next` SHALL be deployed once, from `main`, before the prod `TWITCH_NEXT` binding is deployed.

#### Scenario: CI deploy

- **WHEN** the GitHub deploy workflow runs
- **THEN** it deploys `pvtch-twitch` and does not deploy `pvtch-twitch-next`

#### Scenario: Testing a branch

- **WHEN** a developer runs `pnpm --filter @pvtch/twitch deploy:next` on a feature branch
- **THEN** only channels whose pool is `experimental` run that branch's processing code
