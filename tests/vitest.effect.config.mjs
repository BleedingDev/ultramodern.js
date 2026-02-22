import { defineConfig } from 'vitest/config';
import frameworkConfig from './vitest.framework.config.mjs';

export default defineConfig({
  ...frameworkConfig,
  test: {
    ...frameworkConfig.test,
    include: [
      'integration/bff-effect/tests/index.test.ts',
      'integration/bff-effect-lambda-only/tests/index.test.ts',
      'integration/bff-runtime-parity/tests/index.test.ts',
      'integration/bff-runtime-parity/tests/effect-only-data-platform.test.ts',
    ],
  },
});
