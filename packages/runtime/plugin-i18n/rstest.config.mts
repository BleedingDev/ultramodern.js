import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectConfig } from '@rstest/core';
import { withTestPreset } from '@scripts/rstest-config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commonConfig: ProjectConfig = {
  setupFiles: [resolve(__dirname, '../../../scripts/rstest-config/setup.ts')],
  globals: true,
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
      name: 'plugin-i18n-node',
      testEnvironment: 'node',
      include: ['tests/localisedUrls.test.ts'],
      extends: commonConfig,
    }),
    withTestPreset({
      name: 'plugin-i18n-client',
      testEnvironment: 'happy-dom',
      include: ['tests/routerAdapter.test.tsx'],
      extends: commonConfig,
    }),
  ],
};
