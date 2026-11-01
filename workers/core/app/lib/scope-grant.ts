import { readSecret } from '@pvtch/shared/secrets';
import { z } from 'zod';
import { readCookie } from '@/lib/session-cookie';
import {
  sessionUser,
  twitchDataKeyPrefix,
  type TwitchUserData,
} from '@/lib/twitch-data';

/**
 * The one place pvtch asks a user for extra Twitch scopes. The user
 * authorizes pvtch as a whole, not a single feature: features check the
 * scopes recorded on `twitch-data-{userId}` and send the user here for any
 * that are missing. Login itself stays scope-free.
 */

/** Scopes a feature may request. Anything else is refused. */
export const GRANTABLE_SCOPES: ReadonlySet<string> = new Set(['channel:bot']);

export const GRANT_STATE_COOKIE = 'pvtch_grant';
const GRANT_STATE_MAX_AGE_SECONDS = 600;

const grantState = z.object({ state: z.string(), returnTo: z.string() });
const tokenResponse = z.object({
  access_token: z.string(),
  scope: z.array(z.string()).default([]),
});
const usersResponse = z.object({ data: z.array(z.object({ id: z.string() })) });

export function parseScopes(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)
    ),
  ];
}

/** Same-origin relative paths only, so the grant can't be an open redirect. */
export function isSafeReturnTo(path: string | null): path is string {
  if (!path?.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\\')) return false;
  const base = 'https://pvtch.invalid';
  return new URL(path, base).origin === base;
}

function appUrl(env: Env): string {
  return env.PVTCH_APP_URL || 'http://localhost:5173';
}

function callbackUrl(env: Env): string {
  return `${appUrl(env)}/auth/grant/callback`;
}

function stateCookie(env: Env, value: string, maxAge: number): string {
  const secure =
    new URL(appUrl(env)).hostname === 'localhost' ? '' : 'Secure; ';
  return `${GRANT_STATE_COOKIE}=${value}; Path=/auth/grant; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(undefined, { status: 302, headers });
}

/** The grant state cookie, or undefined if it is missing or malformed. */
function readGrantState(
  request: Request
): z.infer<typeof grantState> | undefined {
  const raw = readCookie(request, GRANT_STATE_COOKIE);
  if (!raw) return undefined;
  try {
    const parsed = grantState.safeParse(JSON.parse(decodeURIComponent(raw)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** `returnTo` with one more query parameter, keeping any it already has. */
function withParameter(returnTo: string, key: string, value: string): string {
  const url = new URL(returnTo, 'https://pvtch.invalid');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The scopes already recorded for a user. */
export function recordedScopes(user: TwitchUserData | undefined): string[] {
  return user?.scopes ?? [];
}

/**
 * GET /auth/grant?scopes=…&return_to=…: send the user to Twitch for the
 * requested scopes plus every scope already recorded, so a grant for one
 * feature never narrows what another relies on.
 */
export async function startGrant(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const requested = parseScopes(url.searchParams.get('scopes'));
  const returnTo = url.searchParams.get('return_to');

  if (requested.length === 0 || !isSafeReturnTo(returnTo)) {
    return new Response('Bad grant request', { status: 400 });
  }
  if (!requested.every((scope) => GRANTABLE_SCOPES.has(scope))) {
    return new Response('Scope not grantable', { status: 400 });
  }

  const user = await sessionUser(request, env);
  if (!user) return redirect('/auth/start');

  const scopes = [...new Set([...recordedScopes(user), ...requested])];
  const state = crypto.randomUUID();
  const authorize = new URL('https://id.twitch.tv/oauth2/authorize');
  authorize.search = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: callbackUrl(env),
    scope: scopes.join(' '),
    state,
  }).toString();

  const cookieValue = encodeURIComponent(JSON.stringify({ state, returnTo }));
  return redirect(
    authorize.toString(),
    stateCookie(env, cookieValue, GRANT_STATE_MAX_AGE_SECONDS)
  );
}

/**
 * GET /auth/grant/callback: confirm the approving Twitch account is the
 * logged-in user, record the granted scopes, and discard the tokens. Twitch
 * keeps the grant; pvtch stores no user tokens.
 */
export async function completeGrant(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const parsed = readGrantState(request);
  const state = url.searchParams.get('state');
  if (!parsed || !state || parsed.state !== state) {
    return new Response('Grant state mismatch', { status: 400 });
  }
  const { returnTo } = parsed;
  const clear = stateCookie(env, '', 0);

  const error = url.searchParams.get('error');
  if (error) {
    return redirect(withParameter(returnTo, 'grant_error', error), clear);
  }
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });

  const user = await sessionUser(request, env);
  if (!user) return redirect('/auth/start', clear);

  const exchange = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: await readSecret(env.TWITCH_SECRET),
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(env),
    }).toString(),
  });
  if (!exchange.ok) {
    return redirect(
      withParameter(returnTo, 'grant_error', 'exchange_failed'),
      clear
    );
  }
  const token = tokenResponse.parse(await exchange.json());

  const users = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
    },
  });
  const approvingId = users.ok
    ? usersResponse.parse(await users.json()).data[0]?.id
    : undefined;
  if (approvingId !== user.id) {
    return redirect(
      withParameter(returnTo, 'grant_error', 'account_mismatch'),
      clear
    );
  }

  const updated: TwitchUserData = { ...user, scopes: token.scope };
  await env.PVTCH_ACCOUNTS.put(
    `${twitchDataKeyPrefix}${user.id}`,
    JSON.stringify(updated)
  );

  return redirect(
    withParameter(returnTo, 'granted', token.scope.join(' ')),
    clear
  );
}
