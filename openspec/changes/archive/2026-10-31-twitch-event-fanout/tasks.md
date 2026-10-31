## 0. Prerequisites

- [x] 0.1 Create the queues on the pvtch account (`bda0488147d6159dfe8913c8ee9d2413`): `lingual-events` (`e7fadfc916634d8eb136326e0f4e9a40`) and `lingual-events-dlq` (`992069321b294577b5cfd569a002122c`). Bindings refer to them by name, so no ID goes in config.
- [x] 0.2 Pin `account_id` in every worker's `wrangler.jsonc`. `workers/lingual` gets the same line when it is scaffolded (4.1).

## 1. Shared registry and messages (packages/shared)

- [x] 1.1 Add the `@pvtch/shared/twitch-registry` subpath: `TWITCH_SENDERS` (`botlingual`), `TWITCH_HANDLERS` (`lingual`), `CHANNEL_EVENT_TYPES`, `senderForUserId`, `handlersFor`, and the id types.
- [x] 1.2 Add a registry unit test covering unique sender `userId`s, handlers naming registered senders, and the lookup hit and miss cases.
- [x] 1.3 Reshape `@pvtch/shared/twitch-queue`: `event` gains `condition`; add `sync`, `send` and `handler-event`; remove `subscribe`, `unsubscribe` and `reconcile`.

## 2. TwitchChannel (workers/storage)

- [x] 2.1 Add a core migration that drops `bot_state`, `subscriptions`, `send_bucket` and `lingual_settings`, and creates `handlers`, `subscriptions (sender_id, type)` and `send_buckets (sender_id)`.
- [x] 2.2 Add the handler methods (`getHandler`, `listHandlers`, `enableHandler`, `disableHandler`) and the per-sender subscription and send-bucket methods.
- [x] 2.3 Add the `sync-subscriptions:<senderId>` one-shot and the `reconcile-subscriptions:<senderId>` cron, scheduled and cancelled from handler state changes. Parse the suffix in `runJob`. Remove the old request and reconcile tasks.
- [x] 2.4 Generalize `claimMessage` into `claim(key)`, add `routeEvent`, and give `acquireSendSlot` its `claimKey` (claim first; on a duplicate, return `{ ok: false, duplicate: true }` without touching the bucket).
- [x] 2.5 Add `plugins/lingual.ts` and `plugins/flags.ts` (`RpcTarget`, each with its own migrations) and the `lingual()` / `flags()` accessors.
- [x] 2.6 Write tests for each scenario in `specs/twitch-channel/spec.md`, and keep `AssertRPCSerializable` passing.

## 3. Router, sync and send (workers/twitch)

- [x] 3.1 In `eventsub/webhook.ts`, enqueue `condition`. Verification and revocation resolve the sender and act per `(senderId, type)`. Authorization loss disables that sender's handlers.
- [x] 3.2 Rewrite `consumer.ts` to dispatch `event` → router, `sync` → `twitch/subscriptions.ts`, `send` → a new `twitch/send.ts`.
- [x] 3.3 Add the router: tracked → who for → own-sender check (send tier) → `routeEvent` → fan-out to `env[queue]`, with the channel-level revoke handler run in-process.
- [x] 3.4 Rewrite `twitch/subscriptions.ts` as a per-sender sync that converges on the desired set.
- [x] 3.5 Move the Helix send from `bot/chat.ts` into `twitch/send.ts`: staleness check, slot with a `send:<sendId>` claim on the first attempt (ack duplicates), then 429/5xx/403/`is_sent` handling.
- [x] 3.6 Add `?sender=` to `bot-authorize`. Add `/admin/flags`, and extend `/admin/status`.
- [x] 3.7 Add the `LINGUAL_EVENTS` producer to `wrangler.jsonc`, remove `TWITCH_BOT_USER_ID`, and run `cf-typegen`.
- [x] 3.8 Delete `bot/chat.ts` and `lingo/` once they have moved (section 4).
- [x] 3.9 Write tests for each scenario in `specs/twitch-event-fanout` (router), `specs/twitch-eventsub-ingest`, `specs/twitch-chat-bot` and the authorization part of `specs/bot-consent`.

## 4. pvtch-lingual (workers/lingual)

- [x] 4.1 Scaffold `workers/lingual` (`@pvtch/lingual`) from `workers/twitch`'s package and tsconfig. Set up `wrangler.jsonc` as specified (`TWITCH_CHANNEL`, `TWITCH_EVENTS` producer, `AI`, `lingual-events` consumer and DLQ), with `cf-typegen` against `../storage/wrangler.jsonc`.
- [x] 4.2 Move `lingo/` and the content filters from `bot/chat.ts`. Read settings via `channel.lingual()`, and enqueue `send` instead of calling Helix.
- [x] 4.3 Add the consumer: parse the `handler-event`, run the handler dedupe claim, then the flow; apply the outcome.
- [x] 4.4 Move the lingo and chat tests over, and write tests for each scenario in `specs/lingual-worker` and `specs/lingo-bot`.
- [x] 4.5 Confirm turbo's `deploy` picks up `@pvtch/lingual` in the CI workflow's second phase.

## 5. www (workers/core)

- [x] 5.1 Change `/bots/lingual` to use `getHandler` / `enableHandler` / `disableHandler('lingual')`, `getSubscription('botlingual', 'channel.chat.message')` and `channel.lingual()` settings.
- [x] 5.2 Take the login from `TWITCH_SENDERS`, remove `LINGUAL_BOT_LOGIN`, and run `cf-typegen`.

## 6. Verify and ship

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
- [x] 6.2 Merge. CI deploys storage, then twitch, lingual and core.
- [x] 6.3 Re-enable Lingual and re-enter its settings. In `/admin/status`, check that `lingual` is enabled and botlingual's subscription is `enabled`. Chat a non-target-language line and get a threaded reply.
- [x] 6.4 Turn a test flag on with `/admin/flags`, confirm it shows on handler messages (log it in `pvtch-lingual`), then turn it off.
