import { describe, expect, it } from 'vitest';
import { cloudflareEnvironmentContext } from '../../app/context';
import {
  clearedSessionCookies,
  sessionCookies,
} from '../../app/lib/session-cookie';
import { action as logout } from '../../app/routes/auth/logout';
import { type FakeKV, signedIn } from './fake-kv';

const PROD = { PVTCH_APP_URL: 'https://www.pvtch.com' } as unknown as Env;
const LOCAL = { PVTCH_APP_URL: 'http://localhost:5173' } as unknown as Env;

describe('session cookies', () => {
  it('makes the session HttpOnly, leaves the name readable, and expires both', () => {
    const [token, name] = sessionCookies(PROD, 's-1', 'Some One');
    expect(token).toBe(
      'pvtch_token=s-1; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; Max-Age=2592000; HttpOnly'
    );
    expect(name).toBe(
      'pvtch_name=Some%20One; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; Max-Age=2592000'
    );
  });

  it('drops Domain and Secure on localhost', () => {
    const [token] = sessionCookies(LOCAL, 's-1', 'Some One');
    expect(token).toBe(
      'pvtch_token=s-1; Path=/; SameSite=Lax; Max-Age=2592000; HttpOnly'
    );
  });

  it('expires both cookies with the attributes they were set with', () => {
    expect(clearedSessionCookies(PROD)).toEqual([
      'pvtch_token=; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; HttpOnly; Max-Age=0',
      'pvtch_name=; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; Max-Age=0',
    ]);
  });
});

const USER = { id: 'u-1', token: 'tok-1' };

function post(accounts: FakeKV, headers: Record<string, string>) {
  const env = { ...PROD, PVTCH_ACCOUNTS: accounts } as unknown as Env;
  const context = {
    get: (key: unknown) =>
      key === cloudflareEnvironmentContext ? env : undefined,
  };
  const request = new Request('https://www.pvtch.com/auth/logout', {
    method: 'POST',
    headers,
  });
  return logout({ request, context } as unknown as Parameters<
    typeof logout
  >[0]);
}

describe('POST /auth/logout', () => {
  it('deletes the session and clears both cookies', async () => {
    const accounts = signedIn(USER);
    const response = await post(accounts, {
      Origin: 'https://www.pvtch.com',
      Cookie: 'pvtch_token=s-1',
    });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(
      clearedSessionCookies(PROD)
    );
    expect(accounts.keys('session-')).toEqual([]);
    expect(accounts.store.get('token-data-tok-1')).toBe('u-1');
  });

  it('clears the cookies when there is no session', async () => {
    const response = await post(signedIn(USER), {});
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(
      clearedSessionCookies(PROD)
    );
  });

  it('refuses a request from another origin', async () => {
    const accounts = signedIn(USER);
    const response = await post(accounts, {
      Origin: 'https://evil.example',
      Cookie: 'pvtch_token=s-1',
    });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(accounts.keys('session-')).toEqual(['session-s-1']);
  });
});
