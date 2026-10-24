export type TwitchUserData = {
  id: string;
  login: string;
  display_name: string;
  token: string; // generated string unique to the user. "secret"
  // Twitch scopes granted through /auth/grant (login itself grants none).
  // Cleared when the user revokes pvtch on Twitch.
  scopes?: string[];
};

export const twitchDataKeyPrefix = 'twitch-data-';

// reverse maps a token to a Twitch user ID
export type TokenData = string; // Twitch user ID

export const tokenDataKeyPrefix = 'token-data-';

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

export const isValidToken = async (
  token: string | undefined,
  environment: Env
) => {
  if (environment.DEV_TWITCH_USER_ID) {
    return environment.DEV_TWITCH_USER_ID;
  }

  if (!token) return;

  const tokenKey = `${tokenDataKeyPrefix}${token}`;
  const tokenLookup = await environment.PVTCH_ACCOUNTS.get<TokenData>(tokenKey);

  return tokenLookup ?? undefined;
};
