import { TWITCH_SENDERS, type SenderId } from '@pvtch/shared/twitch-registry';

const TOKEN_PREFIX = 'token-data-';
const TWITCH_DATA_PREFIX = 'twitch-data-';

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
 * The pvtch user behind the `pvtch_token` cookie. www sets it on
 * `Domain=pvtch.com`, so it reaches twitch.pvtch.com too; both workers read
 * the same PVTCH_ACCOUNTS records.
 */
export async function getSessionUser(
  request: Request,
  env: Env
): Promise<SessionUser | undefined> {
  const token = readCookie(request, 'pvtch_token');
  if (!token) return undefined;
  const userId = await env.PVTCH_ACCOUNTS.get(`${TOKEN_PREFIX}${token}`);
  if (!userId) return undefined;
  const data = await env.PVTCH_ACCOUNTS.get<{ id: string; login: string }>(
    `${TWITCH_DATA_PREFIX}${userId}`,
    'json'
  );
  return data ? { id: data.id, login: data.login } : undefined;
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
