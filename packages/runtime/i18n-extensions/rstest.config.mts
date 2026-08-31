import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectConfig } from '@rstest/core';
import { withTestPreset } from '@scripts/rstest-config';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const commonConfig: ProjectConfig = {
  setupFiles: [
    resolve(packageDirectory, '../../../scripts/rstest-config/setup.ts'),
  ],
  globals: true,
};

export default {
  projects: [
    withTestPreset({
      name: 'i18n-extensions-node',
      testEnvironment: 'node',
      include: ['tests/**/*.test.ts'],
      extends: commonConfig,
    }),
    withTestPreset({
      name: 'i18n-extensions-client',
      testEnvironment: 'happy-dom',
      include: ['tests/**/*.test.tsx'],
      extends: {
        ...commonConfig,
        tools: {
          swc: {
            jsc: { transform: { react: { runtime: 'automatic' } } },
          },
        },
      },
    }),
  ],
};
