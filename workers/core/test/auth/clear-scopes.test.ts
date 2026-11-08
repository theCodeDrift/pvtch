import { describe, expect, it } from 'vitest';
import { FakeKV, signedIn } from './fake-kv';
import { fakeUserNamespace } from './fake-user-namespace';

const USER = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'tok-1',
  scopes: ['channel:bot'],
};

function setup(accounts: FakeKV = signedIn(USER)) {
  const users = fakeUserNamespace(accounts);
  const user = users.get(users.idFromName(`twitch:${USER.id}`));
  return { accounts, user };
}

function record(accounts: FakeKV, id = USER.id): Record<string, unknown> {
  return JSON.parse(accounts.store.get(`twitch-data-${id}`) ?? '{}') as Record<
    string,
    unknown
  >;
}

describe('User.clearAccountScopes', () => {
  it('drops the scopes and keeps the token and every other field', async () => {
    const accounts = signedIn({ ...USER, extra: 'kept' } as typeof USER);
    const { user } = setup(accounts);

    const { scopes: _scopes, ...rest } = USER;
    const account = await user.clearAccountScopes(USER.id);

    expect(account).toEqual({ ...rest, extra: 'kept' });
    expect(record(accounts)).toEqual({ ...rest, extra: 'kept' });
    expect(accounts.store.get('token-data-tok-1')).toBe(USER.id);
  });

  it('imports a KV-only account, so a later login keeps its token', async () => {
    const { accounts, user } = setup();

    await user.clearAccountScopes(USER.id);
    const account = await user.ensureAccount({
      id: USER.id,
      login: USER.login,
      display_name: USER.display_name,
    });

    expect(account.token).toBe(USER.token);
    expect(record(accounts).scopes).toBeUndefined();
  });

  it('does nothing for an account pvtch has never seen', async () => {
    const accounts = new FakeKV();
    const { user } = setup(accounts);

    expect(await user.clearAccountScopes(USER.id)).toBeUndefined();
    expect(accounts.store.size).toBe(0);
  });

  it('keeps the new token when a revoke races a rotation', async () => {
    const { accounts, user } = setup();

    const [rotated] = await Promise.all([
      user.rotateAccountToken(USER.id),
      user.clearAccountScopes(USER.id),
    ]);

    const current = record(accounts);
    expect(current.token).toBe(rotated.account.token);
    expect(current.token).not.toBe(USER.token);
    expect(current.scopes).toBeUndefined();
    expect(accounts.store.get(`token-data-${rotated.account.token}`)).toBe(
      USER.id
    );
    expect(accounts.store.has('token-data-tok-1')).toBe(false);
  });

  it('lets a later grant record scopes again', async () => {
    const { accounts, user } = setup();

    await Promise.all([
      user.clearAccountScopes(USER.id),
      user.setAccountScopes(USER.id, ['moderator:read:chatters']),
    ]);

    expect(record(accounts).scopes).toEqual(['moderator:read:chatters']);
    expect(record(accounts).token).toBe(USER.token);
  });
});
