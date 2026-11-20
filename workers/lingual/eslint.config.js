import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    rules: {
      // The OpenRouter class builds every endpoint's schemas at startup and
      // fails Cloudflare's startup CPU limit. Use the standalone functions
      // (`@openrouter/sdk/core.js`, `@openrouter/sdk/funcs/*.js`).
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@openrouter/sdk',
              message:
                'Import OpenRouterCore from @openrouter/sdk/core.js and the call from @openrouter/sdk/funcs/*.js.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];
