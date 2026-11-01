import { redirect } from 'react-router';
import type { Route } from './+types/callback';
import { cloudflareEnvironmentContext } from '@/context';
import {
  tokenDataKeyPrefix,
  twitchDataKeyPrefix,
  type TwitchUserData,
} from '@/lib/twitch-data';
import { createToken } from '@/lib/create-token';
import {
  LOGIN_STATE_COOKIE,
  SESSION_COOKIE,
  loginStateCookie,
  readCookie,
  sessionCookies,
} from '@/lib/session-cookie';
import { readSecret } from '@pvtch/shared/secrets';
import {
  SESSION_PREFIX,
  SESSION_TTL_SECONDS,
  type SessionRecord,
} from '@pvtch/shared/session';

type TwitchTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string[];
  token_type: 'bearer';
};

type TwitchUserDataResponse = {
  data: {
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    view_count: number;
    created_at: string;
  }[];
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.get(cloudflareEnvironmentContext);
  const response = await completeLogin(request, env);
  response.headers.append('Set-Cookie', loginStateCookie(env, ''));
  return response;
}

/**
 * Start a session for `account`. The request's previous session, if any, is
 * deleted so signing in again on one browser doesn't leave it behind.
 */
async function startSession(
  request: Request,
  env: Env,
  account: TwitchUserData
): Promise<string> {
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) {
    await env.PVTCH_ACCOUNTS.delete(`${SESSION_PREFIX}${previous}`);
  }

  let sessionToken = createToken();
  while (sessionToken === account.token) {
    sessionToken = createToken();
  }
  const record: SessionRecord = { userId: account.id, token: account.token };
  await env.PVTCH_ACCOUNTS.put(
    `${SESSION_PREFIX}${sessionToken}`,
    JSON.stringify(record),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return sessionToken;
}

async function completeLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // the state must be the one /auth/start gave this browser
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, LOGIN_STATE_COOKIE)) {
    return new Response('login state mismatch', { status: 400 });
  }

  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  const code = url.searchParams.get('code');

  // if there is an error, redirect to the pvtch error page
  if (error) {
    const u = new URL(env.PVTCH_APP_URL || 'http://localhost:5173/');
    u.pathname = '/auth/error';
    u.searchParams.set('error', error);
    if (errorDescription) {
      u.searchParams.set('error_description', errorDescription);
    }

    return redirect(u.toString());
  }

  // you shouldn't end up here unless Twitch screws up
  if (!code) {
    return new Response('missing code', { status: 400 });
  }

  const tokenRequestBody = new URLSearchParams();
  tokenRequestBody.set('client_id', env.TWITCH_CLIENT_ID || '');
  tokenRequestBody.set('client_secret', await readSecret(env.TWITCH_SECRET));
  tokenRequestBody.set('code', code);
  tokenRequestBody.set('grant_type', 'authorization_code');
  tokenRequestBody.set(
    'redirect_uri',
    env.TWITCH_REDIRECT_URI || 'http://localhost:5173/auth/callback'
  );

  const codeToTokenRequest = new Request('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: tokenRequestBody.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const tokenResponse = await fetch(codeToTokenRequest);
  if (!tokenResponse.ok) {
    console.error('twitch token exchange failed:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
    });
    return new Response('twitch token exchange failed', { status: 500 });
  }

  const tokenData: TwitchTokenResponse = await tokenResponse.json();

  const userRequest = new Request('https://api.twitch.tv/helix/users', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Client-Id': env.TWITCH_CLIENT_ID || '',
    },
  });

  const userResponse = await fetch(userRequest);
  if (!userResponse.ok) {
    console.error('twitch get user failed:', {
      status: userResponse.status,
      statusText: userResponse.statusText,
    });
    return new Response('twitch get user failed', { status: 500 });
  }

  const userData: TwitchUserDataResponse = await userResponse.json();
  const user = userData.data[0];

  const existing = await env.PVTCH_ACCOUNTS.get<TwitchUserData>(
    `${twitchDataKeyPrefix}${user.id}`,
    'json'
  );

  let account: TwitchUserData;
  if (existing) {
    account = existing;
  } else {
    account = {
      id: user.id,
      login: user.login,
      display_name: user.display_name,
      token: createToken(),
    };
    await env.PVTCH_ACCOUNTS.put(
      `${twitchDataKeyPrefix}${user.id}`,
      JSON.stringify(account)
    );
  }

  await env.PVTCH_ACCOUNTS.put(
    `${tokenDataKeyPrefix}${account.token}`,
    user.id
  );

  const sessionToken = await startSession(request, env, account);

  const appUrl = env.PVTCH_APP_URL || 'http://localhost:5173';
  const headers = new Headers();
  headers.set('Location', `${appUrl}/welcome`);
  for (const cookie of sessionCookies(env, sessionToken, user.display_name)) {
    headers.append('Set-Cookie', cookie);
  }

  return new Response(undefined, { status: 302, headers });
}
