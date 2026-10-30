import { readSecret } from '@pvtch/shared/secrets';
import {
  TWITCH_SENDERS,
  isSenderId,
  type SenderId,
} from '@pvtch/shared/twitch-registry';
import { z } from 'zod';

import { canAuthorizeSender, getSessionUser, readCookie } from '../session';

const BOT_SCOPES = 'user:bot user:read:chat user:write:chat';
const STATE_COOKIE = 'pvtch_bot_state';

const tokenResponse = z.object({ access_token: z.string() });
const usersResponse = z.object({ data: z.array(z.object({ id: z.string() })) });

function redirectUri(env: Env): string {
  return `${env.TWITCH_APP_URL}/bot/callback`;
}

function page(status: number, message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>pvtch bot</title><p>${message}</p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/**
 * GET /bot/authorize?sender=<senderId>: one-time grant of a sender bot
 * account's own scopes. The bot account (or an admin) opens this while
 * logged into Twitch as the bot. Separate from www's /auth/grant because the
 * account authorizing is the bot, not the logged-in pvtch user.
 */
export async function botAuthorize(
  request: Request,
  env: Env
): Promise<Response> {
  const senderId = new URL(request.url).searchParams.get('sender') ?? '';
  if (!isSenderId(senderId)) return new Response(undefined, { status: 400 });
  if (!canAuthorizeSender(env, await getSessionUser(request, env), senderId)) {
    return new Response(undefined, { status: 403 });
  }
  // The state carries the sender through Twitch to the callback.
  const state = `${crypto.randomUUID()}.${senderId}`;
  const authorize = new URL('https://id.twitch.tv/oauth2/authorize');
  authorize.search = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(env),
    scope: BOT_SCOPES,
    state,
    force_verify: 'true',
  }).toString();
  return new Response(undefined, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/bot; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

/** The sender a matching `state` was issued for. */
function senderFromState(state: string): SenderId | undefined {
  const senderId = state.slice(state.indexOf('.') + 1);
  return isSenderId(senderId) ? senderId : undefined;
}

/** GET /bot/callback: confirm the sender's bot account granted its scopes.
 * Tokens are discarded; Twitch records the grant. */
export async function botCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, STATE_COOKIE)) {
    return new Response(undefined, { status: 400 });
  }
  const senderId = senderFromState(state);
  if (!senderId) return new Response(undefined, { status: 400 });
  if (!canAuthorizeSender(env, await getSessionUser(request, env), senderId)) {
    return new Response(undefined, { status: 403 });
  }
  const error = url.searchParams.get('error');
  if (error) return page(200, `Twitch returned: ${error}. Nothing changed.`);
  const code = url.searchParams.get('code');
  if (!code) return new Response(undefined, { status: 400 });

  const exchange = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: await readSecret(env.TWITCH_SECRET),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(env),
    }).toString(),
  });
  if (!exchange.ok) return page(502, 'Twitch token exchange failed.');
  const { access_token } = tokenResponse.parse(await exchange.json());

  const users = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
    },
  });
  if (!users.ok) return page(502, 'Could not read the Twitch account.');
  const authorizedId = usersResponse.parse(await users.json()).data[0]?.id;

  const sender = TWITCH_SENDERS[senderId];
  if (authorizedId !== sender.userId) {
    return page(
      400,
      `That Twitch account is not ${sender.login}. Log into Twitch as ${sender.login} and try again.`
    );
  }
  return page(200, `${sender.login} is authorized. You can close this page.`);
}
