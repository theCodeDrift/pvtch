// Lifted from taskless/taskless `workers/storage/test/helpers/workerd-sql.worker.mjs` (MIT).

// The worker-thread half of `workerd-sql.ts`: owns a Miniflare instance whose
// one Durable Object runs each statement on workerd's own SQLite, and answers
// the main thread through the port it was handed, waking it with Atomics.
//
// Each database is reached over one WebSocket to its Durable Object. A
// `dispatchFetch` per statement opened a TCP connection per statement, and a
// few runs back to back left enough sockets in TIME_WAIT to exhaust the
// ephemeral ports ("connect EADDRNOTAVAIL").
import { workerData } from 'node:worker_threads';
import { Miniflare } from 'miniflare';

const script = `
export class SqlHost {
  constructor(state) {
    this.sql = state.storage.sql;
  }
  run({ query, bindings }) {
    try {
      const cursor = this.sql.exec(query, ...bindings);
      const rows = cursor.toArray();
      return {
        rows,
        columnNames: cursor.columnNames,
        rowsRead: cursor.rowsRead,
        rowsWritten: cursor.rowsWritten,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
  fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener('message', (event) => {
      // Every message is answered, or the main thread waits out its timeout.
      let answer;
      try {
        answer = JSON.stringify(this.run(JSON.parse(event.data)));
      } catch (error) {
        answer = JSON.stringify({ error: error.message });
      }
      server.send(answer);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
export default {
  fetch(request, env) {
    const name = new URL(request.url).searchParams.get('db');
    return env.SQL_HOST.get(env.SQL_HOST.idFromName(name)).fetch(request);
  },
};
`;

const { port, flag } = workerData;
const signal = new Int32Array(flag);
const miniflare = new Miniflare({
  modules: true,
  script,
  compatibilityDate: '2025-01-01',
  durableObjects: { SQL_HOST: { className: 'SqlHost', useSQLite: true } },
});

/** One open socket per database; statements on it are answered in order. */
const sockets = new Map();

async function socketFor(database) {
  const open = sockets.get(database);
  if (open) return open;
  const response = await miniflare.dispatchFetch(
    `http://sql/?db=${encodeURIComponent(database)}`,
    { headers: { Upgrade: 'websocket' } }
  );
  const socket = response.webSocket;
  if (!socket) throw new Error(`no WebSocket (HTTP ${response.status})`);
  socket.accept();
  const entry = { socket, waiting: [] };
  socket.addEventListener('message', (event) => {
    entry.waiting.shift()?.(JSON.parse(event.data));
  });
  // A closed socket answers nothing: fail what waits on it, and forget it so
  // the next statement opens a fresh one.
  const fail = () => {
    if (sockets.get(database) === entry) sockets.delete(database);
    for (const resolve of entry.waiting.splice(0)) {
      resolve({ error: 'socket closed' });
    }
  };
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  sockets.set(database, entry);
  return entry;
}

async function exec({ database, query, bindings }) {
  const entry = await socketFor(database);
  return new Promise((resolve) => {
    entry.waiting.push(resolve);
    entry.socket.send(JSON.stringify({ query, bindings }));
  });
}

function reply(message) {
  port.postMessage(message);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}

port.on('message', async (request) => {
  try {
    switch (request.op) {
      case 'ready': {
        await miniflare.ready;
        reply({ ok: true });
        break;
      }
      case 'exec': {
        reply(await exec(request));
        break;
      }
      case 'dispose': {
        for (const { socket } of sockets.values()) socket.close();
        sockets.clear();
        await miniflare.dispose();
        reply({ ok: true });
        break;
      }
      default: {
        // The main thread is blocked until something answers.
        reply({ error: `unknown op: ${request.op}` });
      }
    }
  } catch (error) {
    const cause =
      error instanceof Error && error.cause ? ` (${String(error.cause)})` : '';
    reply({
      error: `${error instanceof Error ? error.message : String(error)}${cause}`,
    });
  }
});
