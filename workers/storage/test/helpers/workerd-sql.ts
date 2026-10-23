// Lifted from taskless/taskless `workers/storage/test/helpers/workerd-sql.ts` (MIT).

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker,
} from 'node:worker_threads';
import { afterAll } from 'vitest';

/**
 * A `SqlStorage` backed by workerd's own SQLite, for the storage tests.
 *
 * The Durable Object's SQLite is compiled with Cloudflare's limits and
 * restrictions — a `LIKE` pattern over 50 bytes is refused, for one — which no
 * Node SQLite reproduces, so a query that only works locally used to pass
 * here and fail in production. Each statement instead runs in a real
 * SQLite-backed Durable Object under Miniflare.
 *
 * `SqlStorage.exec` is synchronous and Miniflare is not, so Miniflare lives in
 * a worker thread and each `exec` blocks on `Atomics.wait` until the worker
 * posts its answer. Rows cross as JSON, so a BLOB column does not round-trip,
 * an INTEGER past 2^53 loses precision, and an error arrives as a plain
 * `Error` carrying workerd's message; the storage schema needs none of these.
 */

interface ExecResult {
  rows?: Record<string, SqlStorageValue>[];
  columnNames?: string[];
  rowsRead?: number;
  rowsWritten?: number;
  error?: string;
}

interface Bridge {
  call: (request: Record<string, unknown>, timeoutMs?: number) => ExecResult;
  worker: Worker;
}

let bridge: Bridge | undefined;

/** A cold workerd start is the slow call; a statement answers in about 1ms. */
const READY_TIMEOUT_MS = 60_000;
const EXEC_TIMEOUT_MS = 30_000;

function startBridge(): Bridge {
  const flag = new SharedArrayBuffer(4);
  const signal = new Int32Array(flag);
  const { port1, port2 } = new MessageChannel();
  // A path string rather than a URL: workerd's runtime types shadow Node's
  // `URL`, which `Worker` would otherwise reject.
  const worker = new Worker(
    path.join(import.meta.dirname, 'workerd-sql.worker.mjs'),
    { workerData: { port: port2, flag }, transferList: [port2] }
  );
  worker.unref();

  // Bounded, because a blocked thread cannot hear the worker crash: an
  // unanswered call fails the run instead of hanging it.
  const call = (
    request: Record<string, unknown>,
    timeoutMs = EXEC_TIMEOUT_MS
  ): ExecResult => {
    Atomics.store(signal, 0, 0);
    port1.postMessage(request);
    if (Atomics.wait(signal, 0, 0, timeoutMs) === 'timed-out') {
      throw new Error(
        `workerd-sql: the worker did not answer ${String(request.op)} within ${timeoutMs}ms`
      );
    }
    const received = receiveMessageOnPort(port1);
    if (!received) throw new Error('workerd-sql: the worker sent no answer');
    return received.message as ExecResult;
  };

  const ready = call({ op: 'ready' }, READY_TIMEOUT_MS);
  if (ready.error) throw new Error(`workerd-sql: ${ready.error}`);
  return { call, worker };
}

// Registered when a test file imports this module, during collection. A hook
// registered later — from the first `createWorkerdSql()` inside a
// `beforeEach` — is never run, and each file then left its workerd process
// orphaned, until enough piled up that every `exec` failed with "fetch
// failed".
afterAll(async () => {
  if (!bridge) return;
  const { call, worker } = bridge;
  bridge = undefined;
  call({ op: 'dispose' });
  await worker.terminate();
});

function cursorOf<T extends Record<string, SqlStorageValue>>(
  result: ExecResult
): SqlStorageCursor<T> {
  // Rows arrive as JSON; their shape is whatever the query selected, which is
  // what `T` claims, exactly as workerd's own cursor does.
  const rows = (result.rows ?? []) as T[];
  const columnNames = result.columnNames ?? [];
  let index = 0;
  function* remaining(): Generator<T, undefined> {
    while (index < rows.length) yield rows[index++];
  }
  return {
    next: () =>
      index < rows.length
        ? { done: false, value: rows[index++] }
        : { done: true },
    // Both consume the cursor, as workerd's do, so reading one twice fails
    // here as it would in production.
    toArray: () => {
      const rest = rows.slice(index);
      index = rows.length;
      return rest;
    },
    one: () => {
      const rest = rows.slice(index);
      index = rows.length;
      if (rest.length !== 1) {
        throw new Error(
          `Expected exactly one result from SQL query, but got ${rest.length === 0 ? 'no' : 'multiple'} results.`
        );
      }
      return rest[0];
    },
    raw: function* <U extends SqlStorageValue[]>() {
      for (const row of rows) yield columnNames.map((name) => row[name]) as U;
    },
    columnNames,
    rowsRead: result.rowsRead ?? 0,
    rowsWritten: result.rowsWritten ?? 0,
    [Symbol.iterator]: remaining,
  };
}

/**
 * A fresh, empty database in its own Durable Object. Call it per test for
 * isolation; the Miniflare instance behind it is shared by the test file and
 * disposed after it.
 */
export function createWorkerdSql(): SqlStorage {
  bridge ??= startBridge();
  const database = randomUUID();
  const { call } = bridge;
  const exec = <T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): SqlStorageCursor<T> => {
    for (const binding of bindings) {
      if (
        typeof binding === 'bigint' ||
        binding instanceof ArrayBuffer ||
        ArrayBuffer.isView(binding)
      ) {
        throw new TypeError(
          'workerd-sql: bigint and binary bindings do not survive the JSON bridge'
        );
      }
    }
    const result = call({ op: 'exec', database, query, bindings });
    if (result.error !== undefined) throw new Error(result.error);
    return cursorOf<T>(result);
  };
  // Only `exec` is implemented; nothing under test reads `databaseSize` or the
  // `Cursor`/`Statement` constructors.
  return { exec } as SqlStorage;
}
