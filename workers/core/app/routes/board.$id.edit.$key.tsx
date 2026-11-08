import { useEffect, useMemo, useRef, useState } from 'react';
import { data, useFetcher, useLoaderData, useRevalidator } from 'react-router';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import type { Route } from './+types/board.$id.edit.$key';
import type { action as revertAction } from './board.$id.edit.$key.revert';
import { cloudflareEnvironmentContext } from '@/context';
import { parseBoardId } from '@/lib/board-id';
import { renderBoardMarkdown } from '@/lib/markdown';
import {
  MAX_CONTENT_BYTES,
  MAX_HISTORY_PER_BOARD,
} from '@/lib/board-constants';
import { Button } from '@/components/ui/button';

const POLL_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 5000;
const EDITOR_NAME_KEY = 'pvtch.board.editorName';

const REVERT_ERRORS = {
  conflict:
    'Someone else edited the board first. It has been refreshed; try the revert again.',
  forbidden: 'This edit URL was rotated. Ask the streamer for the new one.',
  not_found: 'That version or board no longer exists.',
  bad_request: 'Invalid request. Reload the page and try again.',
} as const;

export function meta({ data: meta }: Route.MetaArgs) {
  if (!meta?.ok) return [{ title: 'Board Editor' }];
  return [{ title: `Edit: ${meta.name}` }];
}

function formField(formData: FormData, key: string, fallback = ''): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : fallback;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const parsed = parseBoardId(params.id);
  if (!parsed) {
    return data(
      { ok: false as const, reason: 'not_found' as const },
      {
        status: 404,
      }
    );
  }

  const env = context.get(cloudflareEnvironmentContext);
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${parsed.userId}`)
  );

  using boardPlugin = await stub.board();
  const board = await boardPlugin.readForEdit(parsed.slotId, params.key);

  if ('error' in board) {
    if (board.error === 'forbidden') {
      return data(
        { ok: false as const, reason: 'forbidden' as const },
        {
          status: 403,
        }
      );
    }
    return data(
      { ok: false as const, reason: 'not_found' as const },
      {
        status: 404,
      }
    );
  }

  const presence = await boardPlugin.getPresence(parsed.slotId);
  const historyResult = await boardPlugin.getHistory(parsed.slotId, params.key);
  const history = 'error' in historyResult ? [] : historyResult;
  const safeHtml = renderBoardMarkdown(board.content);

  return data({
    ok: true as const,
    name: board.name,
    content: board.content,
    version: board.version,
    safeHtml,
    presence,
    history,
  });
}

interface SaveError {
  error: 'forbidden' | 'too_large' | 'not_found' | 'conflict' | 'bad_request';
  currentContent?: string;
  currentVersion?: number;
}

interface SaveSuccess {
  ok: true;
  version: number;
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const parsed = parseBoardId(params.id);
  if (!parsed) {
    return data<SaveError>({ error: 'not_found' }, { status: 404 });
  }

  const env = context.get(cloudflareEnvironmentContext);
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${parsed.userId}`)
  );

  const formData = await request.formData();
  const content = formField(formData, 'content');
  const baseVersionRaw = formData.get('baseVersion');
  const editorName = formField(formData, 'editorName');

  if (typeof baseVersionRaw !== 'string' || baseVersionRaw.length === 0) {
    return data<SaveError>({ error: 'bad_request' }, { status: 400 });
  }
  const baseVersion = Number(baseVersionRaw);
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    return data<SaveError>({ error: 'bad_request' }, { status: 400 });
  }

  using boardPlugin = await stub.board();
  const result = await boardPlugin.save(
    parsed.slotId,
    params.key,
    content,
    baseVersion,
    editorName
  );

  if ('error' in result) {
    if (result.error === 'forbidden') {
      return data<SaveError>({ error: 'forbidden' }, { status: 403 });
    }
    if (result.error === 'too_large') {
      return data<SaveError>({ error: 'too_large' }, { status: 413 });
    }
    if (result.error === 'not_found') {
      return data<SaveError>({ error: 'not_found' }, { status: 404 });
    }
    if (result.error === 'conflict') {
      return data<SaveError>(
        {
          error: 'conflict',
          currentContent: result.currentContent,
          currentVersion: result.currentVersion,
        },
        { status: 409 }
      );
    }
  }

  return data<SaveSuccess>({
    ok: true,
    version: (result as { version: number }).version,
  });
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function BoardEditor() {
  const loaderData = useLoaderData<typeof loader>();

  if (!loaderData.ok) {
    return <EditorErrorState reason={loaderData.reason} />;
  }

  return <BoardEditorReady data={loaderData} />;
}

function EditorErrorState({ reason }: { reason: 'not_found' | 'forbidden' }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">
          {reason === 'forbidden'
            ? 'Edit URL no longer valid'
            : 'Board not found'}
        </h1>
        <p className="text-muted-foreground">
          {reason === 'forbidden'
            ? 'This edit URL was rotated. Ask the streamer for a new one.'
            : 'No board exists at this URL, or it was deleted.'}
        </p>
      </div>
    </div>
  );
}

interface ReadyData {
  ok: true;
  name: string;
  content: string;
  version: number;
  safeHtml: string;
  presence: { sessionId: string; name: string; lastSeen: number }[];
  history: {
    id: number;
    ts: number;
    editorName: string;
    contentHash: string;
  }[];
}

function BoardEditorReady({ data: loaderData }: { data: ReadyData }) {
  const saveFetcher = useFetcher<SaveError | SaveSuccess>();
  const presenceFetcher = useFetcher();
  const revertFetcher = useFetcher<typeof revertAction>();
  const revalidator = useRevalidator();

  const sessionIdRef = useRef<string | undefined>(undefined);
  if (!sessionIdRef.current) sessionIdRef.current = nanoid(10);

  const [content, setContent] = useState(loaderData.content);
  const [baseVersion, setBaseVersion] = useState(loaderData.version);
  // Snapshot of the server content as we last synced it. Compare against
  // `content` to decide whether the user has typed anything locally since
  // the last sync — comparing against `loaderData.content` is wrong because
  // that's the *latest* server state; if another editor saves, it diverges
  // from `content` even when the local user never typed.
  const [lastSyncedContent, setLastSyncedContent] = useState(
    loaderData.content
  );
  // Captures the content body sent on the most recent save. On save success
  // we advance `lastSyncedContent` to this value (rather than reading current
  // `content`, which the user may have continued typing into).
  const lastSubmittedContentRef = useRef<string>(loaderData.content);
  const [editorName, setEditorName] = useState<string | undefined>();
  const [namePrompt, setNamePrompt] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  // Bootstrap editor name from localStorage on mount
  useEffect(() => {
    const stored = globalThis.localStorage?.getItem(EDITOR_NAME_KEY) ?? '';
    if (stored) {
      setEditorName(stored);
    } else {
      setShowNamePrompt(true);
    }
  }, []);

  const persistName = (name: string) => {
    const trimmed = name.trim().slice(0, 50);
    if (!trimmed) return;
    globalThis.localStorage?.setItem(EDITOR_NAME_KEY, trimmed);
    setEditorName(trimmed);
    setShowNamePrompt(false);
  };

  // Heartbeat presence every HEARTBEAT_INTERVAL while we know our name
  const presenceSubmit = presenceFetcher.submit;
  useEffect(() => {
    if (!editorName) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    const send = () => {
      const fd = new FormData();
      fd.set('sessionId', sid);
      fd.set('name', editorName);
      void presenceSubmit(fd, {
        method: 'POST',
        action: 'presence',
      });
    };
    send();
    const interval = setInterval(send, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, [editorName, presenceSubmit]);

  // Poll for revalidation (refresh presence, history, server version)
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === 'idle') {
        void revalidator.revalidate();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [revalidator]);

  // After a successful save, advance baseVersion and record the content
  // we submitted as the new "last synced" baseline.
  useEffect(() => {
    if (
      saveFetcher.state === 'idle' &&
      saveFetcher.data &&
      'ok' in saveFetcher.data &&
      saveFetcher.data.ok
    ) {
      setBaseVersion(saveFetcher.data.version);
      setLastSyncedContent(lastSubmittedContentRef.current);
    }
  }, [saveFetcher.state, saveFetcher.data]);

  // After a revert, adopt the restored content on success or explain the
  // failure. Track the consumed response so a polling revalidation doesn't
  // replay it and clobber later edits or repeat the toast.
  const consumedRevert = useRef<unknown>(undefined);
  useEffect(() => {
    const result = revertFetcher.data;
    if (
      revertFetcher.state !== 'idle' ||
      !result ||
      consumedRevert.current === result
    ) {
      return;
    }
    consumedRevert.current = result;
    if ('ok' in result) {
      setContent(result.content);
      setBaseVersion(result.version);
      setLastSyncedContent(result.content);
    } else {
      toast.error(REVERT_ERRORS[result.error]);
    }
    void revalidator.revalidate();
  }, [revertFetcher.state, revertFetcher.data, revalidator]);

  // If the loader returns a newer version AND the user hasn't typed locally
  // since the last sync (i.e. `content === lastSyncedContent`), silently
  // adopt the new server state. If the user *has* typed locally, leave
  // their work alone and let `remoteAhead` trigger so they can decide.
  useEffect(() => {
    if (loaderData.version > baseVersion && content === lastSyncedContent) {
      setContent(loaderData.content);
      setBaseVersion(loaderData.version);
      setLastSyncedContent(loaderData.content);
    }
  }, [
    loaderData.version,
    loaderData.content,
    baseVersion,
    content,
    lastSyncedContent,
  ]);

  const remoteAhead =
    loaderData.version > baseVersion && content !== lastSyncedContent;

  const previewHtml = useMemo(() => renderBoardMarkdown(content), [content]);

  const sizeBytes = byteLength(content);
  const overSize = sizeBytes > MAX_CONTENT_BYTES;

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editorName) {
      setShowNamePrompt(true);
      return;
    }
    if (overSize) return;
    const fd = new FormData();
    fd.set('content', content);
    fd.set('baseVersion', String(baseVersion));
    fd.set('editorName', editorName);
    lastSubmittedContentRef.current = content;
    void saveFetcher.submit(fd, { method: 'POST' });
  };

  const handleReloadFromServer = () => {
    setContent(loaderData.content);
    setBaseVersion(loaderData.version);
    setLastSyncedContent(loaderData.content);
  };

  const handleRevert = (historyId: number) => {
    if (!editorName) {
      setShowNamePrompt(true);
      return;
    }
    if (!globalThis.confirm('Revert this board to the selected version?')) {
      return;
    }
    const fd = new FormData();
    fd.set('historyId', String(historyId));
    fd.set('baseVersion', String(loaderData.version));
    fd.set('editorName', editorName);
    void revertFetcher.submit(fd, { method: 'POST', action: 'revert' });
  };

  const saveData = saveFetcher.data;
  const saveError = saveData && 'error' in saveData ? saveData : undefined;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{loaderData.name}</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Editing as{' '}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => {
                  setNamePrompt(editorName ?? '');
                  setShowNamePrompt(true);
                }}
              >
                {editorName ?? 'set your name'}
              </button>
            </p>
          </div>
          <PresenceRoster
            entries={loaderData.presence}
            ownSessionId={sessionIdRef.current ?? ''}
          />
        </div>
      </header>

      {showNamePrompt && (
        <div className="border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <label htmlFor="editor-name-input" className="text-sm">
              Your name (shown in history):
            </label>
            <input
              id="editor-name-input"
              type="text"
              autoFocus
              maxLength={50}
              className="flex-1 px-2 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              value={namePrompt}
              onChange={(e) => setNamePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') persistName(namePrompt);
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => persistName(namePrompt)}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {remoteAhead && (
        <div className="border-b border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm">
              Someone else saved a newer version. Saving now will fail.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleReloadFromServer}
            >
              Discard my changes &amp; reload
            </Button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3">
          <div className="max-w-6xl mx-auto text-sm">
            {saveError.error === 'conflict' && (
              <div className="flex items-center justify-between gap-4">
                <span>
                  Save conflict — version {saveError.currentVersion} is on the
                  server. Reload and reapply your changes.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (typeof saveError.currentContent === 'string') {
                      setContent(saveError.currentContent);
                      setLastSyncedContent(saveError.currentContent);
                    }
                    if (typeof saveError.currentVersion === 'number') {
                      setBaseVersion(saveError.currentVersion);
                    }
                  }}
                >
                  Discard my changes &amp; reload
                </Button>
              </div>
            )}
            {saveError.error === 'forbidden' &&
              'This edit URL was rotated. Ask the streamer for the new one.'}
            {saveError.error === 'too_large' &&
              `Content is too large. Limit is ${MAX_CONTENT_BYTES} bytes.`}
            {saveError.error === 'not_found' && 'This board no longer exists.'}
            {saveError.error === 'bad_request' &&
              'Invalid request. Reload the page and try again.'}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck
            className="w-full min-h-[60vh] p-3 font-mono text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 resize-y"
            placeholder="Markdown content..."
          />
          <div className="flex items-center justify-between gap-3">
            <span
              className={
                overSize
                  ? 'text-sm text-red-600 dark:text-red-400'
                  : 'text-sm text-zinc-500 dark:text-zinc-400'
              }
            >
              {sizeBytes} / {MAX_CONTENT_BYTES} bytes
            </span>
            <Button
              type="submit"
              variant="action"
              disabled={overSize || saveFetcher.state !== 'idle'}
            >
              {saveFetcher.state === 'idle' ? 'Save' : 'Saving…'}
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-3">
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 min-h-[60vh] overflow-auto">
            <div
              className="prose dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </aside>
      </main>

      <section className="max-w-6xl mx-auto px-4 pb-8">
        <h2 className="text-sm font-semibold mb-2">
          History (last {MAX_HISTORY_PER_BOARD})
        </h2>
        <ul className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
          {loaderData.history.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">No history yet.</li>
          )}
          {loaderData.history.map((h) => (
            <li
              key={h.id}
              className="px-3 py-2 flex items-center justify-between gap-3 text-sm"
            >
              <span>
                <span className="font-medium">{h.editorName}</span>{' '}
                <span className="text-zinc-500">
                  · {formatRelative(h.ts)} · {h.contentHash}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={revertFetcher.state !== 'idle'}
                onClick={() => handleRevert(h.id)}
              >
                Revert
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PresenceRoster({
  entries,
  ownSessionId,
}: {
  entries: { sessionId: string; name: string; lastSeen: number }[];
  ownSessionId: string;
}) {
  const others = entries.filter((e) => e.sessionId !== ownSessionId);
  if (others.length === 0) {
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        No other editors
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">Editing:</span>
      <div className="flex flex-wrap gap-1">
        {others.map((e) => (
          <span
            key={e.sessionId}
            className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
          >
            {e.name}
          </span>
        ))}
      </div>
    </div>
  );
}
