import { describe, expect, it } from 'vitest';

import { readSecret } from '../src/secrets';

describe('readSecret', () => {
  it('reads a Secrets Store binding', async () => {
    expect(await readSecret({ get: () => Promise.resolve('s3cret') })).toBe(
      's3cret'
    );
  });

  it('passes a plain string through', async () => {
    expect(await readSecret('s3cret')).toBe('s3cret');
  });

  it('returns an empty string when unset', async () => {
    expect(await readSecret()).toBe('');
  });
});
