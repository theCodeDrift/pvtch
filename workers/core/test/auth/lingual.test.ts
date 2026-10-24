import { describe, expect, it } from 'vitest';
import { canUseLingual } from '../../app/lib/lingual';

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
    expect(canUseLingual(envWith('theCodeDrift'), undefined)).toBe(false);
  });

  it('refuses everyone when the list is empty', () => {
    expect(canUseLingual(envWith(''), 'theCodeDrift')).toBe(false);
  });
});
