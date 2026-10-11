import path from 'node:path';
import { withTestPreset } from '../../../scripts/rstest-config/src/index';

const common = {
  root: __dirname,
  globals: true,
  resolve: {
    alias: {
      '@modern-js/utils/lodash': path.resolve(
        __dirname,
        '../../../packages/toolkit/utils/compiled/lodash/index.js',
      ),
      '@modern-js/utils/universal/constants': path.resolve(
        __dirname,
        '../../../packages/toolkit/utils/src/universal/constants.ts',
      ),
      '@modern-js/utils/universal': path.resolve(
        __dirname,
        '../../../packages/toolkit/utils/src/universal/index.ts',
      ),
      '@modern-js/utils': path.resolve(
        __dirname,
        '../../../packages/toolkit/utils/src/index.ts',
      ),
      '@modern-js/runtime-utils/browser': path.resolve(
        __dirname,
        '../../../packages/toolkit/runtime-utils/src/browser/index.ts',
      ),
      '@tanstack/react-router': path.resolve(
        __dirname,
        '../../../packages/runtime/plugin-tanstack/node_modules/@tanstack/react-router',
      ),
    },
  },
  tools: {
    swc: { jsc: { transform: { react: { runtime: 'automatic' as const } } } },
  },
};

export default withTestPreset({
  root: __dirname,
  projects: [
    {
      ...common,
      name: 'renderer-react-wire-goldens',
      testEnvironment: 'node',
      include: ['react-wire.test.ts', 'client-data-compilation.test.ts'],
    },
    {
      ...common,
      name: 'renderer-react-native-actions',
      testEnvironment: 'happy-dom',
      include: ['react-native-actions.test.ts'],
    },
  ],
});
