/**
 * The bindings storage's Durable Objects use. Declared here rather than
 * using the global `Env` because binders type-check these sources against
 * their own `Env` (multi-config typegen), which lacks storage-only bindings.
 * `src/index.ts` asserts storage's real `Env` satisfies this.
 */
export interface StorageEnv {
  TWITCH_EVENTS: Queue;
}
