import type { Route } from './+types/logout';
import { cloudflareEnvironmentContext } from '@/context';
import { clearedSessionCookies } from '@/lib/session-cookie';

/**
 * POST /auth/logout: clears the login cookies. The session cookie is
 * HttpOnly, so page scripts can't remove it themselves.
 */
export function action({ context }: Route.ActionArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  const headers = new Headers();
  for (const cookie of clearedSessionCookies(env)) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(undefined, { status: 204, headers });
}
