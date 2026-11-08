import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Board } from '../../do/plugins/board';
import {
  MAX_BOARDS_PER_USER,
  MAX_CONTENT_BYTES,
  MAX_HISTORY_PER_BOARD,
} from '../../app/lib/board-constants';

// Ported from e2e/board-plugin.test.ts. The original used getPlatformProxy,
// which can't actually invoke DO RPC methods in this wrangler/miniflare
// version (workerd reports `no such actor class`). The Board plugin is pure
// SQL with no platform dependencies, so we drive it directly against an
// in-memory SQLite via the shim.

function createSqlStorage(database: Database.Database): SqlStorage {
  const exec = (query: string, ...bindings: unknown[]) => {
    const stmt = database.prepare(query);
    let rows: Record<string, unknown>[] = [];
    try {
      rows = stmt.all(...bindings) as Record<string, unknown>[];
    } catch {
      stmt.run(...bindings);
    }
    return {
      toArray: () => rows,
      [Symbol.iterator]: () => rows[Symbol.iterator](),
      raw: () => ({ [Symbol.iterator]: () => [][Symbol.iterator]() }),
      columnNames: [],
      rowsRead: rows.length,
      rowsWritten: 0,
    };
  };
  return { exec } as unknown as SqlStorage;
}

let database: Database.Database;
let board: Board;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  database = new Database(':memory:');
  board = new Board(createSqlStorage(database));
});

afterEach(() => {
  vi.useRealTimers();
  database.close();
});

describe('board plugin: create + read + save', () => {
  it('creates a board, saves content, and reads it back', async () => {
    const created = board.create('My board');
    if ('error' in created) throw new Error('create failed');

    const initial = board.read(created.slotId);
    expect(initial?.content).toBe('');
    expect(initial?.version).toBe(0);
    expect(initial?.name).toBe('My board');

    const saved = await board.save(
      created.slotId,
      created.editKey,
      '# Hello',
      0,
      'Tester'
    );
    if ('error' in saved) throw new Error('save failed');
    expect(saved.version).toBe(1);

    const after = board.read(created.slotId);
    expect(after?.content).toBe('# Hello');
    expect(after?.version).toBe(1);
  });

  it('uses default name when create() called without one', () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');
    const read = board.read(created.slotId);
    expect(read?.name).toBe('Untitled');
  });
});

describe('board plugin: optimistic concurrency', () => {
  it('rejects a save with a stale baseVersion (409)', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    await board.save(created.slotId, created.editKey, 'first', 0, 'AliceA');

    const result = await board.save(
      created.slotId,
      created.editKey,
      'second',
      0,
      'BobB'
    );
    if (!('error' in result)) throw new Error('expected conflict');
    expect(result.error).toBe('conflict');
    if (result.error === 'conflict') {
      expect(result.currentVersion).toBe(1);
      expect(result.currentContent).toBe('first');
    }
  });

  it('lets only one of two interleaved saves on the same baseVersion win', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    // Both saves pass the version check before either reaches the UPDATE,
    // because save awaits the content hash in between.
    const [first, second] = await Promise.all([
      board.save(created.slotId, created.editKey, 'alice', 0, 'AliceA'),
      board.save(created.slotId, created.editKey, 'bob', 0, 'BobB'),
    ]);

    expect(first).toEqual({ version: 1 });
    expect(second).toEqual({
      error: 'conflict',
      currentContent: 'alice',
      currentVersion: 1,
    });

    expect(board.read(created.slotId)?.content).toBe('alice');
    const history = board.getHistory(created.slotId, created.editKey);
    if ('error' in history) throw new Error('history error');
    expect(history.map((entry) => entry.editorName)).toEqual(['AliceA']);
  });
});

describe('board plugin: edit key check', () => {
  it('returns forbidden for a wrong edit key on save', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const result = await board.save(
      created.slotId,
      'wrong-edit-key',
      'content',
      0,
      'Eve'
    );
    if (!('error' in result)) throw new Error('expected forbidden');
    expect(result.error).toBe('forbidden');
  });

  it('returns forbidden for a wrong edit key on readForEdit', () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const result = board.readForEdit(created.slotId, 'wrong');
    if (!('error' in result)) throw new Error('expected forbidden');
    expect(result.error).toBe('forbidden');
  });

  it('returns not_found for an unknown slotId', () => {
    const result = board.readForEdit('does-not-exist', 'k');
    if (!('error' in result)) throw new Error('expected not_found');
    expect(result.error).toBe('not_found');
  });
});

describe('board plugin: 5-board cap', () => {
  it('enforces MAX_BOARDS_PER_USER on create', () => {
    for (let i = 0; i < MAX_BOARDS_PER_USER; i++) {
      const r = board.create(`Board ${i}`);
      expect('error' in r).toBe(false);
    }
    const overflow = board.create('one too many');
    if (!('error' in overflow)) throw new Error('expected cap_reached');
    expect(overflow.error).toBe('cap_reached');
  });
});

describe('board plugin: history and revert', () => {
  it('appends a new history entry on revert (does not rewrite existing)', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    // Three saves at distinct timestamps so history ordering is deterministic.
    await board.save(created.slotId, created.editKey, 'v1', 0, 'A');
    vi.setSystemTime(new Date('2026-01-15T12:00:01Z'));
    await board.save(created.slotId, created.editKey, 'v2', 1, 'A');
    vi.setSystemTime(new Date('2026-01-15T12:00:02Z'));
    await board.save(created.slotId, created.editKey, 'v3', 2, 'A');

    const historyBefore = board.getHistory(created.slotId, created.editKey);
    if ('error' in historyBefore) throw new Error('history error');
    expect(historyBefore.length).toBe(3);

    const oldest = historyBefore.at(-1);
    if (!oldest) throw new Error('expected oldest history entry');
    vi.setSystemTime(new Date('2026-01-15T12:00:03Z'));
    const revertResult = await board.revert(
      created.slotId,
      created.editKey,
      oldest.id,
      3,
      'A'
    );
    expect(revertResult).toEqual({ version: 4, content: 'v1' });

    const historyAfter = board.getHistory(created.slotId, created.editKey);
    if ('error' in historyAfter) throw new Error('history error');
    expect(historyAfter.length).toBe(4);
    const existingIds = new Set(historyBefore.map((h) => h.id));
    const stillThere = historyAfter.filter((h) => existingIds.has(h.id));
    expect(stillThere.length).toBe(3);

    const after = board.read(created.slotId);
    expect(after?.content).toBe('v1');
    expect(after?.version).toBe(4);
  });

  it('trims history to MAX_HISTORY_PER_BOARD most recent entries', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    for (let v = 0; v < MAX_HISTORY_PER_BOARD + 2; v++) {
      // Advance the clock so history rows have monotonically increasing ts.
      vi.setSystemTime(
        new Date(`2026-01-15T12:00:${String(v).padStart(2, '0')}Z`)
      );
      await board.save(created.slotId, created.editKey, `v${v + 1}`, v, 'A');
    }

    const history = board.getHistory(created.slotId, created.editKey);
    if ('error' in history) throw new Error('history error');
    expect(history.length).toBe(MAX_HISTORY_PER_BOARD);
    const newest = history[0];
    const oldest = history.at(-1);
    if (!newest || !oldest) throw new Error('expected history entries');
    expect(newest.ts).toBeGreaterThanOrEqual(oldest.ts);
  });

  it('getHistoryEntry returns the full content for a known id', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');
    await board.save(created.slotId, created.editKey, 'body', 0, 'A');

    const list = board.getHistory(created.slotId, created.editKey);
    if ('error' in list) throw new Error('history error');
    const entry = list[0];
    if (!entry) throw new Error('expected entry');

    const full = board.getHistoryEntry(
      created.slotId,
      created.editKey,
      entry.id
    );
    if ('error' in full) throw new Error('expected entry');
    expect(full.content).toBe('body');
  });
});

describe('board plugin: rotate edit key', () => {
  it('invalidates the prior edit key', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const rotated = board.rotateEditKey(created.slotId);
    if ('error' in rotated) throw new Error('rotate failed');
    expect(rotated.editKey).not.toBe(created.editKey);

    const oldKeyResult = await board.save(
      created.slotId,
      created.editKey,
      'should fail',
      0,
      'A'
    );
    if (!('error' in oldKeyResult)) throw new Error('expected forbidden');
    expect(oldKeyResult.error).toBe('forbidden');

    const newKeyResult = await board.save(
      created.slotId,
      rotated.editKey,
      'works',
      0,
      'A'
    );
    expect('error' in newKeyResult).toBe(false);
  });
});

describe('board plugin: presence', () => {
  it('records and returns active sessions', () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    board.heartbeat(created.slotId, created.editKey, 'session-1', 'Alice');
    board.heartbeat(created.slotId, created.editKey, 'session-2', 'Bob');

    const presence = board.getPresence(created.slotId);
    expect(presence.length).toBe(2);
    const names = new Set(presence.map((p) => p.name));
    expect(names).toEqual(new Set(['Alice', 'Bob']));
  });

  it('rejects heartbeat with wrong edit key', () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const result = board.heartbeat(created.slotId, 'wrong-key', 's1', 'A');
    if (!('error' in result)) throw new Error('expected forbidden');
    expect(result.error).toBe('forbidden');
  });
});

describe('board plugin: rename', () => {
  it('updates the board name and bumps updated_at', () => {
    const created = board.create('Original');
    if ('error' in created) throw new Error('create failed');

    const result = board.rename(created.slotId, 'Renamed');
    expect('error' in result).toBe(false);

    const read = board.read(created.slotId);
    expect(read?.name).toBe('Renamed');
  });

  it('rejects an empty name as bad_request', () => {
    const created = board.create('Original');
    if ('error' in created) throw new Error('create failed');

    const result = board.rename(created.slotId, '   ');
    if (!('error' in result)) throw new Error('expected bad_request');
    expect(result.error).toBe('bad_request');
  });

  it('returns not_found for an unknown slotId', () => {
    const result = board.rename('does-not-exist', 'whatever');
    if (!('error' in result)) throw new Error('expected not_found');
    expect(result.error).toBe('not_found');
  });
});

describe('board plugin: delete', () => {
  it('removes the board and history; subsequent reads return undefined', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    await board.save(created.slotId, created.editKey, 'content', 0, 'A');

    const result = board.delete(created.slotId);
    expect(result.ok).toBe(true);

    const read = board.read(created.slotId);
    expect(read).toBeUndefined();

    const history = board.getHistory(created.slotId, created.editKey);
    expect('error' in history).toBe(true);
  });
});

describe('board plugin: size limit', () => {
  it('rejects saves over MAX_CONTENT_BYTES', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const tooLarge = 'x'.repeat(MAX_CONTENT_BYTES + 1);
    const result = await board.save(
      created.slotId,
      created.editKey,
      tooLarge,
      0,
      'A'
    );
    if (!('error' in result)) throw new Error('expected too_large');
    expect(result.error).toBe('too_large');
  });

  it('accepts saves at exactly MAX_CONTENT_BYTES', async () => {
    const created = board.create();
    if ('error' in created) throw new Error('create failed');

    const exact = 'x'.repeat(MAX_CONTENT_BYTES);
    const result = await board.save(
      created.slotId,
      created.editKey,
      exact,
      0,
      'A'
    );
    expect('error' in result).toBe(false);
  });
});
