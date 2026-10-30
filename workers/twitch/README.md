# @pvtch/twitch

The `pvtch-twitch` worker on `twitch.pvtch.com` is pvtch's Twitch platform layer. It receives EventSub webhooks, routes each event to the handlers a channel has turned on, keeps EventSub subscriptions in sync, and posts handlers' replies to chat. Handlers such as **Lingual** run in their own workers (`workers/lingual`). It serves no user-facing pages; streamers turn handlers on from Bots on www (`pvtch`).

## How it works

```
Twitch ──POST /eventsub──▶ verify HMAC + age ──▶ challenge / revocation: answered inline
                                              └▶ notification: twitch-events queue ──▶ 204

twitch-events consumer
  ├▶ event: router
  │    1. tracked? (@pvtch/shared/twitch-registry)
  │    2. which channel and sender? (condition)  · a sender's own chat message sets its send tier and stops here
  │    3. TwitchChannel.routeEvent: claim + enabled handlers + flags
  │    4. one handler-event per handler on its queue (lingual-events ─▶ pvtch-lingual)
  │       user.authorization.revoke runs here: disable handlers, clear recorded scopes
  ├▶ sync (from TwitchChannel): converge a sender's subscriptions on what its enabled handlers need
  └▶ send (from handlers): claim send:<sendId> + take a token, then POST /helix/chat/messages
```

- **Handlers and senders.** A handler is a feature (`lingual`) with its event types and queue; a sender is the Twitch bot account it posts as (`botlingual`). Both are registered in `@pvtch/shared/twitch-registry`. Subscriptions and send rate limits are per (channel, sender); enablement is per (channel, handler).
- **Only this worker calls Twitch.** `TwitchChannel` (in `pvtch-storage`), `pvtch` and handler workers request Twitch work through the `twitch-events` queue.
- **Duplicates.** Queues deliver at least once, so every hop claims a key on the channel's `TwitchChannel`: the router the EventSub message id, handlers `<handlerId>:<messageId>`, sends `send:<sendId>`. Each hop claims on its first attempt only, so its own retries pass.
- **No user tokens are stored.** Senders post with an app access token (client credentials, cached in `PVTCH_KV`). Twitch records the broadcaster's `channel:bot` grant and the bot account's own scopes.
- **Rate limits:** each (channel, sender) send rate lives in `TwitchChannel`: 20 messages per 30 seconds, or 100 when the sender's own messages carry a moderator badge. Helix 429s wait for `Ratelimit-Reset`. A 200 with `is_sent: false` (AutoMod, duplicates) is logged and not retried.
- **Feature flags** are per channel (`<handlerId>.<feature>`), set at `/admin/flags` and copied onto every handler event.

## Configuration

| Name                     | Kind          | Value                                                                                                                                                     |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWITCH_CLIENT_ID`       | var           | The pvtch Twitch app. Must be the same app as `pvtch`, because broadcasters grant `channel:bot` to that client.                                           |
| `TWITCH_APP_URL`         | var           | `https://twitch.pvtch.com` (EventSub callback and `/bot/callback` base)                                                                                   |
| `ADMIN_USERS`            | var           | Twitch logins allowed on `/bot/*` and `/admin/*` (the bot account is also allowed on `/bot/*`). Empty allows no one.                                      |
| `TWITCH_SECRET`          | Secrets Store | The Twitch app's client secret, shared with `pvtch` (store `a50693a341154908beed43817b887121`). Read it with `readSecret()` from `@pvtch/shared/secrets`. |
| `TWITCH_EVENTSUB_SECRET` | Secrets Store | EventSub signing secret, 10–100 characters                                                                                                                |

For local development, follow `.dev.vars.example` to put both secrets in Wrangler's local secrets store.

## First-time setup

1. On the Twitch app, register these redirect URIs:
   - `https://www.pvtch.com/auth/callback` (login)
   - `https://www.pvtch.com/auth/grant/callback` (scope grants)
   - `https://twitch.pvtch.com/bot/callback` (bot account)
2. Create the queues: `twitch-events`, `twitch-events-dlq`, and each handler's queue (`lingual-events`, `lingual-events-dlq`).
3. Put the Twitch app's client secret in the account's Secrets Store as `TWITCH_SECRET` (both workers bind it), and add `TWITCH_EVENTSUB_SECRET` (10–100 random characters) to the same store.
4. Deploy (see below). The custom domain `twitch.pvtch.com` comes from `routes` in `wrangler.jsonc`.
5. Log into Twitch **as the bot account**, log into www with it, and open `https://twitch.pvtch.com/bot/authorize?sender=botlingual`. This grants the bot `user:bot user:read:chat user:write:chat`.
6. Open `https://twitch.pvtch.com/admin/bootstrap` and press the button. This creates the app-wide `user.authorization.revoke` subscription.
7. A user in `LINGUAL_PREVIEW_USERS` (a `pvtch` var) opens Bots → Lingual on www and turns it on.

## Deploy order

`.github/workflows/deploy.yml` deploys `pvtch-storage` first, then the other changed workers. This worker binds `TwitchChannel` from `pvtch-storage`, so storage must already exist, and `pvtch-storage` produces to `twitch-events`, so the queues must exist before it deploys. This worker also produces to every handler queue, so those must exist too.

## Local testing

```bash
pnpm --filter @pvtch/twitch dev   # runs storage alongside
twitch event trigger channel.chat.message \
  --forward-address http://localhost:8787/eventsub \
  --secret "$YOUR_LOCAL_EVENTSUB_SECRET"
twitch event verify-subscription channel.chat.message \
  --forward-address http://localhost:8787/eventsub \
  --secret "$YOUR_LOCAL_EVENTSUB_SECRET"
```

`pnpm --filter @pvtch/twitch test` covers the webhook, router, subscription sync and send path with mocked `fetch` and in-memory fakes. Lingual's translation tests live in `workers/lingual`.
