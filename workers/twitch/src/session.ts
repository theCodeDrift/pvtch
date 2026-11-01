import { resolveSession } from '@pvtch/shared/session';
import { TWITCH_SENDERS, type SenderId } from '@pvtch/shared/twitch-registry';

export interface SessionUser {
  id: string;
  login: string;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

/**
 * The pvtch user behind the session in the `pvtch_token` cookie. www sets
 * it on `Domain=pvtch.com`, so it reaches twitch.pvtch.com too; both
 * workers resolve it with the same `@pvtch/shared/session` lookup.
 */
export async function getSessionUser(
  request: Request,
  env: Env
): Promise<SessionUser | undefined> {
  const account = await resolveSession(
    env.PVTCH_ACCOUNTS,
    readCookie(request, 'pvtch_token')
  );
  return account ? { id: account.id, login: account.login } : undefined;
}

/**
 * Whether a state-changing request came from a twitch.pvtch.com page. The
 * session cookie is SameSite=Lax on `Domain=pvtch.com`, so every
 * *.pvtch.com page counts as same-site and can POST here with it; only the
 * origin tells them apart. Browsers send `Origin` on form POSTs; a request
 * without one falls back to `Sec-Fetch-Site`, and one with neither is refused.
 */
export function isSameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(env.TWITCH_APP_URL).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/**
 * Admin-only routes (bot account authorization, bootstrap) require a login
 * in ADMIN_USERS. Unlike ALLOWED_USERS, an empty list allows no one.
 */
export function isAdmin(env: Env, user: SessionUser | undefined): boolean {
  if (!user) return false;
  const admins = env.ADMIN_USERS.split(',')
    .map((login) => login.trim().toLowerCase())
    .filter((login) => login.length > 0);
  return admins.includes(user.login.toLowerCase());
}

/**
 * /bot/* routes also admit the sender's bot account itself, so it can log
 * into www and grant its own scopes without juggling two Twitch logins. The
 * callback still rejects any authorizing account other than that sender.
 */
export function canAuthorizeSender(
  env: Env,
  user: SessionUser | undefined,
  senderId: SenderId
): boolean {
  return isAdmin(env, user) || user?.id === TWITCH_SENDERS[senderId].userId;
}

export { readCookie };
