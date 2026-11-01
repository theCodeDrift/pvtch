import { describe, expect, it } from 'vitest';
import {
  cloudflareEnvironmentContext,
  userContext,
  type TwitchUser,
} from '../../app/context';
import { isValidToken } from '../../app/lib/twitch-data';
import { authMiddleware } from '../../app/middleware/auth';
import { type FakeKV, signedIn } from './fake-kv';

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
};

function environment(accounts: FakeKV, overrides: Partial<Env> = {}): Env {
  return {
    PVTCH_APP_URL: 'https://www.example.com',
    ALLOWED_USERS: '',
    PVTCH_ACCOUNTS: accounts,
    ...overrides,
  } as unknown as Env;
}

/** Run the middleware and return the user it resolved, if any. */
async function resolve(env: Env, cookie?: string) {
  const values = new Map<unknown, unknown>([
    [cloudflareEnvironmentContext, env],
  ]);
  const context = {
    get: (key: unknown) => values.get(key),
    set: (key: unknown, value: unknown) => values.set(key, value),
  };
  const request = new Request('https://www.example.com/welcome', {
    headers: cookie ? { Cookie: cookie } : {},
  });
  await authMiddleware(
    { request, context } as unknown as Parameters<typeof authMiddleware>[0],
    () => Promise.resolve(new Response())
  );
  return values.get(userContext) as TwitchUser | undefined;
}

describe('authMiddleware', () => {
  it('resolves a session', async () => {
    const user = await resolve(environment(signedIn(USER)), 'pvtch_token=s-1');
    expect(user).toEqual({
      id: 'u-1',
      login: 'streamer',
      displayName: 'Streamer',
      token: 'tok-1',
    });
  });

  it('does not accept the overlay token as a session', async () => {
    const user = await resolve(
      environment(signedIn(USER)),
      'pvtch_token=tok-1'
    );
    expect(user).toBeUndefined();
  });

  it('drops a session issued for an earlier overlay token', async () => {
    const accounts = signedIn(USER);
    accounts.store.set(
      'twitch-data-u-1',
      JSON.stringify({ ...USER, token: 'tok-2' })
    );
    const user = await resolve(environment(accounts), 'pvtch_token=s-1');
    expect(user).toBeUndefined();
  });

  it('signs in as DEV_TWITCH_USER_ID on localhost, with no cookie', async () => {
    const env = environment(signedIn(USER), {
      PVTCH_APP_URL: 'http://localhost:5173',
      DEV_TWITCH_USER_ID: 'u-1',
    });
    const user = await resolve(env);
    expect(user?.id).toBe('u-1');
    expect(await isValidToken('anything', env)).toBe('u-1');
  });

  it('ignores DEV_TWITCH_USER_ID anywhere else', async () => {
    const env = environment(signedIn(USER), { DEV_TWITCH_USER_ID: 'u-1' });
    expect(await resolve(env)).toBeUndefined();
    expect(await isValidToken('anything', env)).toBeUndefined();
    expect(await isValidToken('tok-1', env)).toBe('u-1');
  });
});
