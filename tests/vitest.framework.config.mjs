import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const cpuCount = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
const frameworkParallel = process.env.VITEST_FRAMEWORK_PARALLEL !== '0';

const parsePositiveInt = value => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

const maxThreads =
  parsePositiveInt(process.env.VITEST_FRAMEWORK_MAX_THREADS) ??
  Math.max(1, Math.floor(cpuCount / 2));
const minThreads = Math.min(2, maxThreads);

export default defineConfig({
  resolve: {
    alias: {
      'import-meta-resolve': path.join(
        rootDir,
        'utils/mock-import-meta-resolve.js',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['integration/**/*.{spec,test}.{js,cjs,mjs,ts,cts,mts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      'integration/**/api/tests/**',
      'integration/**/module/**',
    ],
    setupFiles: ['./utils/vitest.setup.mjs'],
    globalSetup: ['./utils/vitest.global-setup.mjs'],
    ...(frameworkParallel
      ? {
          threads: true,
          isolate: true,
          maxThreads,
          minThreads,
        }
      : {
          threads: false,
          isolate: false,
        }),
    testTimeout: 300000,
    hookTimeout: 300000,
    retry: 1,
    deps: {
      external: [/^@modern-js\//],
    },
  },
});
