// Compile-time only, and only in storage's own typecheck: binders include
// ../storage/src in their programs, where the global Env is theirs, so this
// assertion can't live under src/.
import type { Expect } from '../src/rpc-type-checks';
import type { StorageEnv } from '../src/storage-env';

// Storage's generated Env provides every binding its DOs use.
export type AssertStorageEnv = Expect<Env extends StorageEnv ? true : false>;
