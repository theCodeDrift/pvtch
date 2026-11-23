/**
 * Whether a state-changing request may proceed: its `Origin` is missing or
 * is the app's own. `fetch` and form posts from the app always send one, and
 * a cross-site form can't omit it, so a missing header is not a cross-site
 * request. The session cookie reaches every *.pvtch.com site, so anything
 * else is refused.
 */
export function isAppOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(env.PVTCH_APP_URL).origin;
}
