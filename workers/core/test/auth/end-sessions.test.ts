import { describe, expect, it, vi, afterEach } from 'vitest';
import { action } from '../../app/routes/account.sessions.end';
import { userContext } from '../../app/context';
import { sessionUser } from '../../app/lib/twitch-data';
import { signedIn } from './fake-kv';
import { fakeUserNamespace } from './fake-user-namespace';

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
  scopes: ['channel:bot'],
};

function setup() {
  const accounts = signedIn(USER, 's-1');
  accounts.store.set(
    'session-s-2',
    JSON.stringify({ userId: USER.id, token: USER.token, issuedAt: 1 })
  );
  const users = fakeUserNamespace(accounts);
  const env = {
    PVTCH_APP_URL: 'https://www.example.com',
    PVTCH_ACCOUNTS: accounts,
    PVTCH_USER: users,
  } as unknown as Env;
  return { env, accounts, users };
}

function endSessions(env: Env, headers: Record<string, string> = {}) {
  const user = {
    id: USER.id,
    login: USER.login,
    displayName: USER.display_name,
    token: USER.token,
  };
  return action({
    request: new Request('https://www.example.com/account/sessions/end', {
      method: 'POST',
      headers: { Cookie: 'pvtch_token=s-1', ...headers },
    }),
    context: {
      get: (key: unknown) => (key === userContext ? user : env),
    },
  } as unknown as Parameters<typeof action>[0]);
}

function resolves(env: Env, sessionToken: string) {
  return sessionUser(
    new Request('https://www.example.com/', {
      headers: { Cookie: `pvtch_token=${sessionToken}` },
    }),
    env
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /account/sessions/end', () => {
  it('signs out other browsers and keeps this one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { env, accounts } = setup();

    const result = await endSessions(env);
    expect(result.init?.status).toBeUndefined();

    expect(await resolves(env, 's-2')).toBeUndefined();
    expect(await resolves(env, 's-1')).toMatchObject({ id: USER.id });
    const record = JSON.parse(
      accounts.store.get('twitch-data-u-1') ?? '{}'
    ) as {
      sessionsNotBefore?: number;
    };
    expect(record.sessionsNotBefore).toBe(10_000);
  });

  it('keeps overlay URLs working', async () => {
    const { env, accounts } = setup();
    await endSessions(env);
    expect(accounts.store.get('token-data-tok-1')).toBe(USER.id);
  });

  it('refuses a cross-site request', async () => {
    const { env, accounts } = setup();
    const result = await endSessions(env, { Origin: 'https://evil.example' });

    expect(result.init?.status).toBe(403);
    expect(accounts.store.get('twitch-data-u-1')).not.toContain(
      'sessionsNotBefore'
    );
    expect(await resolves(env, 's-2')).toMatchObject({ id: USER.id });
  });

  it('keeps the cutoff through later account writes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { env, accounts, users } = setup();
    await endSessions(env);

    const user = users.get(users.idFromName(`twitch:${USER.id}`));
    await user.setAccountScopes(USER.id, ['channel:bot', 'user:read:chat']);
    await user.ensureAccount({
      id: USER.id,
      login: USER.login,
      display_name: USER.display_name,
    });

    const record = JSON.parse(
      accounts.store.get('twitch-data-u-1') ?? '{}'
    ) as {
      sessionsNotBefore?: number;
    };
    expect(record.sessionsNotBefore).toBe(10_000);
    expect(await resolves(env, 's-2')).toBeUndefined();
  });
});
