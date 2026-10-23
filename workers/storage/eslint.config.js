import tseslint from 'typescript-eslint';

import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              // cron-parser is CommonJS. Wrangler's bundle (an ES module
              // package, so Node interop) binds its default import to the
              // whole `module.exports`, where `parse` does not exist; vitest
              // binds `exports.default` instead, so tests pass while every
              // cron schedule throws in production.
              name: 'cron-parser',
              importNames: ['default'],
              message:
                "Import { CronExpressionParser } from 'cron-parser': its default import has no `parse` in the deployed bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    // The workerd-sql worker thread is plain JavaScript so Node can load it
    // straight from disk, which puts it outside `tsconfig`'s program. Type-aware
    // rules have no types for it and error out, so only that layer is turned
    // off; syntax, correctness and unicorn rules still apply.
    files: ['test/helpers/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: false,
        program: null,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
