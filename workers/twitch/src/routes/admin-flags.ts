import { HANDLER_IDS, isHandlerId } from '@pvtch/shared/twitch-registry';

import { channelStub } from '../channel';
import { escapeHtml, htmlPage } from '../html';
import { getSessionUser, isAdmin } from '../session';

/** `<handlerId>.<feature>`, e.g. `lingual.reply-threading`. */
const FLAG_NAME = /^([a-z][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/;

/** Twitch user ids are numeric. */
const BROADCASTER_ID = /^\d+$/;

const FORMAT_HINT = `Name a flag <code>&lt;handler&gt;.&lt;feature&gt;</code>, e.g. <code>lingual.reply-threading</code>. The feature uses lowercase letters, digits and hyphens. Handlers: ${HANDLER_IDS.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}.`;

/**
 * Why `name` can't be turned on, or undefined when it can. Turning a flag off
 * skips this, so a flag left behind by a removed handler can still be cleared.
 */
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

interface Problem {
  error: string;
  name: string;
  on: boolean;
}

function flagsPage(
  broadcasterId: string,
  list: string[],
  problem?: Problem
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
  const off = problem?.on === false ? ' selected' : '';
  return `<h1>Flags for ${escapeHtml(broadcasterId)}</h1>
<ul>${items || '<li>None on</li>'}</ul>
<h2>Set a flag</h2>
${error}
<form method="post">
  <input name="name" placeholder="lingual.feature" value="${escapeHtml(problem?.name ?? '')}" required>
  <select name="on"><option value="true">on</option><option value="false"${off}>off</option></select>
  <button>Set</button>
</form>
<p>${FORMAT_HINT}</p>`;
}

/**
 * /admin/flags: per-channel feature flags. GET lists them with a form, POST
 * (`name`, `on`) turns one on or off and redirects back to the list. Pass
 * `?broadcaster=<user id>` for another channel; it defaults to the admin's
 * own. The session cookie is SameSite=Lax, which stops other sites but not
 * other *.pvtch.com pages from POSTing here as an admin (see #11).
 */
export async function adminFlags(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user || !isAdmin(env, user)) {
    return new Response(undefined, { status: 403 });
  }

  // An empty ?broadcaster= means the admin's own channel, like a missing one.
  const requested = new URL(request.url).searchParams.get('broadcaster') ?? '';
  if (requested && !BROADCASTER_ID.test(requested)) {
    return htmlPage(
      'Flags',
      `<p role="alert">${escapeHtml(`"${requested}" isn't a Twitch user id. Use the numeric id, not the login.`)}</p>`,
      400
    );
  }
  const broadcasterId = requested || user.id;
  using flags = await channelStub(env, broadcasterId).flags();
  if (request.method === 'GET') {
    return htmlPage('Flags', flagsPage(broadcasterId, await flags.list()));
  }

  const form = await request.formData();
  const nameField = form.get('name');
  const name = typeof nameField === 'string' ? nameField.trim() : '';
  const onField = form.get('on');
  const on = onField === 'true';
  let error: string | undefined;
  if (onField !== 'true' && onField !== 'false') {
    error = 'Choose on or off.';
  } else if (on) {
    error = flagError(name);
  } else if (!name) {
    error = 'Name the flag to turn off.';
  }
  if (error) {
    return htmlPage(
      'Flags',
      flagsPage(broadcasterId, await flags.list(), { error, name, on }),
      400
    );
  }

  await flags.set(name, on);
  // 303 so a refresh doesn't resubmit the form.
  const query = requested
    ? `?broadcaster=${encodeURIComponent(requested)}`
    : '';
  return new Response(undefined, {
    status: 303,
    headers: { Location: `/admin/flags${query}` },
  });
}
