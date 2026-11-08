/**
 * The account record in PVTCH_ACCOUNTS and its keys. Kept free of app and
 * Env-specific imports: the User Durable Object depends on it, and
 * pvtch-twitch type-checks that DO through its PVTCH_USER binding.
 */

export type TwitchUserData = {
  id: string;
  login: string;
  display_name: string;
  // The overlay key: generated once, unique to the user, and part of their
  // overlay and API URLs. Not a login; sessions live in `session-` records.
  token: string;
  // Twitch scopes granted through /auth/grant (login itself grants none).
  // Cleared when the user revokes pvtch on Twitch.
  scopes?: string[];
};

export const twitchDataKeyPrefix = 'twitch-data-';

// reverse maps a token to a Twitch user ID
export type TokenData = string; // Twitch user ID

export const tokenDataKeyPrefix = 'token-data-';
