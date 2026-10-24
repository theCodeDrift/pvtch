import path from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  server: {
    allowedHosts: [
      'localhost',
      // 'zkaot-2600-1700-22fb-6400--20.run.pinggy-free.link',
    ],
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // Runs pvtch-storage alongside in dev so TWITCH_CHANNEL resolves.
      auxiliaryWorkers: [{ configPath: '../storage/wrangler.jsonc' }],
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    {
      // https://github.com/cloudflare/workers-sdk/issues/8909#issuecomment-3401112596
      name: 'cloudflare-vite-plugin-fix',
      configEnvironment(name, config) {
        const isDevelopment =
          process.env.npm_lifecycle_script?.endsWith('react-router dev');
        if (name === 'ssr' && !isDevelopment) {
          delete config.dev;
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './app'),
    },
  },
});
