import type { User } from '../../core/do/user';

/**
 * The user's account writer: core's `User` Durable Object in pvtch. Every
 * write to an account record goes through it, never straight to
 * PVTCH_ACCOUNTS (KV is its read model).
 *
 * `wrangler types` can only type this binding against core's entry module
 * (cloudflare/handler.ts), which pulls in the React Router app and core's
 * Env, so cf-typegen leaves PVTCH_USER untyped. This narrows it to the real
 * `User` class instead, so the stub's methods still track core's code.
 */
export function accountStub(env: Env, userId: string) {
  const users = env.PVTCH_USER as unknown as DurableObjectNamespace<User>;
  return users.get(users.idFromName(`twitch:${userId}`));
}
