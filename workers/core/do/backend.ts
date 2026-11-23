import { DurableObject } from 'cloudflare:workers';

type TTLStrategy = 'PRESERVE_ON_UPDATE' | 'PRESERVE_ON_FETCH';
export type TTLOptions = {
  strategy: TTLStrategy;
  ttlMs: number;
};

// slightly longer than 24h
const TTL = 25 * 60 * 60 * 1000;

// max storage size is 5kb
const MAX_STORAGE_SIZE = 5 * 1024;

/**
 * A generic key-value store with TTL support using Cloudflare Durable Objects.
 * This is a reusable durable object when we are in need of a simple key-value store with TTL,
 * but also cannot rely on Workers KV for some reason (e.g., needing strong consistency).
 *
 * The `set` method allows storing a string value with an optional TTL and strategy.
 * The `get` method retrieves the stored value, updating the expiration based on the strategy.
 * The `alarm` method is used to clean up expired data.
 *
 * Strategies:
 * - `PRESERVE_ON_UPDATE`: The TTL is reset only when the value is updated.
 * - `PRESERVE_ON_FETCH`: The TTL is reset every time the value is fetched.
 *
 * Note: The maximum size for the stored value is 5KB to prevent abuse.
 */
export class PvtchBackend extends DurableObject<Env> {
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(context: DurableObjectState, environment: Env) {
    super(context, environment);
  }

  async set(value: string, options?: TTLOptions): Promise<void> {
    // value cannot exceed max storage size
    if (value.length > MAX_STORAGE_SIZE) {
      throw new Error(
        `Value exceeds max storage size of ${MAX_STORAGE_SIZE} bytes`
      );
    }

    const ttl = options?.ttlMs ?? TTL;
    const strategy = options?.strategy ?? 'PRESERVE_ON_UPDATE';

    await this.ctx.storage.put('strategy', strategy);
    await this.ctx.storage.put('ttl', ttl);

    const exp = Date.now() + ttl;
    await this.ctx.storage.put('data', value);
    await this.ctx.storage.put('exp', exp);
    await this.ctx.storage.deleteAlarm(); // best effort
    await this.ctx.storage.setAlarm(exp);
  }

  async get(): Promise<string> {
    const strategy =
      (await this.ctx.storage.get<TTLStrategy>('strategy')) ??
      'PRESERVE_ON_UPDATE';

    if (strategy === 'PRESERVE_ON_FETCH') {
      const ttl = (await this.ctx.storage.get<number>('ttl')) ?? TTL;
      const exp = Date.now() + ttl;
      await this.ctx.storage.put('exp', exp);
      await this.ctx.storage.deleteAlarm(); // best effort
      await this.ctx.storage.setAlarm(exp);
    }

    const value = (await this.ctx.storage.get<string>('data')) ?? '';
    return value;
  }

  /** Delete the stored value and its expiry. Safe on an empty instance. */
  async clear(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const expires = await this.ctx.storage.get<number>('exp');
    if (expires && expires < Date.now()) {
      await this.ctx.storage.deleteAll();
    }
  }
}
