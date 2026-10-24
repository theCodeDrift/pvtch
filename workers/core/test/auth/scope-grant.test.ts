/* eslint-disable unicorn/no-null -- KV and isSafeReturnTo use null */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeGrant,
  isSafeReturnTo,
  parseScopes,
  startGrant,
} from '../../app/lib/scope-grant';
import { loader as loginLoader } from '../../app/routes/auth/start';
import type { TwitchUserData } from '../../app/lib/twitch-data';

class FakeKV {
  store = new Map<string, string>();
  get(key: string, type?: 'json') {
    const value = this.store.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(type === 'json' ? JSON.parse(value) : value);
  }
  put(key: string, value: string) {
    this.store.set(key, value);
    return Promise.resolve();
  }
}

const USER: TwitchUserData = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
};

function setup(user: TwitchUserData = USER) {
  const accounts = new FakeKV();
  accounts.store.set('token-data-tok-1', user.id);
  accounts.store.set(`twitch-data-${user.id}`, JSON.stringify(user));
  const env = {
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_SECRET: 'secret',
    PVTCH_APP_URL: 'https://www.example.com',
    TWITCH_REDIRECT_URI: 'https://www.example.com/auth/callback',
    PVTCH_ACCOUNTS: accounts,
  } as unknown as Env;
  return { env, accounts };
}

const SESSION = 'pvtch_token=tok-1';

function storedUser(accounts: FakeKV): TwitchUserData {
  return JSON.parse(
    accounts.store.get('twitch-data-u-1') ?? '{}'
  ) as TwitchUserData;
}

function request(path: string, cookie = SESSION) {
  return new Request(`https://www.example.com${path}`, {
    headers: { Cookie: cookie },
  });
}

/** Run /auth/grant and return the Twitch URL plus the state cookie. */
async function begin(env: Env, query: string) {
  const response = await startGrant(request(`/auth/grant?${query}`), env);
  const location = new URL(
    response.headers.get('Location') ?? 'https://none.invalid/'
  );
  const cookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0];
  return { response, location, cookie };
}

function mockTwitch(approvingId: string, scope: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) {
        return Promise.resolve(
          Response.json({ access_token: 'user-token', scope })
        );
      }
      if (url.endsWith('/helix/users')) {
        return Promise.resolve(Response.json({ data: [{ id: approvingId }] }));
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

describe('scope grant helpers', () => {
  it('parses space- or comma-separated scopes without duplicates', () => {
    expect(parseScopes('channel:bot, channel:bot user:read:chat')).toEqual([
      'channel:bot',
      'user:read:chat',
    ]);
  });

  it.each([
    ['/bots/lingual', true],
    ['/bots/lingual?enable=1', true],
    ['https://evil.example.com/', false],
    ['//evil.example.com/', false],
    [String.raw`/\evil.example.com`, false],
    ['bots/lingual', false],
    [null, false],
  ])('isSafeReturnTo(%s) is %s', (path, expected) => {
    expect(isSafeReturnTo(path)).toBe(expected);
  });
});

describe('GET /auth/grant', () => {
  it('sends a logged-in user to Twitch for a grantable scope', async () => {
    const { env } = setup();
    const { response, location, cookie } = await begin(
      env,
      'scopes=channel:bot&return_to=/bots/lingual'
    );

    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      'https://id.twitch.tv/oauth2/authorize'
    );
    expect(location.searchParams.get('scope')).toBe('channel:bot');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://www.example.com/auth/grant/callback'
    );
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(cookie.startsWith('pvtch_grant=')).toBe(true);
  });

  it('requests the union of new and already-recorded scopes', async () => {
    const { env } = setup({ ...USER, scopes: ['user:read:email'] });
    const { location } = await begin(
      env,
      'scopes=channel:bot&return_to=/bots/lingual'
    );

    expect(location.searchParams.get('scope')).toBe(
      'user:read:email channel:bot'
    );
  });

  it('refuses a scope that is not grantable', async () => {
    const { env } = setup();
    const { response } = await begin(
      env,
      'scopes=channel:manage:broadcast&return_to=/bots/lingual'
    );
    expect(response.status).toBe(400);
  });

  it('refuses an absolute or protocol-relative return_to', async () => {
    const { env } = setup();
    for (const target of ['https://evil.example.com', '//evil.example.com']) {
      const { response } = await begin(
        env,
        `scopes=channel:bot&return_to=${encodeURIComponent(target)}`
      );
      expect(response.status).toBe(400);
    }
  });

  it('sends an anonymous visitor to log in first', async () => {
    const { env } = setup();
    const response = await startGrant(
      request('/auth/grant?scopes=channel:bot&return_to=/bots/lingual', ''),
      env
    );
    expect(response.headers.get('Location')).toBe('/auth/start');
  });
});

async function callback(env: Env, query: (state: string) => string) {
  const { location, cookie } = await begin(
    env,
    'scopes=channel:bot&return_to=%2Fbots%2Flingual%3Fenable%3D1'
  );
  const state = location.searchParams.get('state') ?? '';
  return completeGrant(
    request(`/auth/grant/callback?${query(state)}`, `${SESSION}; ${cookie}`),
    env
  );
}

describe('GET /auth/grant/callback', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records the granted scopes, keeps no token, and returns', async () => {
    const { env, accounts } = setup();
    mockTwitch(USER.id, ['channel:bot']);

    const response = await callback(env, (state) => `code=c&state=${state}`);

    expect(response.headers.get('Location')).toBe(
      '/bots/lingual?enable=1&granted=channel%3Abot'
    );
    const stored = storedUser(accounts);
    expect(stored).toEqual({ ...USER, scopes: ['channel:bot'] });
    expect(JSON.stringify([...accounts.store.values()])).not.toContain(
      'user-token'
    );
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('refuses a grant approved by a different Twitch account', async () => {
    const { env, accounts } = setup();
    mockTwitch('someone-else', ['channel:bot']);

    const response = await callback(env, (state) => `code=c&state=${state}`);

    expect(response.headers.get('Location')).toContain(
      'grant_error=account_mismatch'
    );
    expect(storedUser(accounts).scopes).toBeUndefined();
  });

  it('rejects a state that does not match the cookie', async () => {
    const { env } = setup();
    const response = await callback(env, () => 'code=c&state=forged');
    expect(response.status).toBe(400);
  });

  it('rejects a malformed state cookie', async () => {
    const { env } = setup();
    const response = await completeGrant(
      request(
        '/auth/grant/callback?code=c&state=s',
        `${SESSION}; pvtch_grant=%7Bnot-json`
      ),
      env
    );
    expect(response.status).toBe(400);
  });

  it('returns with the error when the user declines', async () => {
    const { env, accounts } = setup();

    const response = await callback(
      env,
      (state) => `error=access_denied&state=${state}`
    );

    expect(response.headers.get('Location')).toBe(
      '/bots/lingual?enable=1&grant_error=access_denied'
    );
    expect(storedUser(accounts).scopes).toBeUndefined();
  });
});

describe('login', () => {
  it('still requests no scopes', () => {
    const { env } = setup();
    const response = loginLoader({
      context: { get: () => env },
    } as unknown as Parameters<typeof loginLoader>[0]);

    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.searchParams.get('scope') ?? '').toBe('');
  });
});
