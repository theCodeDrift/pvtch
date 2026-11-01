import { SESSION_PREFIX } from '@pvtch/shared/session';
import type { Route } from './+types/logout';
import { cloudflareEnvironmentContext } from '@/context';
import {
  SESSION_COOKIE,
  clearedSessionCookies,
  readCookie,
} from '@/lib/session-cookie';

/**
 * POST /auth/logout: deletes the session and clears the login cookies. The
 * session cookie is HttpOnly, so page scripts can't remove it themselves.
 * The cookie reaches every *.pvtch.com site, so a request from another
 * origin is refused rather than signing the user out.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(cloudflareEnvironmentContext);

  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(env.PVTCH_APP_URL).origin) {
    return new Response('Forbidden', { status: 403 });
  }

  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (sessionToken) {
    await env.PVTCH_ACCOUNTS.delete(`${SESSION_PREFIX}${sessionToken}`);
  }

  const headers = new Headers();
  for (const cookie of clearedSessionCookies(env)) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(undefined, { status: 204, headers });
}
