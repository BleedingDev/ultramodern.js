import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  include: ['integration/**/*.(spec|test).[jt]s?(x)'],
  exclude: ['integration/rstest/**'],
  globals: true,
  // Framework tests spawn many build/dev-server/puppeteer tasks; cap file-level
  // concurrency to avoid CI resource contention without changing assertions.
  // The cap is CI-scoped only; local runs use full worker parallelism.
  pool: {
    maxWorkers: process.env.CI === 'true' ? '50%' : '100%',
  },
  retry: 1,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
