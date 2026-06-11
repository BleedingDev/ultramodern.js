import fs from 'fs';
import path from 'path';

const pnpmRoot = path.join(__dirname, '../../../node_modules/.pnpm');

// Resolve a dependency straight out of the pnpm store: this package was
// removed from the workspace upstream (#7416) but its fork-retained tests
// still run through the root rstest sweep, so nothing is linked into a
// local node_modules. Missing entries must NOT throw at config-load time:
// the root sweep loads every project config eagerly and a single throw
// would abort the entire repo-wide run.
function resolvePnpmPackageEntry(
  prefix: string,
  modulePath: string,
): string | null {
  const entry = fs
    .readdirSync(pnpmRoot)
    .sort()
    .find(name => name.startsWith(prefix));

  if (!entry) {
    return null;
  }

  return path.join(pnpmRoot, entry, 'node_modules', modulePath);
}

function definedAliases(
  aliases: Record<string, string | null>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(aliases).filter(
      (pair): pair is [string, string] => pair[1] !== null,
    ),
  );
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
    alias: definedAliases({
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
      // `@modern-js/core` no longer exists anywhere in the lockfile
      // (removed upstream in #7373); the tests rely on a local shim that
      // recreates the legacy plugin-manager surface they consume.
      '@modern-js/core': path.join(__dirname, 'tests/shims/modern-js-core.ts'),
      'hoist-non-react-statics': resolvePnpmPackageEntry(
        'hoist-non-react-statics@',
        'hoist-non-react-statics/dist/hoist-non-react-statics.cjs.js',
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
    }),
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
