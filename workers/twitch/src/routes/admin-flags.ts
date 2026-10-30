import { isHandlerId } from '@pvtch/shared/twitch-registry';

import { channelStub } from '../channel';
import { getSessionUser, isAdmin } from '../session';

/** `<handlerId>.<feature>`, e.g. `lingual.reply-threading`. */
const FLAG_NAME = /^([a-z][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/;

function isValidFlag(name: string): boolean {
  const match = FLAG_NAME.exec(name);
  return match?.[1] !== undefined && isHandlerId(match[1]);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * /admin/flags: per-channel feature flags. GET lists them with a form, POST
 * (`name`, `on`) turns one on or off. Pass `?broadcaster=<user id>` for
 * another channel. The session cookie is SameSite=Lax, so a cross-site form
 * can't POST here as an admin.
 */
export async function adminFlags(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user || !isAdmin(env, user)) {
    return new Response(undefined, { status: 403 });
  }

  const broadcasterId =
    new URL(request.url).searchParams.get('broadcaster') ?? user.id;
  using flags = await channelStub(env, broadcasterId).flags();

  if (request.method === 'GET') {
    const list = await flags.list();
    const items = list
      .map((name) => `<li><code>${escapeHtml(name)}</code></li>`)
      .join('');
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Flags</title>
<h1>Flags for ${escapeHtml(broadcasterId)}</h1>
<ul>${items || '<li>None on</li>'}</ul>
<form method="post">
  <input name="name" placeholder="lingual.feature" required>
  <select name="on"><option value="true">on</option><option value="false">off</option></select>
  <button>Set</button>
</form>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const form = await request.formData();
  const nameField = form.get('name');
  const name = typeof nameField === 'string' ? nameField.trim() : '';
  const on = form.get('on');
  if (!isValidFlag(name) || (on !== 'true' && on !== 'false')) {
    return new Response(undefined, { status: 400 });
  }
  return Response.json({
    broadcasterId,
    flags: await flags.set(name, on === 'true'),
  });
}
