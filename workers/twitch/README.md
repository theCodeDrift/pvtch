# @pvtch/twitch

The `pvtch-twitch` worker on `twitch.pvtch.com`. It receives Twitch EventSub webhooks and runs **Lingual**, the chat bot that replies to chat messages with translations. It serves no user-facing pages; streamers turn Lingual on from Bots → Lingual on www (`pvtch-api`).

## How it works

```
Twitch ──POST /eventsub──▶ verify HMAC + age ──▶ challenge / revocation: answered inline
                                              └▶ notification: twitch-events queue ──▶ 204

twitch-events consumer ──▶ dedupe (TwitchChannel.claimMessage)
                       ├▶ channel.chat.message: filter → translate → POST /helix/chat/messages
                       ├▶ user.authorization.revoke: disable bot, clear recorded scopes
                       └▶ subscribe / unsubscribe / reconcile (requested by TwitchChannel)
```

- **Only this worker calls Twitch.** `TwitchChannel` (in `pvtch-storage`) and `pvtch-api` request Twitch work by putting messages on the `twitch-events` queue.
- **No user tokens are stored.** The bot posts with an app access token (client credentials, cached in `PVTCH_KV`). Twitch records the broadcaster's `channel:bot` grant and the bot account's own scopes.
- **Rate limits:** each channel's send rate lives in `TwitchChannel`: 20 messages per 30 seconds, or 100 when the bot's own messages carry a moderator badge. Helix 429s wait for `Ratelimit-Reset`. A 200 with `is_sent: false` (AutoMod, duplicates) is logged and not retried.
- **Translation:** `src/lingo/` is the bot's own copy of Lingo detection. It reads EventSub message fragments, so native emotes and mentions are dropped exactly rather than guessed at. The language and ignore list come from the streamer's Lingo settings in core's `User` DO (bound read-only).

## Configuration

| Name                     | Kind          | Value                                                                                                                                                         |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWITCH_CLIENT_ID`       | var           | The pvtch Twitch app. Must be the same app as `pvtch-api`, because broadcasters grant `channel:bot` to that client.                                           |
| `TWITCH_BOT_USER_ID`     | var           | The bot account's Twitch user id (`botlingual`: `1591556954`)                                                                                                 |
| `TWITCH_APP_URL`         | var           | `https://twitch.pvtch.com` (EventSub callback and `/bot/callback` base)                                                                                       |
| `ADMIN_USERS`            | var           | Twitch logins allowed on `/bot/*` and `/admin/*`. Empty allows no one.                                                                                        |
| `TWITCH_SECRET`          | Secrets Store | The Twitch app's client secret, shared with `pvtch-api` (store `a50693a341154908beed43817b887121`). Read it with `readSecret()` from `@pvtch/shared/secrets`. |
| `TWITCH_EVENTSUB_SECRET` | Secrets Store | EventSub signing secret, 10–100 characters                                                                                                                    |

For local development, follow `.dev.vars.example` to put both secrets in Wrangler's local secrets store.

## First-time setup

1. On the Twitch app, register these redirect URIs:
   - `https://www.pvtch.com/auth/callback` (login)
   - `https://www.pvtch.com/auth/grant/callback` (scope grants)
   - `https://twitch.pvtch.com/bot/callback` (bot account)
2. Create the queues: `wrangler queues create twitch-events` and `wrangler queues create twitch-events-dlq`.
3. Put the Twitch app's client secret in the account's Secrets Store as `TWITCH_SECRET` (both workers bind it), and add `TWITCH_EVENTSUB_SECRET` (10–100 random characters) to the same store.
4. Deploy (see below). The custom domain `twitch.pvtch.com` comes from `routes` in `wrangler.jsonc`.
5. As a user in `ADMIN_USERS`, log into Twitch **as the bot account** and open `https://twitch.pvtch.com/bot/authorize`. This grants the bot `user:bot user:read:chat user:write:chat`.
6. Open `https://twitch.pvtch.com/admin/bootstrap` and press the button. This creates the app-wide `user.authorization.revoke` subscription.
7. A user in `LINGUAL_PREVIEW_USERS` (a `pvtch-api` var) opens Bots → Lingual on www and turns it on.

## Deploy order

`.github/workflows/deploy.yml` deploys `pvtch-storage` first, then the other changed workers. This worker binds `TwitchChannel` from `pvtch-storage` and `User` from `pvtch-api`, so both must already exist, and `pvtch-storage` produces to `twitch-events`, so the queues must exist before it deploys.

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

`pnpm --filter @pvtch/twitch test` covers the webhook, consumer, subscriptions, send path and translation with mocked `fetch` and in-memory fakes.
