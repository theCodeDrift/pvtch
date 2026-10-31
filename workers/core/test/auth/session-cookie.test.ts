import { describe, expect, it } from 'vitest';
import { cloudflareEnvironmentContext } from '../../app/context';
import {
  clearedSessionCookies,
  sessionCookies,
} from '../../app/lib/session-cookie';
import { action as logout } from '../../app/routes/auth/logout';

const PROD = { PVTCH_APP_URL: 'https://www.pvtch.com' } as unknown as Env;
const LOCAL = { PVTCH_APP_URL: 'http://localhost:5173' } as unknown as Env;

describe('session cookies', () => {
  it('makes the token HttpOnly and leaves the name readable', () => {
    const [token, name] = sessionCookies(PROD, 'tok-1', 'Some One');
    expect(token).toBe(
      'pvtch_token=tok-1; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; HttpOnly'
    );
    expect(name).toBe(
      'pvtch_name=Some%20One; Path=/; SameSite=Lax; Domain=pvtch.com; Secure'
    );
  });

  it('drops Domain and Secure on localhost', () => {
    const [token] = sessionCookies(LOCAL, 'tok-1', 'Some One');
    expect(token).toBe('pvtch_token=tok-1; Path=/; SameSite=Lax; HttpOnly');
  });

  it('expires both cookies with the attributes they were set with', () => {
    expect(clearedSessionCookies(PROD)).toEqual([
      'pvtch_token=; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; HttpOnly; Max-Age=0',
      'pvtch_name=; Path=/; SameSite=Lax; Domain=pvtch.com; Secure; Max-Age=0',
    ]);
  });

  it('clears both cookies on POST /auth/logout', () => {
    const context = {
      get: (key: unknown) =>
        key === cloudflareEnvironmentContext ? PROD : undefined,
    };
    const response = logout({ context } as unknown as Parameters<
      typeof logout
    >[0]);
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(
      clearedSessionCookies(PROD)
    );
  });
});
