import { isLocalhost, readCookie } from '@/lib/session-cookie';

/** The Twitch scope Lingual needs from the broadcaster to chat as the bot. */
export const LINGUAL_SCOPE = 'channel:bot';

/**
 * Whether a user can see Bots > Lingual during rollout. Unlike
 * ALLOWED_USERS, an empty LINGUAL_PREVIEW_USERS shows it to no one.
 */
export function canUseLingual(env: Env, login?: string): boolean {
  if (!login) return false;
  const preview = env.LINGUAL_PREVIEW_USERS.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return preview.includes(login.toLowerCase());
}

/**
 * Turning Lingual on without the scope sends the user through
 * /auth/grant and back. The return URL carries a one-time nonce that must
 * match an HttpOnly cookie set when the user pressed "Turn on", so
 * revisiting the URL, a bookmark, or a cross-site link can't re-enable a
 * bot the user turned off.
 */
export const LINGUAL_ENABLE_COOKIE = 'pvtch_lingual_enable';
const LINGUAL_PATH = '/bots/lingual';
const LINGUAL_ENABLE_MAX_AGE_SECONDS = 600;

function enableCookie(env: Env, value: string, maxAge: number): string {
  const secure = isLocalhost(env) ? '' : 'Secure; ';
  return `${LINGUAL_ENABLE_COOKIE}=${value}; Path=${LINGUAL_PATH}; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}

export function lingualEnableCookie(env: Env, nonce: string): string {
  return enableCookie(env, nonce, LINGUAL_ENABLE_MAX_AGE_SECONDS);
}

export function clearLingualEnableCookie(env: Env): string {
  return enableCookie(env, '', 0);
}

/** /auth/grant for the Lingual scope, returning with `nonce`. */
export function lingualGrantUrl(nonce: string): string {
  return `/auth/grant?${new URLSearchParams({
    scopes: LINGUAL_SCOPE,
    return_to: `${LINGUAL_PATH}?${new URLSearchParams({ enable: nonce }).toString()}`,
  }).toString()}`;
}

/** Whether the `enable` nonce on `request` matches its enable cookie. */
export function hasPendingEnable(request: Request): boolean {
  const nonce = new URL(request.url).searchParams.get('enable');
  if (!nonce) return false;
  return readCookie(request, LINGUAL_ENABLE_COOKIE) === nonce;
}
