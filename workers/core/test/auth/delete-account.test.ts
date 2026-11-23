import { describe, expect, it, vi } from 'vitest';
import { action } from '../../app/routes/account.delete';
import { userContext } from '../../app/context';
import { signedIn } from './fake-kv';
import { fakeUserNamespace } from './fake-user-namespace';

const USER = {
  id: 'u-1',
  login: 'Streamer',
  display_name: 'Streamer',
  token: 'tok-1',
};

function setup() {
  const accounts = signedIn(USER, 's-1');
  const users = fakeUserNamespace(accounts);
  const clear = vi.fn(() => Promise.resolve());
  const backendNames: string[] = [];
  const env = {
    PVTCH_APP_URL: 'https://www.example.com',
    PVTCH_ACCOUNTS: accounts,
    PVTCH_USER: users,
    PVTCH_BACKEND: {
      idFromName: (name: string) => {
        backendNames.push(name);
        return name;
      },
      get: () => ({ clear }),
    },
  } as unknown as Env;
  const user = users.get(users.idFromName(`twitch:${USER.id}`));
  return { env, accounts, user, clear, backendNames };
}

async function submit(
  env: Env,
  login: string,
  headers: Record<string, string> = {}
) {
  const user = {
    id: USER.id,
    login: USER.login,
    displayName: USER.display_name,
    token: USER.token,
  };
  try {
    return await action({
      request: new Request('https://www.example.com/account/delete', {
        method: 'POST',
        headers: { Cookie: 'pvtch_token=s-1', ...headers },
        body: new URLSearchParams({ login }),
      }),
      context: {
        get: (key: unknown) => (key === userContext ? user : env),
      },
    } as unknown as Parameters<typeof action>[0]);
  } catch (error) {
    // react-router's redirect() is a Response
    return error;
  }
}

describe('POST /account/delete', () => {
  it('starts the deletion, signs out and lands on /account/deleted', async () => {
    const { env, accounts, user, clear, backendNames } = setup();

    const response = (await submit(env, ' streamer ')) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/account/deleted');
    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).toContain('pvtch_token=;');
    expect(cookies).toContain('pvtch_name=;');
    expect(accounts.store.has('session-s-1')).toBe(false);
    expect(user.isDeletingAccount()).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(backendNames).toEqual(['tok-1::lingo-config']);
  });

  it('refuses a login that does not match', async () => {
    const { env, user, clear } = setup();

    const result = (await submit(env, 'someone-else')) as {
      init?: { status?: number };
      data: { error: string; login: string };
    };

    expect(result.init?.status).toBe(400);
    expect(result.data).toEqual({
      error: 'Type Streamer to confirm',
      login: 'someone-else',
    });
    expect(user.isDeletingAccount()).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it('refuses a cross-site request', async () => {
    const { env, user } = setup();

    const result = (await submit(env, 'streamer', {
      Origin: 'https://evil.example',
    })) as { init?: { status?: number } };

    expect(result.init?.status).toBe(403);
    expect(user.isDeletingAccount()).toBe(false);
  });
});
