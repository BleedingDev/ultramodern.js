import { defineConfig } from 'vitest/config';
import frameworkConfig from './vitest.framework.config.mjs';

export default defineConfig({
  ...frameworkConfig,
  test: {
    ...frameworkConfig.test,
    // Effect fixtures spawn Modern dev/prod servers and write generated app
    // artifacts while assertions are running. Keep this suite file-serial to
    // avoid cross-fixture races in generated BFF/runtime outputs.
    threads: false,
    isolate: false,
    fileParallelism: false,
    maxThreads: 1,
    minThreads: 1,
    maxWorkers: 1,
    minWorkers: 1,
    include: [
      'integration/bff-effect/tests/index.test.ts',
      'integration/bff-effect-lambda-only/tests/index.test.ts',
      'integration/bff-runtime-parity/tests/index.test.ts',
      'integration/bff-runtime-parity/tests/effect-only-data-platform.test.ts',
    ],
  },
});
