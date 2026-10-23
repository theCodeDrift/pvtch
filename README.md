# PVTCH

Simple streamer tools for Twitch content creators.

PVTCH provides lightweight, embeddable widgets and utilities for streamers.

Built for simplicity - no complex setup, no databases to manage, just connect your Twitch account and start using.

Built for private clouds - also must be deployable to your own Cloudflare account for full control.

## Design

PVTCH runs entirely on [Cloudflare Workers](https://workers.cloudflare.com/), making it fast, globally distributed, and easy to self-host. The stack includes:

- **Workers** - Serverless compute for API and pages
- **Durable Objects** - Persistent state with SQLite storage
- **KV** - Fast key-value storage for caching and tokens
- **Cloudflare AI** - Powers the Lingo translation feature

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Cloudflare account (free tier works)

### Local Development

```bash
# Clone the repository
git clone https://github.com/thecodedrift/pvtch.git
cd pvtch-api

# Install dependencies
pnpm install

# Create a .dev.vars file in workers/core/ with your secrets
# (see workers/core/.dev.vars.example if available)

# Start the dev server
cd workers/core
pnpm run dev
```

### Configuration

Create the following secrets in your Cloudflare dashboard or via `wrangler secret put`:

- `TWITCH_SECRET` - Your Twitch application client secret

### Deploy

Merges to `main` deploy through `.github/workflows/deploy.yml`, which runs `turbo run deploy` for the workers that changed. `workers/storage` hosts Durable Objects that other workers bind, so it always deploys first; see [workers/storage/README.md](workers/storage/README.md#deploy-order).

To deploy by hand, follow the same order:

```bash
pnpm --filter @pvtch/storage deploy
pnpm --filter @pvtch/core deploy
```

# Use of AI In This Project

## Services

PVTCH uses Cloudflare's AI services to power the Lingo translation feature, which provides real-time chat translation for Twitch streamers. This allows streamers to engage with a global audience by translating chat messages into their preferred language. The AI handles the translation process, and is subject to all of the limitations and ethical considerations associated with AI, including potential inaccuracies in translation and the need for responsible use of AI-generated content.

## Codebase

This codebase is partially built with coding agents, prioritizing documenting the design and architecture of the project. We have a strict "contributors own the commit" policy. This means if you submit a PR, it is assumed to be from you, regardless of the tool used. Repeated low quality contributions may result in a ban from contributing to the project. We encourage all contributors to ensure their contributions are of high quality and adhere to the project's standards.

To assist in AI assisted contributions, this project leverages OpenSpec https://github.com/Fission-AI/OpenSpec to help agentic systems.

It is **REQUIRED** to use OpenSpec for any AI assisted contributions to this project. This allows us to maintain a clear record of which contributions were AI assisted and ensures that all contributions meet the project's standards for quality and consistency. For human-contributions, we will extend your PR to include OpenSpec items so that we have a historical record of the contribution and its context.
