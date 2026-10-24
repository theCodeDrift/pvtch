/** A Cloudflare Secrets Store binding: an object with an async `get()`. */
interface StoreSecret {
  get(): Promise<string>;
}

/**
 * Read a secret that may be a Secrets Store binding (production) or a plain
 * string (a Worker secret, or a test double). Store bindings aren't strings,
 * so using one directly as a string silently sends "[object Object]".
 */
export async function readSecret(
  secret?: string | StoreSecret
): Promise<string> {
  if (secret === undefined) return '';
  return typeof secret === 'string' ? secret : secret.get();
}
