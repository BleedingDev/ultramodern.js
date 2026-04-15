import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

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
    exclude: ['**/node_modules/**', 'integration/**/module/**'],
    setupFiles: ['./utils/vitest.jest-compat.setup.mjs'],
    testTimeout: 300000,
    hookTimeout: 300000,
    retry: 1,
    deps: {
      external: [/^@modern-js\//],
    },
  },
});
