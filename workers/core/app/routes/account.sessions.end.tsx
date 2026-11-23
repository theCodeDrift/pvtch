import { data } from 'react-router';
import type { Route } from './+types/account.sessions.end';
import { cloudflareEnvironmentContext, userContext } from '@/context';
import { isAppOrigin } from '@/lib/origin';
import { SESSION_COOKIE, readCookie } from '@/lib/session-cookie';
import { authMiddleware } from '@/middleware/auth';
import {
  SESSION_PREFIX,
  SESSION_TTL_SECONDS,
  newSessionRecord,
} from '@pvtch/shared/session';

export const middleware: Route.MiddlewareFunction[] = [authMiddleware];

/**
 * POST /account/sessions/end: sign out everywhere. Every session issued
 * before now stops resolving; this request's session is re-issued after the
 * cutoff, so the user stays signed in here. Overlay URLs are unaffected.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return data({ error: 'Method not allowed' }, { status: 405 });
  }
  const env = context.get(cloudflareEnvironmentContext);
  if (!isAppOrigin(request, env)) {
    return data({ error: 'Forbidden' }, { status: 403 });
  }
  const user = context.get(userContext);
  if (!user) {
    return data({ error: 'Sign in first' }, { status: 401 });
  }

  let token: string;
  try {
    ({ token } = await env.PVTCH_USER.get(
      env.PVTCH_USER.idFromName(`twitch:${user.id}`)
    ).endAccountSessions(user.id));
  } catch (error) {
    console.error('ending sessions failed:', error);
    return data(
      { error: 'Could not sign out your other browsers. Try again.' },
      { status: 500 }
    );
  }

  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (sessionToken) {
    await env.PVTCH_ACCOUNTS.put(
      `${SESSION_PREFIX}${sessionToken}`,
      JSON.stringify(newSessionRecord(user.id, token)),
      { expirationTtl: SESSION_TTL_SECONDS }
    );
  }

  return data({ ok: true as const });
}
