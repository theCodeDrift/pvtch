/**
 * Login cookies. `pvtch_token` is the session and is HttpOnly so page scripts
 * can't read it; `pvtch_name` is only the display name, readable so the
 * header can show who is signed in. Both sit on `Domain=pvtch.com` so
 * twitch.pvtch.com gets them too, except on localhost.
 */
function attributes(env: Env): string {
  const host = new URL(env.PVTCH_APP_URL).hostname;
  return host === 'localhost'
    ? 'Path=/; SameSite=Lax'
    : 'Path=/; SameSite=Lax; Domain=pvtch.com; Secure';
}

export function sessionCookies(
  env: Env,
  token: string,
  displayName: string
): string[] {
  const base = attributes(env);
  return [
    `pvtch_token=${token}; ${base}; HttpOnly`,
    `pvtch_name=${encodeURIComponent(displayName)}; ${base}`,
  ];
}

/** Expires both login cookies, with the attributes they were set with. */
export function clearedSessionCookies(env: Env): string[] {
  const base = attributes(env);
  return [
    `pvtch_token=; ${base}; HttpOnly; Max-Age=0`,
    `pvtch_name=; ${base}; Max-Age=0`,
  ];
}
