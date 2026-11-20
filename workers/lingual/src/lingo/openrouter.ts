import { OpenRouter } from '@openrouter/sdk';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { readSecret } from '@pvtch/shared/secrets';

export function openRouterClient(env: Env): OpenRouter {
  return new OpenRouter({
    apiKey: () => readSecret(env.PVTCH_OPENROUTER_API_KEY),
    httpReferer: 'https://www.pvtch.com',
    appTitle: 'pvtch Lingual',
  });
}

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
