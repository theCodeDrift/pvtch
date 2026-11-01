# @pvtch/core

A React Router 7 application running on Cloudflare Workers that provides the PVTCH streaming tools platform. This includes both the web UI for configuration and the API endpoints used by OBS sources and chat bots.

## Architecture

This app is a unified deployment that serves:

- **Web UI** - Configuration pages for widgets and helpers
- **OBS Sources** - Embeddable browser sources for streaming software
- **API Endpoints** - JSON APIs consumed by bots and external tools

### Tech Stack

- **Framework**: React Router 7 with SSR
- **Runtime**: Cloudflare Workers
- **Storage**: Cloudflare KV + Durable Objects (SQLite-backed)
- **AI**: Cloudflare Workers AI (for translations)
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Wrangler CLI (`pnpm add -g wrangler`)

### Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create `.dev.vars` file with local development secrets:

   ```bash
   DEVELOPMENT=1
   DISABLE_CACHE=1
   TWITCH_CLIENT_ID=your_dev_twitch_client_id
   TWITCH_SECRET=your_dev_twitch_secret
   PVTCH_APP_URL=http://localhost:5173
   TWITCH_REDIRECT_URI=http://localhost:5173/auth/callback
   ```

3. Generate types:

   ```bash
   pnpm run typecheck
   ```

4. Start the dev server:
   ```bash
   pnpm run dev
   ```

### Environment Variables

#### Required in `.dev.vars` (local development)

| Variable              | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `DEVELOPMENT`         | Set to `1` to enable dev features (e.g., `/lingo/test`) |
| `DISABLE_CACHE`       | Set to `1` to disable translation caching               |
| `TWITCH_CLIENT_ID`    | Twitch application client ID                            |
| `TWITCH_SECRET`       | Twitch application client secret                        |
| `PVTCH_APP_URL`       | Base URL for the app (for redirects)                    |
| `TWITCH_REDIRECT_URI` | OAuth callback URL registered with Twitch               |

#### Production Variables (set in wrangler.jsonc or Cloudflare dashboard)

Production secrets (`TWITCH_SECRET`) should be set via:

```bash
wrangler secret put TWITCH_SECRET
```

### Scripts

| Script               | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm run dev`       | Start development server                |
| `pnpm run build`     | Build for production                    |
| `pnpm run deploy`    | Build and deploy to Cloudflare          |
| `pnpm run typecheck` | Generate types and run TypeScript check |
| `pnpm run lint`      | Run ESLint                              |
| `pnpm run lint:fix`  | Run ESLint with auto-fix                |

## Cloudflare Bindings

Configured in `wrangler.jsonc`:

### KV Namespaces

| Binding          | Purpose                    |
| ---------------- | -------------------------- |
| `PVTCH_KV`       | General key-value storage  |
| `PVTCH_ACCOUNTS` | Twitch auth token mappings |

### Durable Objects

| Binding         | Class          | Purpose                                                    |
| --------------- | -------------- | ---------------------------------------------------------- |
| `PVTCH_BACKEND` | `PvtchBackend` | Per-user TTL-based storage for progress values and configs |

### AI

| Binding | Purpose                                |
| ------- | -------------------------------------- |
| `AI`    | Cloudflare Workers AI for translations |

## Authentication

Users authenticate via Twitch OAuth. The flow:

1. User clicks "Login with Twitch" button
2. Redirected to `/auth/start`, which sets a `pvtch_login_state` cookie and redirects to Twitch with the same `state`
3. After approval, Twitch redirects to `/auth/callback`, which rejects a missing or mismatched `state`
4. Callback exchanges code for tokens, creates/updates user record
5. Creates a session, sets the `pvtch_token` and `pvtch_name` cookies and redirects to app

Each user has two separate values in the `PVTCH_ACCOUNTS` KV namespace:

- **Overlay key** (`token` on `twitch-data-{id}`, reverse-mapped by `token-data-{token}`): created once and never changed. It's part of the user's overlay and API URLs (`/sources/progress/:token/…`, `/progress/:token/…`, `/lingo/…/:token`), and those routes validate it with `isValidToken`. It is not a login.
- **Session** (`session-{sessionToken}` → `{ userId, token }`, 30-day expiry): one per sign-in. The `pvtch_token` cookie holds the session token. Pages resolve it in `app/middleware/auth.ts` through `@pvtch/shared/session`, which pvtch-twitch also uses. A session only resolves while its `token` still matches the account's overlay key.

`pvtch_token` is HttpOnly, so page scripts can't read it; the header gets the signed-in name from the layout loader. Signing out POSTs to `/auth/logout`, which deletes the session record and clears both cookies.

## Durable Object Storage

The `PvtchBackend` Durable Object provides per-user storage with TTL support. Each user gets their own DO instance (keyed by their token + a name scope). This is used for:

- Progress bar values (with configurable TTL for auto-reset)
- Lingo configuration (target language, model preferences)

The DO uses SQLite for storage, providing fast reads and atomic updates.
