import { SESSION_TTL_SECONDS } from '@pvtch/shared/session';

/**
 * Login cookies. `pvtch_token` holds a session token (see
 * `@pvtch/shared/session`), never the user's overlay token, and is HttpOnly
 * so page scripts can't read it; `pvtch_name` is only the display name.
 * Both sit on `Domain=pvtch.com` so twitch.pvtch.com gets them too, except
 * on localhost.
 */

export const SESSION_COOKIE = 'pvtch_token';
export const LOGIN_STATE_COOKIE = 'pvtch_login_state';
const LOGIN_STATE_MAX_AGE_SECONDS = 600;

export function isLocalhost(env: Env): boolean {
  return new URL(env.PVTCH_APP_URL).hostname === 'localhost';
}

function attributes(env: Env): string {
  return isLocalhost(env)
    ? 'Path=/; SameSite=Lax'
    : 'Path=/; SameSite=Lax; Domain=pvtch.com; Secure';
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

export function sessionCookies(
  env: Env,
  sessionToken: string,
  displayName: string
): string[] {
  const base = `${attributes(env)}; Max-Age=${SESSION_TTL_SECONDS}`;
  return [
    `${SESSION_COOKIE}=${sessionToken}; ${base}; HttpOnly`,
    `pvtch_name=${encodeURIComponent(displayName)}; ${base}`,
  ];
}

/** Expires both login cookies, with the attributes they were set with. */
export function clearedSessionCookies(env: Env): string[] {
  const base = attributes(env);
  return [
    `${SESSION_COOKIE}=; ${base}; HttpOnly; Max-Age=0`,
    `pvtch_name=; ${base}; Max-Age=0`,
  ];
}

/**
 * The OAuth `state` for /auth/start → /auth/callback. Scoped to the
 * callback and host-only; pass an empty value to clear it.
 */
export function loginStateCookie(env: Env, value: string): string {
  const secure = isLocalhost(env) ? '' : 'Secure; ';
  const maxAge = value ? LOGIN_STATE_MAX_AGE_SECONDS : 0;
  return `${LOGIN_STATE_COOKIE}=${value}; Path=/auth/callback; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}
