# @pvtch/storage

The `pvtch-storage` worker hosts Durable Objects that other pvtch workers bind with `script_name: "pvtch-storage"`. It serves no public routes; every HTTP request gets a 404.

| Class           | Binding          | Addressed by             | Holds                                                                         |
| --------------- | ---------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `TwitchChannel` | `TWITCH_CHANNEL` | `twitch:{broadcasterId}` | Bot enablement, EventSub subscription record, message dedupe, send rate limit |

The `User` and `PvtchBackend` Durable Objects are not here. They still live in `workers/core`.

## Binding from another worker

```jsonc
// wrangler.jsonc
"durable_objects": {
  "bindings": [
    { "name": "TWITCH_CHANNEL", "class_name": "TwitchChannel", "script_name": "pvtch-storage" }
  ]
}
```

Generate types from both configs (`wrangler types -c wrangler.jsonc -c ../storage/wrangler.jsonc`) and include `../storage/src/**/*` in the binder's `tsconfig.json`. See [Cross-Worker Durable Object Access](../../.conventions/STYLEGUIDE-CODE.md#cross-worker-durable-object-access).

## Deploy order

**Storage deploys before any worker that binds it.** A binder whose `script_name` target is missing, or that binds a class storage doesn't export yet, fails to deploy. `.github/workflows/deploy.yml` enforces the order by deploying `@pvtch/storage` first (phase 1) and every other affected worker after it (phase 2). Cloudflare Workers Builds can't order deploys across workers, so pvtch doesn't use it.

**Removing a Durable Object class takes two releases:**

1. Binders drop their bindings to the class while storage still exports it.
2. Storage deletes the class (`deleted_classes` in a new migration tag).

Doing both in one release wedges the deploy between Cloudflare errors `10061` and `10064`. Never remove a migration tag that has shipped.

## Local development

```bash
# storage alone
pnpm --filter @pvtch/storage dev

# a binder together with storage, sharing DO state
cd workers/<binder>
wrangler dev -c wrangler.jsonc -c ../storage/wrangler.jsonc --persist-to ../../.wrangler
```

## Tests

`pnpm --filter @pvtch/storage test` runs every SQL statement on workerd's own SQLite through Miniflare (`test/helpers/workerd-sql.ts`). The Durable Object's SQLite has limits no Node SQLite reproduces, so a query that only works locally would otherwise pass here and fail in production.

## Provenance

`src/helpers/{migrate,query-rows,job-scheduler}.ts`, `src/rpc-type-checks.ts` and `test/helpers/workerd-sql*` come from [taskless/taskless](https://github.com/taskless/taskless) (MIT). The job scheduler keeps pvtch's rule that only a `pending` job blocks its idempotency key (taskless/taskless#392). `workers/core/do/helpers/` holds an older fork used by the core `User` DO.
