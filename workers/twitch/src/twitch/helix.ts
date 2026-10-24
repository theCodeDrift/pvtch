import { z } from 'zod';

const HELIX_BASE = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const APP_TOKEN_KEY = 'twitch-app-token';
/** Refresh this long before Twitch's stated expiry. */
const EXPIRY_MARGIN_SECONDS = 300;
/** KV's minimum expirationTtl. */
const MIN_KV_TTL_SECONDS = 60;

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

/**
 * A Twitch app access token (client credentials), cached in PVTCH_KV until
 * shortly before it expires.
 */
export async function getAppToken(
  env: Env,
  options: { forceRefresh?: boolean } = {}
): Promise<string> {
  if (!options.forceRefresh) {
    const cached = await env.PVTCH_KV.get(APP_TOKEN_KEY);
    if (cached) return cached;
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_SECRET,
      grant_type: 'client_credentials',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Twitch app token request failed: ${response.status}`);
  }
  const { access_token, expires_in } = tokenResponse.parse(
    await response.json()
  );
  await env.PVTCH_KV.put(APP_TOKEN_KEY, access_token, {
    expirationTtl: Math.max(
      MIN_KV_TTL_SECONDS,
      expires_in - EXPIRY_MARGIN_SECONDS
    ),
  });
  return access_token;
}

/**
 * Call the Helix API with the app token. On a 401 the token is refreshed
 * once and the request retried once. Helix does not back off for you: the
 * caller reads `Ratelimit-Reset` on a 429.
 */
export async function helix(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const call = async (token: string) =>
    fetch(`${HELIX_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': env.TWITCH_CLIENT_ID,
        ...(init.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  const response = await call(await getAppToken(env));
  if (response.status !== 401) return response;
  return call(await getAppToken(env, { forceRefresh: true }));
}

/**
 * Seconds until Helix's rate-limit bucket resets, from the `Ratelimit-Reset`
 * header (epoch seconds). Falls back to `fallback` when absent.
 */
export function rateLimitResetSeconds(
  response: Response,
  now = Date.now(),
  fallback = 5
): number {
  const reset = Number(response.headers.get('Ratelimit-Reset'));
  if (!Number.isFinite(reset) || reset <= 0) return fallback;
  return Math.max(1, Math.ceil(reset - now / 1000));
}
