import { redirect } from 'react-router';
import type { Route } from './+types/callback';
import { cloudflareEnvironmentContext } from '@/context';
import {
  tokenDataKeyPrefix,
  twitchDataKeyPrefix,
  type TwitchUserData,
} from '@/lib/twitch-data';
import { createToken } from '@/lib/create-token';
import { sessionCookies } from '@/lib/session-cookie';
import { readSecret } from '@pvtch/shared/secrets';

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
  const url = new URL(request.url);

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

  if (existing) {
    await env.PVTCH_ACCOUNTS.put(
      `${tokenDataKeyPrefix}${existing.token}`,
      user.id
    );
    const appUrl = env.PVTCH_APP_URL || 'http://localhost:5173';
    const headers = new Headers();
    headers.set('Location', `${appUrl}/welcome`);
    for (const cookie of sessionCookies(
      env,
      existing.token,
      user.display_name
    )) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(undefined, { status: 302, headers });
  }

  const twitchTokenData: TwitchUserData = {
    id: userData.data[0].id,
    login: userData.data[0].login,
    display_name: userData.data[0].display_name,
    token: createToken(),
  };

  await env.PVTCH_ACCOUNTS.put(
    `${twitchDataKeyPrefix}${user.id}`,
    JSON.stringify(twitchTokenData)
  );

  await env.PVTCH_ACCOUNTS.put(
    `${tokenDataKeyPrefix}${twitchTokenData.token}`,
    user.id
  );

  const newUserAppUrl = env.PVTCH_APP_URL || 'http://localhost:5173';
  const newHeaders = new Headers();
  newHeaders.set('Location', `${newUserAppUrl}/welcome`);
  for (const cookie of sessionCookies(
    env,
    twitchTokenData.token,
    twitchTokenData.display_name
  )) {
    newHeaders.append('Set-Cookie', cookie);
  }

  return new Response(undefined, { status: 302, headers: newHeaders });
}
