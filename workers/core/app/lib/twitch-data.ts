import { resolveSession } from '@pvtch/shared/session';
import { SESSION_COOKIE, isLocalhost, readCookie } from '@/lib/session-cookie';
import {
  tokenDataKeyPrefix,
  twitchDataKeyPrefix,
  type TokenData,
  type TwitchUserData,
} from '@/lib/account-record';

export const DEV_TOKEN = 'dev';

/**
 * Resolve a token to the full user context: userId, displayName, and login.
 * Chains two KV lookups: token→userId, then userId→TwitchUserData.
 */
export const resolveTokenUser = async (
  token: string | undefined,
  environment: Env
): Promise<
  { userId: string; displayName?: string; login?: string } | undefined
> => {
  const userId = await isValidToken(token, environment);
  if (!userId) return undefined;

  const userData = await environment.PVTCH_ACCOUNTS.get<TwitchUserData>(
    `${twitchDataKeyPrefix}${userId}`,
    'json'
  );

  return {
    userId,
    displayName: userData?.display_name,
    login: userData?.login,
  };
};

/**
 * `DEV_TWITCH_USER_ID`, when set and the app runs on localhost. Every
 * request then acts as that user. Ignored anywhere else.
 */
export const devUserId = (environment: Env): string | undefined =>
  environment.DEV_TWITCH_USER_ID && isLocalhost(environment)
    ? environment.DEV_TWITCH_USER_ID
    : undefined;

/**
 * The signed-in user: the localhost dev user, or the account behind the
 * session in the `pvtch_token` cookie.
 */
export const sessionUser = async (
  request: Request,
  environment: Env
): Promise<TwitchUserData | undefined> => {
  const developer = devUserId(environment);
  if (!developer) {
    return resolveSession(
      environment.PVTCH_ACCOUNTS,
      readCookie(request, SESSION_COOKIE)
    );
  }
  const data = await environment.PVTCH_ACCOUNTS.get<TwitchUserData>(
    `${twitchDataKeyPrefix}${developer}`,
    'json'
  );
  return data ?? undefined;
};

/**
 * Resolve the overlay token in an overlay or API URL to a Twitch user ID.
 * Never use it for the `pvtch_token` cookie, which holds a session token.
 */
export const isValidToken = async (
  token: string | undefined,
  environment: Env
) => {
  const developer = devUserId(environment);
  if (developer) return developer;

  if (!token) return;

  const tokenKey = `${tokenDataKeyPrefix}${token}`;
  const tokenLookup = await environment.PVTCH_ACCOUNTS.get<TokenData>(tokenKey);

  return tokenLookup ?? undefined;
};
