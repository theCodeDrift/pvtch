/**
 * Signs out through /auth/logout, since the HttpOnly session cookie can't be
 * removed from the page, then reloads so the page renders signed out.
 */
export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
  globalThis.window?.location.reload();
}
