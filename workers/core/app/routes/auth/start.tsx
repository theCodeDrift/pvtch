import type { Route } from './+types/start';
import { cloudflareEnvironmentContext } from '@/context';
import { createToken } from '@/lib/create-token';
import { loginStateCookie } from '@/lib/session-cookie';

export function loader({ context }: Route.LoaderArgs) {
  const env = context.get(cloudflareEnvironmentContext);

  // checked by /auth/callback, so nobody can finish a login in your browser
  const state = createToken();

  const u = new URL('https://id.twitch.tv/oauth2/authorize');
  u.searchParams.set('client_id', env.TWITCH_CLIENT_ID ?? '');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set(
    'redirect_uri',
    env.TWITCH_REDIRECT_URI ?? 'http://localhost:5173/auth/callback'
  );
  u.searchParams.set('scope', '');
  u.searchParams.set('state', state);

  const headers = new Headers({ Location: u.toString() });
  headers.append('Set-Cookie', loginStateCookie(env, state));
  return new Response(undefined, { status: 302, headers });
}
