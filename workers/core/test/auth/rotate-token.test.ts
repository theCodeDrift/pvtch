import { describe, expect, it } from 'vitest';
import { action } from '../../app/routes/account.token.rotate';
import { userContext } from '../../app/context';
import { isValidToken, sessionUser } from '../../app/lib/twitch-data';
import { signedIn } from './fake-kv';
import { fakeUserNamespace } from './fake-user-namespace';

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
  scopes: ['channel:bot'],
};

/** A PVTCH_BACKEND holding legacy Lingo config by `{token}::lingo-config`. */
function fakeBackend(legacy: Map<string, string>, fail = false) {
  return {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      get: () =>
        fail
          ? Promise.reject(new Error('backend unavailable'))
          : Promise.resolve(legacy.get(name) ?? ''),
    }),
  };
}

function setup(legacy = new Map<string, string>(), failBackend = false) {
  const accounts = signedIn(USER, 's-1');
  accounts.store.set(
    'session-s-2',
    JSON.stringify({ userId: USER.id, token: USER.token })
  );
  const env = {
    PVTCH_APP_URL: 'https://www.example.com',
    PVTCH_ACCOUNTS: accounts,
    PVTCH_USER: fakeUserNamespace(accounts),
    PVTCH_BACKEND: fakeBackend(legacy, failBackend),
  } as unknown as Env;
  return { env, accounts };
}

function rotate(env: Env, method = 'POST', signedInUser = true) {
  const user = signedInUser
    ? {
        id: USER.id,
        login: USER.login,
        displayName: USER.display_name,
        token: USER.token,
      }
    : null; // eslint-disable-line unicorn/no-null -- userContext's empty value
  return action({
    request: new Request('https://www.example.com/account/token/rotate', {
      method,
      headers: { Cookie: 'pvtch_token=s-1' },
    }),
    context: {
      get: (key: unknown) => (key === userContext ? user : env),
    },
  } as unknown as Parameters<typeof action>[0]);
}

function sessionAccount(env: Env, sessionToken: string) {
  return sessionUser(
    new Request('https://www.example.com/', {
      headers: { Cookie: `pvtch_token=${sessionToken}` },
    }),
    env
  );
}

describe('POST /account/token/rotate', () => {
  it('replaces the token, revokes the old one and keeps the session', async () => {
    const { env, accounts } = setup();

    const result = await rotate(env);
    expect(result.init?.status).toBeUndefined();

    const account = JSON.parse(accounts.store.get('twitch-data-u-1') ?? '') as {
      token: string;
    };
    expect(account).toEqual({ ...USER, token: account.token });
    expect(account.token).not.toBe(USER.token);
    expect(await isValidToken(account.token, env)).toBe('u-1');
    expect(await isValidToken(USER.token, env)).toBeUndefined();

    // This browser stays signed in; other sessions end with the old token.
    const current = await sessionAccount(env, 's-1');
    expect(current?.token).toBe(account.token);
    expect(await sessionAccount(env, 's-2')).toBeUndefined();
  });

  it('is the token every later login gets', async () => {
    const { env, accounts } = setup();
    await rotate(env);
    const rotated = (
      JSON.parse(accounts.store.get('twitch-data-u-1') ?? '') as {
        token: string;
      }
    ).token;

    const account = await env.PVTCH_USER.get(
      env.PVTCH_USER.idFromName('twitch:u-1')
    ).ensureAccount({
      id: USER.id,
      login: USER.login,
      display_name: USER.display_name,
    });
    expect(account.token).toBe(rotated);
  });

  it('refuses an anonymous request', async () => {
    const { env, accounts } = setup();
    const result = await rotate(env, 'POST', false);
    expect(result.init?.status).toBe(401);
    expect(accounts.store.get('token-data-tok-1')).toBe('u-1');
  });

  it('moves Lingo config still under the old token before rotating', async () => {
    const legacy = new Map([
      [
        'tok-1::lingo-config',
        JSON.stringify({ bots: ['nightbot'], language: 'german' }),
      ],
    ]);
    const { env, accounts } = setup(legacy);

    await rotate(env);

    expect(accounts.store.has('token-data-tok-1')).toBe(false);
    using lingo = env.PVTCH_USER.get(
      env.PVTCH_USER.idFromName('twitch:u-1')
    ).lingo();
    expect(lingo.getConfig()).toEqual({
      bots: ['nightbot'],
      language: 'german',
    });
  });

  it('keeps the old token when the Lingo migration fails', async () => {
    const { env, accounts } = setup(new Map(), true);

    const result = await rotate(env);

    expect(result.init?.status).toBe(500);
    expect(result.data).toEqual({
      error: 'Could not move your Lingo settings. Your key was not changed.',
    });
    expect(accounts.store.get('token-data-tok-1')).toBe('u-1');
    expect(JSON.parse(accounts.store.get('twitch-data-u-1') ?? '')).toEqual(
      USER
    );
    expect(await isValidToken(USER.token, env)).toBe('u-1');
  });

  it('retries revoking the old token when the KV delete fails', async () => {
    const { env, accounts } = setup();
    const del = accounts.delete.bind(accounts);
    let failures = 1;
    accounts.delete = (key: string) => {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('kv unavailable'));
      }
      return del(key);
    };

    const result = await rotate(env);

    // The rotation stands and this browser stays signed in.
    expect(result.init?.status).toBeUndefined();
    expect(accounts.store.get('token-data-tok-1')).toBe('u-1');
    const user = env.PVTCH_USER.get(env.PVTCH_USER.idFromName('twitch:u-1'));
    expect(user.hasPendingAccountRevocations()).toBe(true);

    // The scheduled retry finishes the revocation.
    await user.scheduled({ task: 'revoke-tokens' } as Parameters<
      typeof user.scheduled
    >[0]);
    expect(accounts.store.has('token-data-tok-1')).toBe(false);
    expect(user.hasPendingAccountRevocations()).toBe(false);
  });
});
