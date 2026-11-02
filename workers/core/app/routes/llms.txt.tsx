// llms.txt - Machine-readable site information for AI assistants
// See: https://llmstxt.org/

const LLMS_TXT = `# PVTCH

> Free, open-source streaming tools for Twitch streamers

PVTCH provides free tools to enhance Twitch streams. Built on Cloudflare Workers, it's designed to be self-hostable and runs entirely within Cloudflare's free tier.

## Available Tools

### Progress Bar Widget
Create customizable progress bars for OBS browser sources. Track sub goals, donations, bit challenges, or any custom metric with real-time updates.

- URL: /widgets/progress
- Features: Customizable colors, gradients, auto-reset timers, external API integration
- Integration: OBS Browser Source

### Lingo Translator
AI-powered real-time chat translation. Automatically translates foreign language messages in your Twitch chat.

- URL: /helpers/lingo
- Features: Auto-detect source language, configurable target language, bot filtering
- Integration: Firebot, MixItUp, Streamer.bot, custom bots via HTTP API

## Technical Details

- **Platform**: Cloudflare Workers with React Router
- **Storage**: Cloudflare KV + Durable Objects (SQLite-backed)
- **AI**: Cloudflare Workers AI for translations
- **Authentication**: Twitch OAuth

## Self-Hosting

PVTCH is fully open source and can be self-hosted on Cloudflare's free tier.

- Documentation: /howto/deploy-your-own
- Source Code: https://github.com/thecodedrift/pvtch
- License: FSL-1.1-ALv2 (becomes Apache-2.0 two years after each release)

## API Endpoints

Progress Bar:
- GET /progress/:token/:name/get - Get current progress value
- GET /progress/:token/:name/set?current=X&max=Y - Set progress value

Lingo:
- GET /lingo/translate/:token?user=USERNAME&message=MESSAGE - Translate a message

## Contact

- GitHub Issues: https://github.com/thecodedrift/pvtch/issues
- Donate: https://ko-fi.com/theCodeDrift
`;

export function loader() {
  return new Response(LLMS_TXT, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
