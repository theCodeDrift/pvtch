import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader as callbackLoader } from '../../app/routes/auth/callback';
import { loader as startLoader } from '../../app/routes/auth/start';
import { FakeKV, signedIn } from './fake-kv';

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
};

function environment(accounts: FakeKV): Env {
  return {
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_SECRET: { get: () => Promise.resolve('secret') },
    PVTCH_APP_URL: 'https://www.example.com',
    TWITCH_REDIRECT_URI: 'https://www.example.com/auth/callback',
    PVTCH_ACCOUNTS: accounts,
  } as unknown as Env;
}

function start(env: Env) {
  return startLoader({
    context: { get: () => env },
  } as unknown as Parameters<typeof startLoader>[0]);
}

function callback(env: Env, query: string, cookie = '') {
  return callbackLoader({
    request: new Request(`https://www.example.com/auth/callback?${query}`, {
      headers: { Cookie: cookie },
    }),
    context: { get: () => env },
  } as unknown as Parameters<typeof callbackLoader>[0]);
}

function mockTwitch(user = USER) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: Request) => {
      if (input.url.endsWith('/oauth2/token')) {
        return Promise.resolve(Response.json({ access_token: 'user-token' }));
      }
      if (input.url.endsWith('/helix/users')) {
        return Promise.resolve(
          Response.json({
            data: [
              {
                id: user.id,
                login: user.login,
                display_name: user.display_name,
              },
            ],
          })
        );
      }
      throw new Error(`unexpected fetch ${input.url}`);
    })
  );
}

/** The value of the `name` cookie among a response's Set-Cookie headers. */
function setCookie(response: Response, name: string): string | undefined {
  const header = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));
  return header?.split(';')[0].slice(name.length + 1);
}

const CLEARS_STATE =
  'pvtch_login_state=; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /auth/start', () => {
  it('puts a state in the Twitch URL and the same one in a cookie', () => {
    const response = start(environment(new FakeKV()));

    const location = new URL(response.headers.get('Location') ?? '');
    const state = location.searchParams.get('state');
    expect(state).toMatch(/^\w{22}$/);
    expect(response.headers.getSetCookie()).toEqual([
      `pvtch_login_state=${state}; Path=/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    ]);
  });
});

describe('GET /auth/callback', () => {
  it('rejects a missing state', async () => {
    const accounts = new FakeKV();
    const response = await callback(
      environment(accounts),
      'code=c',
      'pvtch_login_state=st'
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([CLEARS_STATE]);
    expect(accounts.store.size).toBe(0);
  });

  it('rejects a state that does not match the cookie', async () => {
    mockTwitch();
    for (const cookie of ['pvtch_login_state=st', '']) {
      const response = await callback(
        environment(new FakeKV()),
        'code=c&state=forged',
        cookie
      );
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the state when Twitch returns an error', async () => {
    const response = await callback(
      environment(new FakeKV()),
      'error=access_denied&state=st',
      'pvtch_login_state=st'
    );
    expect(response.headers.get('Location')).toBe(
      'https://www.example.com/auth/error?error=access_denied'
    );
    expect(response.headers.getSetCookie()).toEqual([CLEARS_STATE]);
  });

  it('starts a new session for a returning user', async () => {
    mockTwitch();
    const accounts = signedIn(USER, 'old-session');

    const response = await callback(
      environment(accounts),
      'code=c&state=st',
      'pvtch_login_state=st; pvtch_token=old-session'
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://www.example.com/welcome'
    );
    const sessionToken = setCookie(response, 'pvtch_token') ?? '';
    expect(sessionToken).toMatch(/^\w{22}$/);
    expect(sessionToken).not.toBe(USER.token);
    expect(accounts.keys('session-')).toEqual([`session-${sessionToken}`]);
    expect(
      JSON.parse(accounts.store.get(`session-${sessionToken}`) ?? '')
    ).toEqual({ userId: USER.id, token: USER.token });
    expect(accounts.putOptions.get(`session-${sessionToken}`)).toEqual({
      expirationTtl: 2_592_000,
    });
    expect(JSON.parse(accounts.store.get('twitch-data-u-1') ?? '')).toEqual(
      USER
    );
    expect(response.headers.getSetCookie()).toContain(CLEARS_STATE);
  });

  it('creates the account and a session for a new user', async () => {
    mockTwitch();
    const accounts = new FakeKV();

    const response = await callback(
      environment(accounts),
      'code=c&state=st',
      'pvtch_login_state=st'
    );

    const account = JSON.parse(accounts.store.get('twitch-data-u-1') ?? '') as {
      token: string;
    };
    expect(accounts.store.get(`token-data-${account.token}`)).toBe('u-1');
    const sessionToken = setCookie(response, 'pvtch_token') ?? '';
    expect(sessionToken).not.toBe(account.token);
    expect(
      JSON.parse(accounts.store.get(`session-${sessionToken}`) ?? '')
    ).toEqual({ userId: 'u-1', token: account.token });
  });
});
