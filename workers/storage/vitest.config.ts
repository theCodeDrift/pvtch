import path from 'node:path';
import { defineConfig } from 'vitest/config';

// SQL runs on workerd's own SQLite through Miniflare (see
// test/helpers/workerd-sql.ts). The Durable Object classes themselves run in
// Node, where `cloudflare:workers` doesn't exist, so it is aliased to a stub
// providing a no-op `DurableObject` base class.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(
        __dirname,
        './test/stubs/cloudflare-workers.ts'
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
