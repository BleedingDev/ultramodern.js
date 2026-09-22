import { defineConfig } from '@rstest/core';

/**
 * Integration worker count.
 *
 * `INTEGRATION_MAX_WORKERS` lets a runner profile change be tried without a code
 * change; otherwise CI gets a fixed 2 and local runs keep full parallelism.
 */
function resolveMaxWorkers(): number | string {
  const override = process.env.INTEGRATION_MAX_WORKERS;
  if (override) {
    const parsed = Number(override);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    return override;
  }

  return process.env.CI === 'true' ? 2 : '100%';
}

export default defineConfig({
  root: __dirname,
  include: ['integration/**/*.(spec|test).[jt]s?(x)'],
  exclude: ['integration/rstest/**'],
  globals: true,
  // Heavy fixtures keep up to three dev servers and a browser alive (4-5 GB).
  // Two test-file workers fit within the CI runner's 16 GB memory budget.
  pool: {
    maxWorkers: resolveMaxWorkers(),
  },
  retry: 1,
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // Peak heap per test file, so a future OOM is diagnosable from the log rather
  // than only visible as an abrupt termination.
  logHeapUsage: process.env.CI === 'true',
});
