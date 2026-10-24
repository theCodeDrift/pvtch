/** The Twitch scope Lingual needs from the broadcaster to chat as the bot. */
export const LINGUAL_SCOPE = 'channel:bot';

/**
 * Whether a user can see Bots > Lingual during rollout. Unlike
 * ALLOWED_USERS, an empty LINGUAL_PREVIEW_USERS shows it to no one.
 */
export function canUseLingual(env: Env, login?: string): boolean {
  if (!login) return false;
  const preview = env.LINGUAL_PREVIEW_USERS.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return preview.includes(login.toLowerCase());
}
