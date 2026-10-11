import path from 'node:path';
import { withTestPreset } from '../../scripts/rstest-config/src/index';

export default withTestPreset({
  root: path.resolve(
    import.meta.dirname,
    '../../packages/server/runtime-extensions',
  ),
  include: [
    '../../../packages/solutions/ultramodern-app-tools/tests/native-composition/native-development-provider.test.ts',
  ],
  testEnvironment: 'node',
  globals: true,
  testTimeout: 10_000,
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
      '@modern-js/renderer-solid/manifest': path.resolve(
        import.meta.dirname,
        '../../packages/runtime/renderer-solid/src/manifest.ts',
      ),
      '@modern-js/renderer-octane/manifest': path.resolve(
        import.meta.dirname,
        '../../packages/runtime/renderer-octane/src/manifest.ts',
      ),
    },
  },
  output: {
    distPath: process.env.OWNED_TEMP_DIR,
    bundleDependencies: [/^@modern-js\//],
  },
});
