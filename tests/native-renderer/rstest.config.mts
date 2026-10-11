import path from 'node:path';
import { withTestPreset } from '../../scripts/rstest-config/src/index';

export default withTestPreset({
  root: path.resolve(
    import.meta.dirname,
    '../../packages/server/runtime-extensions',
  ),
  include: ['../../../tests/native-renderer/node-dispatch.test.ts'],
  testEnvironment: 'node',
  globals: true,
  testTimeout: 30_000,
  resolve: {
    alias: {
      '@modern-js/runtime-utils/fileReader': path.resolve(
        import.meta.dirname,
        '../../packages/toolkit/runtime-utils/src/node/fileReader.ts',
      ),
      '@modern-js/renderer-core': path.resolve(
        import.meta.dirname,
        '../../packages/runtime/renderer-core/src',
      ),
    },
  },
  output: {
    distPath: process.env.OWNED_TEMP_DIR,
    // These workspace packages must use their source exports during this gate.
    bundleDependencies: [/^@modern-js\//],
  },
});
