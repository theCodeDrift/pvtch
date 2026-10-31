import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWorker,
  BOT_ID,
  createTestEnv,
  mockFetch,
  type TestEnv,
} from './helpers/fakes';

async function login(t: TestEnv, login: string) {
  await t.accounts.put(`token-data-tok-${login}`, `id-${login}`);
  await t.accounts.put(
    `twitch-data-id-${login}`,
    JSON.stringify({ id: `id-${login}`, login })
  );
  return `pvtch_token=tok-${login}`;
}

async function loginAsBot(t: TestEnv) {
  await t.accounts.put('token-data-tok-bot', BOT_ID);
  await t.accounts.put(
    `twitch-data-${BOT_ID}`,
    JSON.stringify({ id: BOT_ID, login: 'botlingual' })
  );
  return 'pvtch_token=tok-bot';
}

function get(path: string, cookie?: string) {
  return new Request(`https://twitch.example.com${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
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
        headers: { Cookie: cookie },
        body: new URLSearchParams({ name: 'Reply Threading', on: 'true' }),
      }),
      t.env
    );
    const body = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(body).toContain(
      "isn't in the &lt;handler&gt;.&lt;feature&gt; format"
    );
    expect(body).toContain('value="Reply Threading"');
    expect(t.channel('id-admin_user').flagSet.size).toBe(0);
  });

  it('rejects a flag for an unknown handler', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(
      new Request('https://twitch.example.com/admin/flags', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: new URLSearchParams({ name: 'unknown.thing', on: 'true' }),
      }),
      t.env
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "&quot;unknown&quot; isn't a registered handler"
    );
  });

  it('refuses /admin/status for a non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(get('/admin/status', cookie), t.env);
    expect(response.status).toBe(403);
  });
});
