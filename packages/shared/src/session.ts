import { z } from 'zod';

/**
 * Login sessions. The `pvtch_token` cookie holds a session token, stored as
 * `session-{sessionToken}` in PVTCH_ACCOUNTS. It is separate from the user's
 * `token`, which is their overlay key and appears in overlay and API URLs,
 * so a leaked overlay URL can't sign anyone in. core and pvtch-twitch both
 * resolve the cookie here.
 */

export const SESSION_PREFIX = 'session-';
export const TWITCH_DATA_PREFIX = 'twitch-data-';

/** 30 days. Fixed, not sliding: users sign in again when it runs out. */
export const SESSION_TTL_SECONDS = 2_592_000;

/** `token` is the user's overlay token when the session was issued. */
export const sessionRecord = z.object({
  userId: z.string(),
  token: z.string(),
});

export type SessionRecord = z.infer<typeof sessionRecord>;

/** `twitch-data-{id}`. Loose, so callers that write it back keep every field. */
export const accountRecord = z.looseObject({
  id: z.string(),
  login: z.string(),
  display_name: z.string(),
  token: z.string(),
  scopes: z.array(z.string()).optional(),
});

export type AccountRecord = z.infer<typeof accountRecord>;

/** A KV namespace, typed structurally because this package has no Workers types. */
interface AccountsReader {
  get(key: string): Promise<string | null>;
}

function parse<T>(schema: z.ZodType<T>, raw: string | null): T | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The account behind a session token, or undefined. A session only counts
 * while the account's overlay token still matches the one it was issued
 * against, so an account deleted and created again doesn't revive old
 * sessions.
 */
export async function resolveSession(
  accounts: AccountsReader,
  sessionToken?: string
): Promise<AccountRecord | undefined> {
  if (!sessionToken) return undefined;
  const session = parse(
    sessionRecord,
    await accounts.get(`${SESSION_PREFIX}${sessionToken}`)
  );
  if (!session) return undefined;
  const account = parse(
    accountRecord,
    await accounts.get(`${TWITCH_DATA_PREFIX}${session.userId}`)
  );
  return account?.token === session.token ? account : undefined;
}
