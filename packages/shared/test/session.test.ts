/* eslint-disable unicorn/no-null -- KV returns null for a missing key */
import { describe, expect, it } from 'vitest';

import { resolveSession } from '../src/session';

const ACCOUNT = {
  id: 'u-1',
  login: 'streamer',
  display_name: 'Streamer',
  token: 'overlay-1',
  scopes: ['channel:bot'],
};

function accounts(entries: Record<string, string>) {
  return { get: (key: string) => Promise.resolve(entries[key] ?? null) };
}

const SIGNED_IN = {
  'session-s-1': JSON.stringify({ userId: 'u-1', token: 'overlay-1' }),
  'twitch-data-u-1': JSON.stringify(ACCOUNT),
};

describe('resolveSession', () => {
  it('returns the account behind a session', async () => {
    expect(await resolveSession(accounts(SIGNED_IN), 's-1')).toEqual(ACCOUNT);
  });

  it('returns undefined without a token', async () => {
    expect(await resolveSession(accounts(SIGNED_IN))).toBe(undefined);
    expect(await resolveSession(accounts(SIGNED_IN), '')).toBe(undefined);
  });

  it('returns undefined for an unknown session', async () => {
    expect(await resolveSession(accounts(SIGNED_IN), 's-2')).toBe(undefined);
  });

  it('returns undefined for a malformed session record', async () => {
    for (const raw of ['{not json', '"u-1"', JSON.stringify({ userId: 1 })]) {
      const kv = accounts({ ...SIGNED_IN, 'session-s-1': raw });
      expect(await resolveSession(kv, 's-1')).toBe(undefined);
    }
  });

  it('returns undefined when the account record is gone', async () => {
    const kv = accounts({ 'session-s-1': SIGNED_IN['session-s-1'] });
    expect(await resolveSession(kv, 's-1')).toBe(undefined);
  });

  it('returns undefined once the account has a new overlay token', async () => {
    const kv = accounts({
      ...SIGNED_IN,
      'twitch-data-u-1': JSON.stringify({ ...ACCOUNT, token: 'overlay-2' }),
    });
    expect(await resolveSession(kv, 's-1')).toBe(undefined);
  });

  it('does not treat an overlay token as a session', async () => {
    const kv = accounts({
      'token-data-overlay-1': 'u-1',
      'twitch-data-u-1': JSON.stringify(ACCOUNT),
    });
    expect(await resolveSession(kv, 'overlay-1')).toBe(undefined);
  });
});
