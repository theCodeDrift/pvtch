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
    const response = await fetchWorker(get('/bot/authorize'), t.env);
    expect(response.status).toBe(403);
  });

  it('refuses /bot/authorize for a logged-in non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(get('/bot/authorize', cookie), t.env);
    expect(response.status).toBe(403);
  });

  it('refuses everyone when ADMIN_USERS is empty', async () => {
    const cookie = await login(t, 'admin_user');
    const env = { ...t.env, ADMIN_USERS: '' } as unknown as Env;
    const response = await fetchWorker(get('/bot/authorize', cookie), env);
    expect(response.status).toBe(403);
  });

  it('sends an admin to Twitch for the bot scopes', async () => {
    const cookie = await login(t, 'admin_user');
    const response = await fetchWorker(get('/bot/authorize', cookie), t.env);

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
    const response = await fetchWorker(get('/bot/authorize', cookie), t.env);
    expect(response.status).toBe(302);
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
      get('/bot/callback?code=c&state=s', `${cookie}; pvtch_bot_state=s`),
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
      get('/bot/callback?code=c&state=s', `${cookie}; pvtch_bot_state=s`),
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

  it('refuses /admin/status for a non-admin', async () => {
    const cookie = await login(t, 'viewer');
    const response = await fetchWorker(get('/admin/status', cookie), t.env);
    expect(response.status).toBe(403);
  });
});
