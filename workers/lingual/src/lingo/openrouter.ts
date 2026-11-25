// The SDK's standalone functions, not the `OpenRouter` class: the class pulls
// every endpoint's Zod schemas into the bundle and builds them at startup
// (~1.6 MB and ~160 ms), enough to fail Cloudflare's startup CPU limit.
// Never import a value from `@openrouter/sdk` itself; `import type` is fine.
import { OpenRouterCore } from '@openrouter/sdk/core.js';
import type { ProviderPreferences } from '@openrouter/sdk/models/providerpreferences.js';
import { OpenRouterError } from '@openrouter/sdk/models/errors/openroutererror.js';
import { readSecret } from '@pvtch/shared/secrets';

export function openRouterClient(env: Env): OpenRouterCore {
  return new OpenRouterCore({
    apiKey: () => readSecret(env.PVTCH_OPENROUTER_API_KEY),
    httpReferer: 'https://www.pvtch.com',
    appTitle: 'pvtch Lingual',
  });
}

/**
 * Chat messages are other people's words, so every call routes only to
 * endpoints on OpenRouter's zero data retention list that don't train on
 * prompts. A model with no such endpoint fails rather than falling back. The
 * public LLM page (/llm on www) promises this; change both together.
 */
export const PRIVATE_ROUTING = {
  zdr: true,
  dataCollection: 'deny',
} as const satisfies ProviderPreferences;

/** How much of an error response body to log. */
const MAX_LOGGED_BODY = 1000;

/**
 * A failed OpenRouter call as plain fields for the log. Workers logs print an
 * Error passed to console.error as its stack alone, and the SDK builds its
 * HTTP errors inside a Zod transform, so without this the log shows only Zod
 * frames and never the status or what OpenRouter said.
 */
export function describeOpenRouterError(
  error: unknown
): Record<string, unknown> {
  if (error instanceof OpenRouterError) {
    return {
      name: error.name,
      status: error.statusCode,
      message: error.message,
      body: error.body.slice(0, MAX_LOGGED_BODY),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}
