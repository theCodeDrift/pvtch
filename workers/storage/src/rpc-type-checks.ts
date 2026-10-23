// Lifted from taskless/taskless `workers/storage/src/rpc-type-checks.ts` (MIT).

/**
 * Compile-time utilities for asserting Durable Object RPC compatibility.
 * Not imported at runtime — checked during `pnpm typecheck`.
 *
 * Usage in index.ts:
 *   type _Check = Expect<AssertRPCSerializable<MyDurableObject>>;
 */

/** Compile-time constraint: T must be `true` or a type error is produced */
export type Expect<_T extends true> = true;

/**
 * Checks if a method's return type (unwrapped from Promise) is Rpc.Serializable.
 * Returns `true` if serializable, or the method name `K` if not — producing
 * a descriptive error: Type '"methodName"' is not assignable to type 'true'.
 */
type CheckMethodReturn<Method, K> = Method extends (...args: never[]) => infer R
  ? (R extends Promise<infer U> ? U : R) extends Rpc.Serializable<
      R extends Promise<infer U> ? U : R
    >
    ? true
    : K
  : true;

/**
 * Resolves to `true` when every RPC-exposed method on a DurableObject subclass
 * returns an Rpc.Serializable type (or Promise thereof).
 *
 * Strips DurableObject base members (lifecycle methods, ctx, env, brand),
 * then checks each remaining method's return type.
 *
 * If any method returns a non-serializable type, the result includes the
 * method name as a string literal, which fails the Expect<> constraint:
 *   Type '"methodName"' is not assignable to type 'true'.
 */
export type AssertRPCSerializable<T> = {
  [K in keyof Omit<T, keyof DurableObject>]: CheckMethodReturn<T[K], K>;
}[keyof Omit<T, keyof DurableObject>];
