import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWorker,
  BOT_ID,
  createTestEnv,
  mockFetch,
  type TestEnv,
} from './helpers/fakes';

/**
 * Store an account and a session for it, as www's sign-in does. Returns the
 * session cookie; the overlay token is `tok-{login}`.
 */
async function signIn(t: TestEnv, id: string, login: string) {
  const token = `tok-${login}`;
  await t.accounts.put(`token-data-${token}`, id);
  await t.accounts.put(
    `twitch-data-${id}`,
    JSON.stringify({ id, login, display_name: login, token })
  );
  await t.accounts.put(
    `session-s-${login}`,
    JSON.stringify({ userId: id, token })
  );
  return `pvtch_token=s-${login}`;
}

function login(t: TestEnv, login: string) {
  return signIn(t, `id-${login}`, login);
}

function loginAsBot(t: TestEnv) {
  return signIn(t, BOT_ID, 'botlingual');
}

const ORIGIN = 'https://twitch.example.com';

function get(path: string, cookie?: string) {
  return new Request(`https://twitch.example.com${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function postFlag(cookie: string, fields: Record<string, string>, search = '') {
  return new Request(`https://twitch.example.com/admin/flags${search}`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN },
    body: new URLSearchParams(fields),
  });
}

describe('admin routes', () => {
  let t: TestEnv;

  beforeEach(() => {
    t = createTestEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses /bot/authorize without a session', async () => {
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual'),
      t.env
    );
    expect(response.status).toBe(403);
  });

  it('does not accept an overlay token as a session', async () => {
    await login(t, 'admin_user');
    const cookie = 'pvtch_token=tok-admin_user';
    for (const path of ['/bot/authorize?sender=botlingual', '/admin/flags']) {
      const response = await fetchWorker(get(path, cookie), t.env);
      expect(response.status).toBe(403);
    }
  });

  it('refuses /bot/authorize for a logged-in non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual', cookie),
      t.env
    );
    expect(response.status).toBe(403);
  });

  it('refuses everyone when ADMIN_USERS is empty', async () => {
    const cookie = await login(t, 'admin_user');
    const env = { ...t.env, ADMIN_USERS: '' } as unknown as Env;
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual', cookie),
      env
    );
    expect(response.status).toBe(403);
  });

  it('sends an admin to Twitch for the bot scopes', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual', cookie),
      t.env
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('scope')).toBe(
      'user:bot user:read:chat user:write:chat'
    );
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://twitch.example.com/bot/callback'
    );
  });

  it('sends the bot account itself to Twitch without being an admin', async () => {
    const cookie = await loginAsBot(t);
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual', cookie),
      t.env
    );
    expect(response.status).toBe(302);
  });

  it('rejects /bot/authorize for an unknown sender', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      get('/bot/authorize?sender=nope', cookie),
      t.env
    );
    expect(response.status).toBe(400);
  });

  it('carries the sender through the OAuth state', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      get('/bot/authorize?sender=botlingual', cookie),
      t.env
    );
    const state = new URL(
      response.headers.get('Location') ?? ''
    ).searchParams.get('state');
    expect(state).toMatch(/\.botlingual$/);
  });

  it("escapes Twitch's ?error= on the callback page", async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      get(
        '/bot/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E&state=s.botlingual',
        `${cookie}; pvtch_bot_state=s.botlingual`
      ),
      t.env
    );
    const body = await response.text();
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rejects a callback whose state does not match', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      get('/bot/callback?code=c&state=s', `${cookie}; pvtch_bot_state=other`),
      t.env
    );
    expect(response.status).toBe(400);
  });

  it('rejects a callback authorized by an account other than the bot', async () => {
    const cookie = await login(t, 'admin_user');
    mockFetch(
      (url) =>
        url.pathname === '/oauth2/token'
          ? Response.json({ access_token: 'user-token' })
          : undefined,
      (url) =>
        url.pathname === '/helix/users'
          ? Response.json({ data: [{ id: 'someone-else' }] })
          : undefined
    );

    const response = await fetchWorker(
      get(
        '/bot/callback?code=c&state=s.botlingual',
        `${cookie}; pvtch_bot_state=s.botlingual`
      ),
      t.env
    );

    expect(response.status).toBe(400);
  });

  it('confirms a callback authorized by the bot account', async () => {
    const cookie = await login(t, 'admin_user');
    mockFetch(
      (url) =>
        url.pathname === '/oauth2/token'
          ? Response.json({ access_token: 'user-token' })
          : undefined,
      (url) =>
        url.pathname === '/helix/users'
          ? Response.json({ data: [{ id: BOT_ID }] })
          : undefined
    );

    const response = await fetchWorker(
      get(
        '/bot/callback?code=c&state=s.botlingual',
        `${cookie}; pvtch_bot_state=s.botlingual`
      ),
      t.env
    );

    expect(response.status).toBe(200);
  });

  it('refuses /admin/bootstrap for a non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/bootstrap', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
      t.env
    );
    expect(response.status).toBe(403);
  });

  it('refuses /admin/bootstrap for the bot account', async () => {
    const cookie = await loginAsBot(t);
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/bootstrap', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
      }),
      t.env
    );
    expect(response.status).toBe(403);
  });

  it('refuses /admin/flags for a non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
        body: new URLSearchParams({ name: 'lingual.x', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(403);
    expect(t.channel(`id-viewer`).flagSet.size).toBe(0);
  });

  it("turns a flag on for the admin's channel", async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
        body: new URLSearchParams({
          name: 'lingual.reply-threading',
          on: 'true',
        }),
      }),
      t.env
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/admin/flags');
    expect([...t.channel('id-admin_user').flagSet]).toEqual([
      'lingual.reply-threading',
    ]);
  });

  it('keeps ?broadcaster= when redirecting back to the list', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags?broadcaster=123', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
        body: new URLSearchParams({ name: 'lingual.x', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(
      '/admin/flags?broadcaster=123'
    );
    expect([...t.channel('123').flagSet]).toEqual(['lingual.x']);
  });

  it('lists flags with an off button and the format hint', async () => {
    const cookie = await login(t, 'admin_user');
    t.channel('id-admin_user').flagSet.add('lingual.reply-threading');
    const response = await fetchWorker(get('/admin/flags', cookie), t.env);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain(
      '<input type="hidden" name="name" value="lingual.reply-threading">'
    );
    expect(body).toContain('<input type="hidden" name="on" value="false">');
    expect(body).toContain('<code>lingual</code>');
  });

  it("explains a name that isn't <handler>.<feature>", async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
        body: new URLSearchParams({ name: 'Reply Threading', on: 'true' }),
      }),
      t.env
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(body).toContain(
      'isn&#39;t in the &lt;handler&gt;.&lt;feature&gt; format'
    );
    expect(body).toContain('value="Reply Threading"');
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('rejects a flag for an unknown handler', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN },
        body: new URLSearchParams({ name: 'unknown.thing', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      '&quot;unknown&quot; isn&#39;t a registered handler'
    );
  });

  it('turns a flag off from its button', async () => {
    const cookie = await login(t, 'admin_user');
    t.channel('id-admin_user').flagSet.add('lingual.x');
    const response = await fetchWorker(
      postFlag(cookie, { name: 'lingual.x', on: 'false' }),
      t.env
    );
    expect(response.status).toBe(303);
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('turns off a flag whose handler is no longer registered', async () => {
    const cookie = await login(t, 'admin_user');
    t.channel('id-admin_user').flagSet.add('oldhandler.x');
    const response = await fetchWorker(
      postFlag(cookie, { name: 'oldhandler.x', on: 'false' }),
      t.env
    );
    expect(response.status).toBe(303);
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('rejects an on value other than true or false', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      postFlag(cookie, { name: 'lingual.x', on: 'yes' }),
      t.env
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Choose on or off.');
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('keeps the flag list and the off choice on a 400', async () => {
    const cookie = await login(t, 'admin_user');
    t.channel('id-admin_user').flagSet.add('lingual.x');
    const response = await fetchWorker(
      postFlag(cookie, { name: '', on: 'false' }),
      t.env
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(body).toContain('<code>lingual.x</code>');
    expect(body).toContain('<option value="false" selected>off</option>');
  });

  it('escapes a typed name on the 400 page', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      postFlag(cookie, { name: '"><script>alert(1)</script>', on: 'true' }),
      t.env
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(body).not.toContain('<script>');
    expect(body).toContain(
      'value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'
    );
  });

  it('treats an empty ?broadcaster= as the admin’s own channel', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      postFlag(cookie, { name: 'lingual.x', on: 'true' }, '?broadcaster='),
      t.env
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/admin/flags');
    expect([...t.channel('id-admin_user').flagSet]).toEqual(['lingual.x']);
  });

  it('rejects a ?broadcaster= that is not a numeric id', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      postFlag(
        cookie,
        { name: 'lingual.x', on: 'true' },
        '?broadcaster=somelogin'
      ),
      t.env
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('isn&#39;t a Twitch user id');
    expect(t.channel('somelogin').flagSet.size).toBe(0);
  });

  it.each([
    ['another pvtch.com subdomain', { Origin: 'https://www.example.com' }],
    ['no Origin and a same-site fetch', { 'Sec-Fetch-Site': 'same-site' }],
    ['no Origin or Sec-Fetch-Site', {}],
  ])('refuses an admin flag POST from %s', async (_, headers) => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, ...headers },
        body: new URLSearchParams({ name: 'lingual.x', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(403);
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('accepts an admin flag POST marked same-origin without an Origin', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
        body: new URLSearchParams({ name: 'lingual.x', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(303);
  });

  it('refuses an admin bootstrap POST from another origin', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/bootstrap', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://www.example.com' },
      }),
      t.env
    );
    expect(response.status).toBe(403);
  });

  it('refuses /admin/status for a non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(get('/admin/status', cookie), t.env);
    expect(response.status).toBe(403);
  });
});
