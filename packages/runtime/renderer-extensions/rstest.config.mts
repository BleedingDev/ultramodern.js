import path from 'node:path';
import type { ProjectConfig } from '@rstest/core';
import { withTestPreset } from '@scripts/rstest-config';

const commonConfig: ProjectConfig = {
  root: __dirname,
  globals: true,
  setupFiles: ['@scripts/rstest-config/setup.ts'],
  resolve: {
    alias: {
      // The plugin-runtime sources under test reach their contexts through the
      // package self-reference; resolve it to the same source module the tests
      // import, as plugin-runtime's own tsconfig paths do.
      '@modern-js/runtime/context$': path.join(
        __dirname,
        '../plugin-runtime/src/core/context/index.ts',
      ),
    },
  },
  tools: {
    swc: {
      jsc: {
        transform: {
          react: {
            runtime: 'automatic',
          },
        },
      },
    },
  },
};

export default {
  projects: [
    withTestPreset({
      name: 'renderer-extensions-node',
      testEnvironment: 'node',
      extends: commonConfig,
    }),
  ],
};
