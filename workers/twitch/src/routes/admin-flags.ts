import { HANDLER_IDS, isHandlerId } from '@pvtch/shared/twitch-registry';

import { channelStub } from '../channel';
import { getSessionUser, isAdmin } from '../session';

/** `<handlerId>.<feature>`, e.g. `lingual.reply-threading`. */
const FLAG_NAME = /^([a-z][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/;

const FORMAT_HINT = `Name a flag <code>&lt;handler&gt;.&lt;feature&gt;</code>, e.g. <code>lingual.reply-threading</code>. The feature uses lowercase letters, digits and hyphens. Handlers: ${HANDLER_IDS.map((id) => `<code>${id}</code>`).join(', ')}.`;

/** Why `name` can't be a flag, or undefined when it can. */
function flagError(name: string): string | undefined {
  const match = FLAG_NAME.exec(name);
  if (!match?.[1]) {
    return `"${name}" isn't in the <handler>.<feature> format.`;
  }
  if (!isHandlerId(match[1])) {
    return `"${match[1]}" isn't a registered handler.`;
  }
  return;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

function flagsPage(
  broadcasterId: string,
  list: string[],
  problem?: { error: string; name: string }
): string {
  const items = list
    .map(
      (name) => `<li><form method="post">
    <code>${escapeHtml(name)}</code>
    <input type="hidden" name="name" value="${escapeHtml(name)}">
    <input type="hidden" name="on" value="false">
    <button>Turn off</button>
  </form></li>`
    )
    .join('');
  const error = problem
    ? `<p role="alert" style="color:#b91c1c">${escapeHtml(problem.error)}</p>`
    : '';
  return `<!doctype html><meta charset="utf-8"><title>Flags</title>
<h1>Flags for ${escapeHtml(broadcasterId)}</h1>
<ul>${items || '<li>None on</li>'}</ul>
<h2>Set a flag</h2>
${error}
<form method="post">
  <input name="name" placeholder="lingual.feature" value="${escapeHtml(problem?.name ?? '')}" required>
  <select name="on"><option value="true">on</option><option value="false">off</option></select>
  <button>Set</button>
</form>
<p>${FORMAT_HINT}</p>`;
}

/**
 * /admin/flags: per-channel feature flags. GET lists them with a form, POST
 * (`name`, `on`) turns one on or off and redirects back to the list. Pass
 * `?broadcaster=<user id>` for another channel. The session cookie is
 * SameSite=Lax, so a cross-site form can't POST here as an admin.
 */
export async function adminFlags(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user || !isAdmin(env, user)) {
    return new Response(undefined, { status: 403 });
  }

  const url = new URL(request.url);
  const broadcasterId = url.searchParams.get('broadcaster') ?? user.id;
  using flags = await channelStub(env, broadcasterId).flags();
  if (request.method === 'GET') {
    return html(flagsPage(broadcasterId, await flags.list()));
  }

  const form = await request.formData();
  const nameField = form.get('name');
  const name = typeof nameField === 'string' ? nameField.trim() : '';
  const on = form.get('on');
  const error =
    flagError(name) ??
    (on === 'true' || on === 'false' ? undefined : 'Choose on or off.');
  if (error) {
    return html(
      flagsPage(broadcasterId, await flags.list(), { error, name }),
      400
    );
  }

  await flags.set(name, on === 'true');
  // 303 so a refresh doesn't resubmit the form.
  return new Response(undefined, {
    status: 303,
    headers: { Location: `${url.pathname}${url.search}` },
  });
}
