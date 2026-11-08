import { RpcTarget } from 'cloudflare:workers';
import { migrate, type Migrations } from '../helpers/migrate';
import { newSlotId, newEditKey } from '../../app/lib/board-id';
import {
  MAX_BOARDS_PER_USER,
  MAX_BOARD_NAME_LENGTH,
  MAX_CONTENT_BYTES,
  MAX_HISTORY_PER_BOARD,
  MAX_EDITOR_NAME_LENGTH,
  PRESENCE_TTL_MS,
} from '../../app/lib/board-constants';

const boardMigrations: Migrations = {
  1: (sql) => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS boards (
        slot_id TEXT PRIMARY KEY,
        edit_key TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled',
        content TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS board_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        editor_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (slot_id) REFERENCES boards(slot_id) ON DELETE CASCADE
      )
    `);
    sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_board_history_slot_ts
        ON board_history(slot_id, ts DESC)
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS board_presence (
        slot_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (slot_id, session_id)
      )
    `);
    sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_board_presence_seen
        ON board_presence(slot_id, last_seen DESC)
    `);
  },
};

export interface BoardListItem {
  slotId: string;
  name: string;
  updatedAt: number;
  editKey: string;
}

export interface BoardReadResult {
  name: string;
  content: string;
  version: number;
  updatedAt: number;
}

export interface BoardEditResult {
  name: string;
  content: string;
  version: number;
}

export type BoardError =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'too_large' }
  | { error: 'cap_reached' }
  | { error: 'bad_request' }
  | { error: 'conflict'; currentContent: string; currentVersion: number };

export interface BoardSaveSuccess {
  version: number;
}

export interface BoardRevertSuccess {
  version: number;
  content: string;
}

export interface PresenceEntry {
  sessionId: string;
  name: string;
  lastSeen: number;
}

export interface HistoryEntry {
  id: number;
  ts: number;
  editorName: string;
  contentHash: string;
}

export interface HistoryEntryWithContent extends HistoryEntry {
  content: string;
}

interface BoardRow {
  slot_id: string;
  edit_key: string;
  name: string;
  content: string;
  version: number;
  created_at: number;
  updated_at: number;
}

interface HistoryRow {
  id: number;
  slot_id: string;
  ts: number;
  editor_name: string;
  content_hash: string;
  content: string;
}

interface PresenceRow {
  slot_id: string;
  session_id: string;
  name: string;
  last_seen: number;
}

function normalizeEditorName(name: string): string {
  const bounded = name.slice(0, MAX_EDITOR_NAME_LENGTH * 4);
  let cleaned = '';
  for (const ch of bounded) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += ch;
    if (cleaned.length >= MAX_EDITOR_NAME_LENGTH) break;
  }
  const trimmed = cleaned.trim().slice(0, MAX_EDITOR_NAME_LENGTH);
  return trimmed.length === 0 ? 'Anonymous editor' : trimmed;
}

async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}

export class Board extends RpcTarget {
  private sql: SqlStorage;

  constructor(sql: SqlStorage) {
    super();
    this.sql = sql;
    migrate(sql, boardMigrations, '_board_version');
  }

  private getRow(slotId: string): BoardRow | undefined {
    const rows = this.sql
      .exec(`SELECT * FROM boards WHERE slot_id = ?`, slotId)
      .toArray() as unknown as BoardRow[];
    return rows[0];
  }

  list(): BoardListItem[] {
    const rows = this.sql
      .exec(
        `SELECT slot_id, name, updated_at, edit_key FROM boards ORDER BY updated_at DESC`
      )
      .toArray() as unknown as {
      slot_id: string;
      name: string;
      updated_at: number;
      edit_key: string;
    }[];
    return rows.map((r) => ({
      slotId: r.slot_id,
      name: r.name,
      updatedAt: r.updated_at,
      editKey: r.edit_key,
    }));
  }

  getEditUrlInfo(slotId: string): { editKey: string } | undefined {
    const row = this.getRow(slotId);
    if (!row) return undefined;
    return { editKey: row.edit_key };
  }

  count(): number {
    const rows = this.sql
      .exec(`SELECT COUNT(*) AS c FROM boards`)
      .toArray() as unknown as { c: number }[];
    return rows[0]?.c ?? 0;
  }

  create(
    name?: string
  ): { slotId: string; editKey: string } | { error: 'cap_reached' } {
    if (this.count() >= MAX_BOARDS_PER_USER) {
      return { error: 'cap_reached' };
    }
    const slotId = newSlotId();
    const editKey = newEditKey();
    const now = Date.now();
    const trimmedName =
      (name ?? '').trim().slice(0, MAX_BOARD_NAME_LENGTH) || 'Untitled';
    this.sql.exec(
      `INSERT INTO boards (slot_id, edit_key, name, content, version, created_at, updated_at)
       VALUES (?, ?, ?, '', 0, ?, ?)`,
      slotId,
      editKey,
      trimmedName,
      now,
      now
    );
    return { slotId, editKey };
  }

  rename(slotId: string, name: string): { ok: true } | BoardError {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    const trimmed = name.trim().slice(0, MAX_BOARD_NAME_LENGTH);
    if (trimmed.length === 0) return { error: 'bad_request' };
    this.sql.exec(
      `UPDATE boards SET name = ?, updated_at = ? WHERE slot_id = ?`,
      trimmed,
      Date.now(),
      slotId
    );
    return { ok: true };
  }

  read(slotId: string): BoardReadResult | undefined {
    const row = this.getRow(slotId);
    if (!row) return undefined;
    return {
      name: row.name,
      content: row.content,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  readForEdit(
    slotId: string,
    editKey: string
  ): BoardEditResult | { error: 'not_found' | 'forbidden' } {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };
    return { name: row.name, content: row.content, version: row.version };
  }

  async save(
    slotId: string,
    editKey: string,
    content: string,
    baseVersion: number,
    editorName: string
  ): Promise<BoardSaveSuccess | BoardError> {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };

    const byteLength = new TextEncoder().encode(content).byteLength;
    if (byteLength > MAX_CONTENT_BYTES) return { error: 'too_large' };

    if (row.version !== baseVersion) {
      return {
        error: 'conflict',
        currentContent: row.content,
        currentVersion: row.version,
      };
    }

    const now = Date.now();
    const newVersion = row.version + 1;
    const normalizedName = normalizeEditorName(editorName);
    const hash = await hashContent(content);

    // The UPDATE is the compare-and-set: it only applies while the row is
    // still at baseVersion, so a save that raced past the check above (the
    // await on hashContent lets other requests in) can't overwrite it.
    // The DO input/output gates make these three writes atomic relative to
    // external observers: if any throws, the request fails and partial state
    // is not observable. The history trim uses (ts DESC, id DESC) so two
    // saves sharing the same millisecond produce deterministic ordering —
    // newer inserts (higher autoincrement id) are kept.
    const updated = this.sql
      .exec(
        `UPDATE boards SET content = ?, version = ?, updated_at = ?
           WHERE slot_id = ? AND version = ?
           RETURNING version`,
        content,
        newVersion,
        now,
        slotId,
        baseVersion
      )
      .toArray();
    if (updated.length === 0) {
      const current = this.getRow(slotId);
      if (!current) return { error: 'not_found' };
      return {
        error: 'conflict',
        currentContent: current.content,
        currentVersion: current.version,
      };
    }
    this.sql.exec(
      `INSERT INTO board_history (slot_id, ts, editor_name, content_hash, content)
         VALUES (?, ?, ?, ?, ?)`,
      slotId,
      now,
      normalizedName,
      hash,
      content
    );
    this.sql.exec(
      `DELETE FROM board_history
         WHERE slot_id = ?
           AND id NOT IN (
             SELECT id FROM board_history
             WHERE slot_id = ?
             ORDER BY ts DESC, id DESC LIMIT ?
           )`,
      slotId,
      slotId,
      MAX_HISTORY_PER_BOARD
    );

    return { version: newVersion };
  }

  async revert(
    slotId: string,
    editKey: string,
    historyId: number,
    baseVersion: number,
    editorName: string
  ): Promise<BoardRevertSuccess | BoardError> {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };

    const entries = this.sql
      .exec(
        `SELECT * FROM board_history WHERE slot_id = ? AND id = ?`,
        slotId,
        historyId
      )
      .toArray() as unknown as HistoryRow[];
    const entry = entries[0];
    if (!entry) return { error: 'not_found' };

    const normalizedName = normalizeEditorName(editorName);
    const revertName = `${normalizedName} (reverted)`;
    const saved = await this.save(
      slotId,
      editKey,
      entry.content,
      baseVersion,
      revertName
    );
    if ('error' in saved) return saved;
    return { version: saved.version, content: entry.content };
  }

  delete(slotId: string): { ok: boolean } {
    const row = this.getRow(slotId);
    if (!row) return { ok: false };
    this.sql.exec(`DELETE FROM board_presence WHERE slot_id = ?`, slotId);
    this.sql.exec(`DELETE FROM board_history WHERE slot_id = ?`, slotId);
    this.sql.exec(`DELETE FROM boards WHERE slot_id = ?`, slotId);
    return { ok: true };
  }

  rotateEditKey(slotId: string): { editKey: string } | { error: 'not_found' } {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    const editKey = newEditKey();
    this.sql.exec(
      `UPDATE boards SET edit_key = ?, updated_at = ? WHERE slot_id = ?`,
      editKey,
      Date.now(),
      slotId
    );
    return { editKey };
  }

  heartbeat(
    slotId: string,
    editKey: string,
    sessionId: string,
    name: string
  ): { ok: true } | { error: 'not_found' | 'forbidden' } {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };
    const normalizedName = normalizeEditorName(name);
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO board_presence (slot_id, session_id, name, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(slot_id, session_id)
       DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
      slotId,
      sessionId,
      normalizedName,
      now
    );
    // Opportunistic prune of stale rows for this board
    this.sql.exec(
      `DELETE FROM board_presence WHERE slot_id = ? AND last_seen < ?`,
      slotId,
      now - PRESENCE_TTL_MS
    );
    return { ok: true };
  }

  getPresence(slotId: string): PresenceEntry[] {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rows = this.sql
      .exec(
        `SELECT session_id, name, last_seen FROM board_presence
         WHERE slot_id = ? AND last_seen >= ?
         ORDER BY last_seen DESC`,
        slotId,
        cutoff
      )
      .toArray() as unknown as Pick<
      PresenceRow,
      'session_id' | 'name' | 'last_seen'
    >[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      name: r.name,
      lastSeen: r.last_seen,
    }));
  }

  getHistory(
    slotId: string,
    editKey: string
  ): HistoryEntry[] | { error: 'not_found' | 'forbidden' } {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };
    const rows = this.sql
      .exec(
        `SELECT id, ts, editor_name, content_hash FROM board_history
         WHERE slot_id = ?
         ORDER BY ts DESC, id DESC LIMIT ?`,
        slotId,
        MAX_HISTORY_PER_BOARD
      )
      .toArray() as unknown as {
      id: number;
      ts: number;
      editor_name: string;
      content_hash: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      editorName: r.editor_name,
      contentHash: r.content_hash,
    }));
  }

  getHistoryEntry(
    slotId: string,
    editKey: string,
    historyId: number
  ): HistoryEntryWithContent | { error: 'not_found' | 'forbidden' } {
    const row = this.getRow(slotId);
    if (!row) return { error: 'not_found' };
    if (row.edit_key !== editKey) return { error: 'forbidden' };
    const rows = this.sql
      .exec(
        `SELECT id, ts, editor_name, content_hash, content FROM board_history
         WHERE slot_id = ? AND id = ?`,
        slotId,
        historyId
      )
      .toArray() as unknown as HistoryRow[];
    const entry = rows[0];
    if (!entry) return { error: 'not_found' };
    return {
      id: entry.id,
      ts: entry.ts,
      editorName: entry.editor_name,
      contentHash: entry.content_hash,
      content: entry.content,
    };
  }
}
