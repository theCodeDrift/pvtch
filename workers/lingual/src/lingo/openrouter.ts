import { OpenRouter } from '@openrouter/sdk';
import { readSecret } from '@pvtch/shared/secrets';

export function openRouterClient(env: Env): OpenRouter {
  return new OpenRouter({
    apiKey: () => readSecret(env.PVTCH_OPENROUTER_API_KEY),
    httpReferer: 'https://www.pvtch.com',
    appTitle: 'pvtch Lingual',
  });
}
