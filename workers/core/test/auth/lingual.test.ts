import { describe, expect, it } from 'vitest';
import {
  canUseLingual,
  clearLingualEnableCookie,
  hasPendingEnable,
  LINGUAL_ENABLE_COOKIE,
  lingualEnableCookie,
  lingualGrantUrl,
} from '../../app/lib/lingual';
import { isSafeReturnTo } from '../../app/lib/scope-grant';

const envWith = (users: string) =>
  ({ LINGUAL_PREVIEW_USERS: users }) as unknown as Env;

describe('canUseLingual', () => {
  it('admits listed logins, ignoring case and spacing', () => {
    const env = envWith('theCodeDrift, someone');
    expect(canUseLingual(env, 'thecodedrift')).toBe(true);
    expect(canUseLingual(env, 'SOMEONE')).toBe(true);
  });

  it('refuses everyone else', () => {
    expect(canUseLingual(envWith('theCodeDrift'), 'viewer')).toBe(false);
    expect(canUseLingual(envWith('theCodeDrift'))).toBe(false);
  });

  it('refuses everyone when the list is empty', () => {
    expect(canUseLingual(envWith(''), 'theCodeDrift')).toBe(false);
  });
});

const returnTo = (nonce: string) =>
  new URL(lingualGrantUrl(nonce), 'https://www.example.com').searchParams.get(
    'return_to'
  );

const visit = (path: string, cookie?: string) =>
  new Request(`https://www.example.com${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

describe('Lingual enable nonce', () => {
  const env = {
    PVTCH_APP_URL: 'https://www.example.com',
  } as unknown as Env;

  it('returns from the grant to a safe URL carrying the nonce', () => {
    const path = returnTo('n-1');
    expect(isSafeReturnTo(path)).toBe(true);
    expect(path).toBe('/bots/lingual?enable=n-1');
  });

  it('enables only when the nonce matches the cookie', () => {
    const cookie = `${LINGUAL_ENABLE_COOKIE}=n-1`;
    expect(hasPendingEnable(visit('/bots/lingual?enable=n-1', cookie))).toBe(
      true
    );
    expect(hasPendingEnable(visit('/bots/lingual?enable=n-2', cookie))).toBe(
      false
    );
    expect(hasPendingEnable(visit('/bots/lingual?enable=n-1'))).toBe(false);
    expect(hasPendingEnable(visit('/bots/lingual?enable=1'))).toBe(false);
    expect(hasPendingEnable(visit('/bots/lingual', cookie))).toBe(false);
  });

  it('scopes the cookie to the Lingual page and can clear it', () => {
    const set = lingualEnableCookie(env, 'n-1');
    expect(set).toContain(`${LINGUAL_ENABLE_COOKIE}=n-1;`);
    expect(set).toContain('Path=/bots/lingual;');
    expect(set).toContain('HttpOnly;');
    expect(set).toContain('Secure;');
    expect(set).toContain('Max-Age=600');
    expect(clearLingualEnableCookie(env)).toContain('Max-Age=0');
  });
});
