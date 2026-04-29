import fs from 'fs';
import path from 'path';

const pnpmRoot = path.join(__dirname, '../../../node_modules/.pnpm');

function resolvePnpmPackageEntry(prefix: string, modulePath: string) {
  const entry = fs
    .readdirSync(pnpmRoot)
    .sort()
    .find(name => name.startsWith(prefix));

  if (!entry) {
    throw new Error(`Failed to resolve pnpm package entry for ${prefix}`);
  }

  return path.join(pnpmRoot, entry, 'node_modules', modulePath);
}

const commonConfig = {
  root: __dirname,
  globals: true,
  passWithNoTests: true,
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.{idea,git,cache,output,temp}/**',
    '**/dist/.rstest-temp',
  ],
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
  resolve: {
    alias: {
      debug: path.join(__dirname, 'tests/shims/debug.ts'),
      garfish: path.join(__dirname, 'tests/shims/garfish.ts'),
      '@modern-js/utils': path.join(
        __dirname,
        'tests/shims/modern-js-utils.ts',
      ),
      '@modern-js/utils/webpack-chain': path.join(
        __dirname,
        '../../toolkit/utils/compiled/webpack-chain/index.js',
      ),
      'hoist-non-react-statics': resolvePnpmPackageEntry(
        'hoist-non-react-statics@',
        'hoist-non-react-statics/dist/hoist-non-react-statics.cjs.js',
      ),
      '@modern-js/core': resolvePnpmPackageEntry(
        '@modern-js+core@',
        '@modern-js/core/dist/index.js',
      ),
      react: resolvePnpmPackageEntry('react@', 'react/index.js'),
      'react/jsx-runtime': resolvePnpmPackageEntry(
        'react@',
        'react/jsx-runtime.js',
      ),
      'react/jsx-dev-runtime': resolvePnpmPackageEntry(
        'react@',
        'react/jsx-dev-runtime.js',
      ),
      'react-dom': resolvePnpmPackageEntry('react-dom@', 'react-dom/index.js'),
      'react-dom/client': resolvePnpmPackageEntry(
        'react-dom@',
        'react-dom/client.js',
      ),
    },
  },
};

export default {
  projects: [
    {
      name: 'plugin-garfish-node',
      ...commonConfig,
      testEnvironment: 'node',
      include: [
        'tests/cachePolicy.test.ts',
        'tests/compatibility.test.ts',
        'tests/reliabilityMatrix.test.ts',
        'tests/trust.test.ts',
      ],
    },
    {
      name: 'plugin-garfish-client',
      ...commonConfig,
      testEnvironment: 'happy-dom',
      include: [
        'tests/cli.test.tsx',
        'tests/fallbackTelemetry.test.ts',
        'tests/runtimePlugin.test.tsx',
        'tests/runtimeExport.test.tsx',
      ],
    },
  ],
};
