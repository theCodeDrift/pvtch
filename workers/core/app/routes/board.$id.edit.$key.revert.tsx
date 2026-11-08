import { data } from 'react-router';
import type { Route } from './+types/board.$id.edit.$key.revert';
import { cloudflareEnvironmentContext } from '@/context';
import { parseBoardId } from '@/lib/board-id';

export async function action({ params, request, context }: Route.ActionArgs) {
  const parsed = parseBoardId(params.id);
  if (!parsed) {
    return data({ error: 'not_found' as const }, { status: 404 });
  }

  const env = context.get(cloudflareEnvironmentContext);
  const stub = env.PVTCH_USER.get(
    env.PVTCH_USER.idFromName(`twitch:${parsed.userId}`)
  );

  const formData = await request.formData();
  const historyIdRaw = formData.get('historyId');
  const baseVersionRaw = formData.get('baseVersion');
  const editorNameRaw = formData.get('editorName');

  if (typeof historyIdRaw !== 'string' || historyIdRaw.length === 0) {
    return data({ error: 'bad_request' as const }, { status: 400 });
  }
  if (typeof baseVersionRaw !== 'string' || baseVersionRaw.length === 0) {
    return data({ error: 'bad_request' as const }, { status: 400 });
  }
  const historyId = Number(historyIdRaw);
  const baseVersion = Number(baseVersionRaw);
  const editorName = typeof editorNameRaw === 'string' ? editorNameRaw : '';

  if (!Number.isInteger(historyId) || historyId <= 0) {
    return data({ error: 'bad_request' as const }, { status: 400 });
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    return data({ error: 'bad_request' as const }, { status: 400 });
  }

  using boardPlugin = await stub.board();
  const result = await boardPlugin.revert(
    parsed.slotId,
    params.key,
    historyId,
    baseVersion,
    editorName
  );

  if ('error' in result) {
    if (result.error === 'forbidden') {
      return data({ error: 'forbidden' as const }, { status: 403 });
    }
    if (result.error === 'conflict') {
      return data(
        {
          error: 'conflict' as const,
          currentContent: result.currentContent,
          currentVersion: result.currentVersion,
        },
        { status: 409 }
      );
    }
    if (result.error === 'too_large') {
      return data({ error: 'too_large' as const }, { status: 413 });
    }
    return data({ error: 'not_found' as const }, { status: 404 });
  }

  // revert() returns the version it wrote together with the restored
  // content, so the client never pairs a version with someone else's edit.
  return data({
    ok: true as const,
    version: result.version,
    content: result.content,
  });
}
