import { RpcTarget } from 'cloudflare:workers';

/** How long a message key is remembered. */
export const MESSAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/** The oldest keys go first past this, so a flood can't grow memory. */
export const MESSAGE_CACHE_MAX_KEYS = 10_000;

/**
 * Recently seen message keys, reached through `channel.messageCache()`.
 *
 * Memory only, on purpose: nothing is stored, and when the object is evicted
 * the cache starts empty, so the worst case is one repeat getting through.
 * A Map keeps insertion order and every key lives the same time, so the
 * oldest key is always the next to expire.
 */
export class MessageCache extends RpcTarget {
  private expiries = new Map<string, number>();

  /** True the first time a key is seen within the window, false for every
   * repeat. A repeat doesn't extend the window. */
  firstSeen(key: string): boolean {
    const now = Date.now();
    this.prune(now);
    if (this.expiries.has(key)) return false;

    this.expiries.set(key, now + MESSAGE_CACHE_TTL_MS);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.expiries) {
      if (expiresAt > now && this.expiries.size < MESSAGE_CACHE_MAX_KEYS) {
        return;
      }
      this.expiries.delete(key);
    }
  }
}
