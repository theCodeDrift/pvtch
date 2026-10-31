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
2. Redirected to `/auth/start` which redirects to Twitch
3. After approval, Twitch redirects to `/auth/callback`
4. Callback exchanges code for tokens, creates/updates user record
5. Sets the `pvtch_token` and `pvtch_name` cookies and redirects to app

The `pvtch_token` cookie is used to identify users for API calls. API routes validate this token against the `PVTCH_ACCOUNTS` KV namespace. It is HttpOnly, so page scripts can't read it; the header uses the readable `pvtch_name` cookie (the display name) to show who is signed in. Signing out POSTs to `/auth/logout`, which clears both.

## Durable Object Storage

The `PvtchBackend` Durable Object provides per-user storage with TTL support. Each user gets their own DO instance (keyed by their token + a name scope). This is used for:

- Progress bar values (with configurable TTL for auto-reset)
- Lingo configuration (target language, model preferences)

The DO uses SQLite for storage, providing fast reads and atomic updates.
