import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function v2Vars(file: string): Record<string, string> {
  const path = new URL(`../${file}`, import.meta.url).pathname;
  const config = readFileSync(path, 'utf8');
  return Object.fromEntries(
    [...config.matchAll(/"(LINGUAL_V2_\w+)":\s*"([^"]*)"/g)].map(
      ([, name, value]) => [name, value]
    )
  );
}

describe('wrangler.harness.jsonc', () => {
  it('carries the same v2 vars as wrangler.jsonc', () => {
    const deployed = v2Vars('wrangler.jsonc');

    expect(Object.keys(deployed)).toHaveLength(5);
    expect(v2Vars('wrangler.harness.jsonc')).toEqual(deployed);
  });
});
