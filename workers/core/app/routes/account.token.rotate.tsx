import { data } from 'react-router';
import type { Route } from './+types/account.token.rotate';
import { cloudflareEnvironmentContext, userContext } from '@/context';
import { importLegacyLingoConfig } from '@/lib/lingo-legacy';
import { SESSION_COOKIE, readCookie } from '@/lib/session-cookie';
import type { TwitchUserData } from '@/lib/twitch-data';
import { authMiddleware } from '@/middleware/auth';
import {
  SESSION_PREFIX,
  SESSION_TTL_SECONDS,
  type SessionRecord,
} from '@pvtch/shared/session';

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

/**
 * POST /account/token/rotate: replace the signed-in user's overlay token.
 * Overlay and API URLs with the old token stop working, and so do the
 * user's other sessions; this request's session is re-issued against the
 * new token so the user stays signed in here.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return data({ error: 'Method not allowed' }, { status: 405 });
  }
  const user = context.get(userContext);
  if (!user) {
    return data({ error: 'Sign in to rotate your key' }, { status: 401 });
  }

  const env = context.get(cloudflareEnvironmentContext);

  // Lingo config not yet migrated still lives under the old token. Move it
  // first; if that fails, keep the old token so the config stays reachable.
  try {
    await importLegacyLingoConfig(env, user.id, user.token);
  } catch (error) {
    console.error('lingo migration before token rotation failed:', error);
    return data(
      {
        error: 'Could not move your Lingo settings. Your key was not changed.',
      },
      { status: 500 }
    );
  }

  let account: TwitchUserData;
  try {
    ({ account } = await env.PVTCH_USER.get(
      env.PVTCH_USER.idFromName(`twitch:${user.id}`)
    ).rotateAccountToken(user.id));
  } catch (error) {
    console.error('token rotation failed:', error);
    return data(
      { error: 'Could not rotate your key. Try again.' },
      { status: 500 }
    );
  }

  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (sessionToken) {
    const record: SessionRecord = { userId: user.id, token: account.token };
    await env.PVTCH_ACCOUNTS.put(
      `${SESSION_PREFIX}${sessionToken}`,
      JSON.stringify(record),
      { expirationTtl: SESSION_TTL_SECONDS }
    );
  }

  return data({ ok: true as const });
}
