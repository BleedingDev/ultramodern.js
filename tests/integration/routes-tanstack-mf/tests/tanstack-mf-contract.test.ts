/**
 * @jest-environment node
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { ensurePluginDataLoaderRuntimeBuilt } from '../test/pluginDataLoaderRuntime';

// The beforeAll queues on the routes-tanstack-mf fixture lock (shared with
// the dev/serve/deploy suites, which hold it for up to 10 minutes) before
// rebuilding all three federated apps.
setSuiteTimeout(1000 * 60 * 20);

const projectRoot = path.resolve(__dirname, '../../..');
const tanstackMfRoot = path.join(projectRoot, 'integration/routes-tanstack-mf');
const require = createRequire(import.meta.url);
const { modernBuild } = require('../../../utils/modernTestUtils.js');
const ensureWorkspacePackages = [
  // app-tools' emitted ts-paths-loader.mjs imports @modern-js/utils from a
  // loader thread at build startup; keep it in the pre-spawn completeness
  // probe so a missing dist tree fails loudly before spawning.
  '@modern-js/utils',
  '@modern-js/plugin',
  '@modern-js/i18n-utils',
  '@modern-js/server-core',
  '@modern-js/server-utils',
  '@modern-js/server',
  '@modern-js/prod-server',
  '@modern-js/app-tools',
  '@modern-js/create-request',
  '@modern-js/bff-core',
  '@modern-js/runtime',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-tanstack',
];
const defaultFederatedEnv = {
  MF_REMOTE_PORT: '3010',
  MF_REMOTE_TWO_PORT: '3012',
  MF_HOST_PORT: '3011',
  MF_HOST_ORIGIN: 'http://localhost:3011',
  MF_REMOTE_ORIGIN: 'http://localhost:3010',
};

let releaseFixtureLock: ReleaseFixtureLock | undefined;

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const readFixtureJson = (relativePath: string) =>
  JSON.parse(readFixture(relativePath));

const listDistJsFiles = (appName: string) => {
  const distDir = path.join(tanstackMfRoot, appName, 'dist');
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.relative(distDir, fullPath));
      }
    }
  };

  visit(distDir);
  return files;
};

type PackageJsonWithDependencies = {
  dependencies?: Record<string, string>;
};

type MfSharedEntry = {
  name: string;
  singleton?: boolean;
  version?: string;
  requiredVersion?: string;
};

const readTanstackRouterDependency = (appName: string) => {
  const packageJson = readFixtureJson(
    `integration/routes-tanstack-mf/${appName}/package.json`,
  ) as PackageJsonWithDependencies;
  const version = packageJson.dependencies?.['@tanstack/react-router'];
  if (!version) {
    throw new Error(`${appName} is missing @tanstack/react-router`);
  }
  return version;
};

// ENOTEMPTY: transient fs race while replacing the fixture's own dist.
// ERR_MODULE_NOT_FOUND on a workspace dist path: an external writer (e.g. an
// overlapping `pnpm run prepare-build` nx cache restore) rewrote a
// packages/*/dist tree under the spawned build. In-harness rebuilds are
// already serialized via the workspace dist read/write locks, so this retry
// only covers writers the harness cannot coordinate with.
const isTransientWorkspaceDistRace = (output: string) =>
  output.includes('ENOTEMPTY') ||
  (output.includes('ERR_MODULE_NOT_FOUND') &&
    /packages[/\\][^'"\n]*[/\\]dist[/\\]/.test(output));

async function ensureTanstackMfDistFixtures() {
  await ensurePluginDataLoaderRuntimeBuilt();

  for (const appName of ['mf-host', 'mf-remote', 'mf-remote-2']) {
    const appDir = path.join(tanstackMfRoot, appName);
    const build = () =>
      modernBuild(appDir, [], {
        ensureWorkspacePackages,
        env: defaultFederatedEnv,
      });
    let result:
      | {
          code: number | null;
          stdout?: string;
          stderr?: string;
        }
      | undefined;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      fs.rmSync(path.join(appDir, 'dist'), {
        recursive: true,
        force: true,
      });
      result = await build();
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (result.code === 0 || !isTransientWorkspaceDistRace(output)) {
        break;
      }
      console.warn(
        `[tanstack-mf-contract] RETRYING ${appName} build (attempt ${
          attempt + 1
        }/4): detected a transient workspace dist race (a packages/*/dist ` +
          'tree was rewritten while the build was running — likely an ' +
          'overlapping prepare-build/nx cache restore). Failure output:\n' +
          output,
      );
    }

    if (!result || result.code !== 0) {
      throw new Error(
        `Failed to build routes-tanstack-mf fixture ${appName}.\n` +
          `${result?.stdout || ''}\n${result?.stderr || ''}`,
      );
    }
  }
}

beforeAll(async () => {
  releaseFixtureLock = await acquireFixtureLock(tanstackMfRoot);
  await ensureTanstackMfDistFixtures();
});

afterAll(async () => {
  await releaseFixtureLock?.();
});

describe('tanstack + module federation contracts', () => {
  test('executable SSR fallback matrix records official MF route contract', () => {
    const hostPage = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/routes/mf/page.tsx',
    );
    const hostConfig = readFixture(
      'integration/routes-tanstack-mf/mf-host/modern.config.ts',
    );
    const remoteConfig = readFixture(
      'integration/routes-tanstack-mf/mf-remote/modern.config.ts',
    );
    const remoteTwoConfig = readFixture(
      'integration/routes-tanstack-mf/mf-remote-2/modern.config.ts',
    );
    const hostPageData = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/routes/mf/page.data.ts',
    );
    const remoteLoader = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/routes/mf/remoteLoader.tsx',
    );
    const remoteSsrFallback = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/routes/mf/remoteSsrFallback.ts',
    );
    const generatedRouter = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/modern-tanstack/index/router.gen.ts',
    );
    const tanstackServerRuntime = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx',
    );
    const tanstackClientRuntime = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/plugin.tsx',
    );
    const tanstackDataMutationRuntime = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/dataMutation.tsx',
    );
    const tanstackSubmitActionRuntime = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/submitAction.ts',
    );
    const loaderBridgeRuntime = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/loaderBridge.ts',
    );
    const ssrDataRuntime = readFixture(
      '../packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts',
    );

    const matrix = [
      {
        id: 'federated-content-ssr',
        status: 'official-typed-fallback',
        assert: () => {
          expect(hostPage).toContain('const [clientReady, setClientReady]');
          expect(hostPage).toContain('setClientReady(true)');
          expect(hostPage).toContain('{!clientReady ? (');
          expect(hostPage).toContain('id="remote-ssr-fallback-contract"');
          expect(hostPage).toContain('data-ssr-contract=');
          expect(hostPage).toContain(
            'data-runtime-boundary="tanstack-mf-client-hydration"',
          );
          expect(hostPage).toContain(
            'data-expected-remotes="remote/Widget,remote/Mutator,remote2/Panel"',
          );
          expect(hostPage).toContain(
            'data-fallback-metadata-id="remote-ssr-fallback-metadata"',
          );
          expect(hostPage).toContain('data-hydration-owner="client"');
          expect(hostPage).toContain('id="remote-ssr-fallback-metadata"');
          expect(hostPage).toContain(
            'REMOTE_SSR_FALLBACK_METADATA.remotes.map',
          );
          expect(remoteSsrFallback).toContain(
            'export type RemoteSsrFallbackDescriptor',
          );
          expect(remoteSsrFallback).toContain(
            'contract: RemoteSsrFallbackContract',
          );
          expect(remoteSsrFallback).toContain(
            "runtimeBoundary: 'tanstack-mf-client-hydration'",
          );
          expect(remoteSsrFallback).toContain("strategy: 'client-hydration'");
          expect(remoteSsrFallback).toContain("reason: 'remote-unavailable'");
          expect(remoteSsrFallback).toContain(
            "classification: 'remote-unavailable'",
          );
          expect(remoteSsrFallback).toContain(
            "telemetryEvent: 'mf.ssr.remote.fallback'",
          );
          for (const classification of [
            'remote-unavailable',
            'timeout',
            'network',
            'contract',
            'version-skew',
          ]) {
            expect(remoteSsrFallback).toContain(`'${classification}'`);
          }
          expect(remoteSsrFallback).toContain("id: 'remote/Widget'");
          expect(remoteSsrFallback).toContain(
            "placeholderId: 'remote-ssr-placeholder'",
          );
          expect(hostPage).toContain('remote-widget:pending');
          expect(remoteSsrFallback).toContain("id: 'remote/Mutator'");
          expect(remoteSsrFallback).toContain(
            "placeholderId: 'remote-mutator-ssr-placeholder'",
          );
          expect(hostPage).toContain('remote-mutator:pending');
          expect(remoteSsrFallback).toContain("id: 'remote2/Panel'");
          expect(remoteSsrFallback).toContain(
            "placeholderId: 'remote2-ssr-placeholder'",
          );
          expect(hostPage).toContain('remote2-panel:pending');
          expect(remoteLoader).toContain('import { loadRemote }');
          expect(remoteLoader).toContain(
            "from '@modern-js/runtime/module-federation'",
          );
          expect(remoteLoader).toContain('if (typeof window ===');
          expect(remoteLoader).toContain('React.lazy');
          expect(remoteLoader).toContain('classifyRemoteLoadFailure');
          expect(remoteLoader).toContain(
            'toModuleFederationFallbackAttributes(telemetry)',
          );
          expect(remoteLoader).toContain(
            'emitModuleFederationFallbackTelemetry',
          );
          expect(remoteLoader).toContain("appName: 'routes-tanstack-mf-host'");
          expect(remoteLoader).toContain("mode === 'version-skew'");
          for (const config of [hostConfig, remoteConfig, remoteTwoConfig]) {
            expect(config).toContain("mode: 'stream'");
            expect(config).toContain('moduleFederationAppSSR: true');
          }
          expect(listDistJsFiles('mf-host').length).toBeGreaterThan(1);
        },
      },
      {
        id: 'tanstack-hydration-dehydrate',
        status: 'covered-runtime-surface',
        assert: () => {
          expect(tanstackServerRuntime).toContain(
            'await attachServerSsrUtils(serverRouter);',
          );
          expect(tanstackServerRuntime).toContain(
            'await serverRouter.serverSsr?.dehydrate?.();',
          );
          expect(tanstackServerRuntime).toContain(
            'serverSsr?.takeBufferedScripts?.()',
          );
          expect(tanstackServerRuntime).toContain('hydrationScripts');
          expect(ssrDataRuntime).toContain('hydrationScript');
          expect(ssrDataRuntime).toContain('ssrDataScripts +=');
          expect(tanstackClientRuntime).toContain(
            'Boolean((window as WindowWithTanstackSsr).$_TSR)',
          );
          expect(tanstackClientRuntime).toContain(
            '<ModernRouterClient router={router} />',
          );
        },
      },
      {
        id: 'loader-handoff',
        status: 'covered',
        assert: () => {
          expect(generatedRouter).toContain(
            'loader: modernLoaderToTanstack({ hasSplat: false }, loader_1)',
          );
          expect(generatedRouter).toContain('modernRouteLoader: loader_1');
          // The request/context handoff lives in the shared loader bridge
          // imported from the package runtime (not inlined per app).
          expect(generatedRouter).toMatch(
            /import \{[^}]*\bmodernLoaderToTanstack\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
          );
          expect(loaderBridgeRuntime).toContain(
            'const baseRequest: Request | undefined =',
          );
          expect(loaderBridgeRuntime).toContain(
            'context: ctx?.context?.requestContext',
          );
        },
      },
      {
        id: 'action-handoff',
        status: 'covered-generated-bridge',
        assert: () => {
          expect(hostPageData).toContain('export const action');
          expect(tanstackDataMutationRuntime).toContain(
            "import { submitRouteAction } from './submitAction';",
          );
          expect(tanstackSubmitActionRuntime).toContain(
            'routeStaticData?.modernRouteAction',
          );
          expect(generatedRouter).toContain(
            'import { loader as loader_1, action as action_1 }',
          );
          expect(generatedRouter).toContain('modernRouteAction: action_1');
        },
      },
      {
        id: 'redirect-not-found-handoff',
        status: 'covered-generated-and-runtime',
        assert: () => {
          expect(generatedRouter).toContain(
            'import { loader as loader_2 } from "../../routes/mf-not-found/page.data";',
          );
          expect(generatedRouter).toContain(
            'import { loader as loader_3 } from "../../routes/mf-redirect/page.data";',
          );
          expect(generatedRouter).toContain('route_mfNotFound_page');
          expect(generatedRouter).toContain('path: "mf-not-found"');
          expect(generatedRouter).toContain(
            'modernRouteId: "mf-not-found/page"',
          );
          expect(generatedRouter).toContain('route_mfRedirect_page');
          expect(generatedRouter).toContain('path: "mf-redirect"');
          expect(generatedRouter).toContain(
            'modernRouteId: "mf-redirect/page"',
          );
          // Redirect/notFound translation is performed by the shared loader
          // bridge the generated router imports from the package runtime.
          expect(loaderBridgeRuntime).toContain(
            'throwTanstackRedirect(location)',
          );
          expect(loaderBridgeRuntime).toContain('throw notFound();');
        },
      },
      {
        id: 'remote-fallback',
        status: 'covered',
        assert: () => {
          expect(remoteLoader).toContain('RemoteErrorBoundary');
          expect(remoteLoader).toContain('RemoteLoadError');
          expect(remoteLoader).toContain('RemoteComponentContractError');
          expect(remoteLoader).toContain('mfRemoteFailure');
          expect(remoteLoader).toContain('remote: RemoteModuleKey');
          expect(remoteLoader).toContain('remote-load-error:');
        },
      },
      {
        id: 'version-skew',
        status: 'covered-manifest-contract',
        assert: () => {
          const hostManifest = readFixtureJson(
            'integration/routes-tanstack-mf/mf-host/dist/mf-manifest.json',
          );
          const remoteManifest = readFixtureJson(
            'integration/routes-tanstack-mf/mf-remote/dist/mf-manifest.json',
          );
          const remote2Manifest = readFixtureJson(
            'integration/routes-tanstack-mf/mf-remote-2/dist/mf-manifest.json',
          );
          const hostShared = hostManifest.shared as Array<{
            name: string;
            singleton?: boolean;
            requiredVersion?: string;
          }>;
          expect(hostShared).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: '@modern-js/runtime',
                singleton: true,
                requiredVersion: expect.any(String),
              }),
            ]),
          );
          for (const manifest of [
            [hostManifest, 'mf-host'],
            [remoteManifest, 'mf-remote'],
            [remote2Manifest, 'mf-remote-2'],
          ] as const) {
            const [manifestJson, appName] = manifest;
            const expectedVersion = readTanstackRouterDependency(appName);
            const shared = manifestJson.shared as MfSharedEntry[];
            expect(shared).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  name: '@tanstack/react-router',
                  singleton: true,
                  version: expectedVersion,
                  requiredVersion: expectedVersion,
                }),
              ]),
            );
          }
        },
      },
    ];

    expect(matrix.map(row => [row.id, row.status])).toEqual([
      ['federated-content-ssr', 'official-typed-fallback'],
      ['tanstack-hydration-dehydrate', 'covered-runtime-surface'],
      ['loader-handoff', 'covered'],
      ['action-handoff', 'covered-generated-bridge'],
      ['redirect-not-found-handoff', 'covered-generated-and-runtime'],
      ['remote-fallback', 'covered'],
      ['version-skew', 'covered-manifest-contract'],
    ]);

    for (const row of matrix) {
      row.assert();
    }
  });

  test('host manifest keeps remote aliases and shared tanstack runtime contracts', () => {
    const hostManifest = readFixtureJson(
      'integration/routes-tanstack-mf/mf-host/dist/mf-manifest.json',
    );

    expect(hostManifest.id).toBe('tanstackHost');
    expect(hostManifest.remotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'remote',
          federationContainerName: 'tanstackRemote',
          entry: 'http://localhost:3010/mf-manifest.json',
        }),
        expect.objectContaining({
          alias: 'remote2',
          federationContainerName: 'tanstackRemote2',
          entry: 'http://localhost:3012/mf-manifest.json',
        }),
      ]),
    );

    const sharedNames = hostManifest.shared.map(
      (item: { name: string }) => item.name,
    );
    expect(sharedNames).toEqual(
      expect.arrayContaining(['@modern-js/runtime', '@tanstack/react-router']),
    );
  });

  test('remote manifests expose federated modules and share tanstack router singleton', () => {
    const remoteManifest = readFixtureJson(
      'integration/routes-tanstack-mf/mf-remote/dist/mf-manifest.json',
    );
    const remote2Manifest = readFixtureJson(
      'integration/routes-tanstack-mf/mf-remote-2/dist/mf-manifest.json',
    );

    expect(remoteManifest.exposes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'App', path: './App' }),
        expect.objectContaining({ name: 'Widget', path: './Widget' }),
        expect.objectContaining({ name: 'Mutator', path: './Mutator' }),
      ]),
    );
    expect(remote2Manifest.exposes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'App', path: './App' }),
        expect.objectContaining({ name: 'Panel', path: './Panel' }),
      ]),
    );

    const remoteShared = remoteManifest.shared.map(
      (item: { name: string }) => item.name,
    );
    const remote2Shared = remote2Manifest.shared.map(
      (item: { name: string }) => item.name,
    );
    expect(remoteShared).toContain('@tanstack/react-router');
    expect(remote2Shared).toContain('@tanstack/react-router');
    expect(remoteManifest.remotes).toEqual([]);
    expect(remote2Manifest.remotes).toEqual([]);
  });

  test('remotes keep native router primitives in their own runtime modules', () => {
    const remoteRoute = readFixture(
      'integration/routes-tanstack-mf/mf-remote/src/routes/layout.tsx',
    );
    const remoteTwoRoute = readFixture(
      'integration/routes-tanstack-mf/mf-remote-2/src/routes/layout.tsx',
    );
    const remoteBridge = readFixture(
      'integration/routes-tanstack-mf/mf-remote/src/components/RuntimeApp.tsx',
    );
    const remoteTwoBridge = readFixture(
      'integration/routes-tanstack-mf/mf-remote-2/src/components/RuntimeApp.tsx',
    );
    const hostRemoteApps = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/routes/mf/remoteRuntimeApps.tsx',
    );
    const remoteMfConfig = readFixture(
      'integration/routes-tanstack-mf/mf-remote/module-federation.config.ts',
    );
    const remoteTwoMfConfig = readFixture(
      'integration/routes-tanstack-mf/mf-remote-2/module-federation.config.ts',
    );

    for (const remoteRouteModule of [remoteRoute, remoteTwoRoute]) {
      expect(remoteRouteModule).toContain(
        "'@modern-js/plugin-tanstack/runtime'",
      );
      expect(remoteRouteModule).toContain('useRouterState');
      expect(remoteRouteModule).toContain('<Link');
      expect(remoteRouteModule).toContain('data-router-realm=');
    }
    for (const remoteAppBridge of [remoteBridge, remoteTwoBridge]) {
      expect(remoteAppBridge).toContain("import '@modern-js/runtime/registry'");
      expect(remoteAppBridge).toContain('createBridgeComponent');
      expect(remoteAppBridge).toContain('createNestedAppRenderer');
      expect(remoteAppBridge).toContain(
        'const renderNestedApp = createNestedAppRenderer()',
      );
      expect(remoteAppBridge).toContain('const ModernRoot = createRoot()');
    }
    expect(hostRemoteApps).toContain('createRemoteAppComponent');
    expect(hostRemoteApps).toContain("'remote/App'");
    expect(hostRemoteApps).toContain("'remote2/App'");

    // The router core remains the MF bridge, while each remote keeps its
    // entry-owned Modern TanStack runtime wrapper instead of sharing it.
    expect(remoteMfConfig).not.toContain(
      "'@modern-js/plugin-tanstack/runtime'",
    );
    expect(remoteTwoMfConfig).not.toContain(
      "'@modern-js/plugin-tanstack/runtime'",
    );
  });

  test('committed host federation types are explicit goldens for exposed remotes', () => {
    const readMfType = (relativePath: string) =>
      readFixture(
        `integration/routes-tanstack-mf/mf-host/@mf-types/${relativePath}`,
      );

    const goldenReadme = readMfType('README.md');
    const rootTypes = readMfType('index.d.ts');
    const remoteApis = readMfType('remote/apis.d.ts');
    const remote2Apis = readMfType('remote2/apis.d.ts');

    expect(goldenReadme).toContain('intentionally committed test data');
    expect(rootTypes).toContain('declare module "@module-federation/runtime"');
    expect(rootTypes).toContain(
      'declare module "@module-federation/enhanced/runtime"',
    );
    expect(rootTypes).toContain(
      'declare module "@module-federation/runtime-tools"',
    );
    expect(rootTypes).toContain(
      'declare module "@module-federation/modern-js-v3/runtime"',
    );
    expect(remoteApis).toContain("'remote/App'");
    expect(remoteApis).toContain("'remote/Widget'");
    expect(remoteApis).toContain("'remote/Mutator'");
    expect(remoteApis).toContain(
      "T extends 'remote/App' ? typeof import('remote/App')",
    );
    expect(remoteApis).toContain(
      "T extends 'remote/Mutator' ? typeof import('remote/Mutator')",
    );
    expect(remoteApis).toContain(
      "T extends 'remote/Widget' ? typeof import('remote/Widget')",
    );
    expect(remote2Apis).toContain("'remote2/App'");
    expect(remote2Apis).toContain("'remote2/Panel'");
    expect(remote2Apis).toContain(
      "T extends 'remote2/App' ? typeof import('remote2/App')",
    );
    expect(remote2Apis).toContain(
      "T extends 'remote2/Panel' ? typeof import('remote2/Panel')",
    );

    for (const [publicModule, compiledType] of [
      ['remote/App.d.ts', './compiled-types/src/components/RuntimeApp'],
      ['remote/Widget.d.ts', './compiled-types/src/components/Widget'],
      ['remote/Mutator.d.ts', './compiled-types/src/components/Mutator'],
      ['remote2/App.d.ts', './compiled-types/src/components/RuntimeApp'],
      ['remote2/Panel.d.ts', './compiled-types/src/components/Panel'],
    ]) {
      const moduleTypes = readMfType(publicModule);
      expect(moduleTypes).toContain(`export * from '${compiledType}';`);
      expect(moduleTypes).toContain(
        `export { default } from '${compiledType}';`,
      );
    }
  });

  test('generated host tanstack router preserves loader bridge for MF routes', () => {
    const code = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/modern-tanstack/index/router.gen.ts',
    );
    const loaderBridge = readFixture(
      '../packages/runtime/plugin-tanstack/src/runtime/loaderBridge.ts',
    );

    // The bridge helpers are imported from the package runtime instead of
    // being inlined into every generated router.
    expect(code).toMatch(
      /import \{[^}]*\bmodernLoaderToTanstack\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
    );
    expect(code).toMatch(
      /import \{[^}]*\bcreateRouteStaticData\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
    );
    expect(code).not.toContain('function modernLoaderToTanstack');
    expect(code).not.toContain('function createRouteStaticData');

    expect(code).toContain('route_mf_page');
    expect(code).toContain('path: "mf"');
    expect(code).toContain('route_mfNotFound_page');
    expect(code).toContain('path: "mf-not-found"');
    expect(code).toContain('route_mfRedirect_page');
    expect(code).toContain('path: "mf-redirect"');
    expect(code).toContain('history: createMemoryHistory({');
    expect(code).toContain('staticData: createRouteStaticData({');
    expect(code).toContain('modernRouteId: "mf/page"');
    expect(code).toContain('modernRouteLoader: loader_1');
    expect(code).toContain('import { loader as loader_1, action as action_1 }');
    expect(code).toContain('modernRouteAction: action_1');

    // Request construction, context handoff, and redirect/notFound mapping
    // live in the shared bridge module.
    expect(loaderBridge).toContain('const baseRequest: Request | undefined =');
    expect(loaderBridge).toContain('new Request(baseRequest, { signal })');
    expect(loaderBridge).toContain('requestContext?: unknown;');
    expect(loaderBridge).toContain('context: ctx?.context?.requestContext');
    expect(loaderBridge).toContain('throwTanstackRedirect(location)');
    expect(loaderBridge).toContain('throw notFound();');
  });

  test('effect entries consume typed shared API contracts without JavaScript substitutes', () => {
    for (const appName of ['mf-host', 'mf-remote', 'mf-remote-2']) {
      const sharedFixtureRoot = path.join(
        tanstackMfRoot,
        appName,
        'shared/effect',
      );
      const effectEntry = readFixture(
        `integration/routes-tanstack-mf/${appName}/api/effect/index.ts`,
      );

      expect(fs.existsSync(path.join(sharedFixtureRoot, 'api.ts'))).toBe(true);
      expect(fs.existsSync(path.join(sharedFixtureRoot, 'api.mjs'))).toBe(
        false,
      );
      expect(effectEntry).toContain("from '../../shared/effect/api';");
    }
  });

  test('host effect boundary propagates the active OpenTelemetry span', () => {
    const code = readFixture(
      'integration/routes-tanstack-mf/mf-host/api/effect/index.ts',
    );
    const integrationTest = readFixture(
      'integration/routes-tanstack-mf/test/index.test.ts',
    );

    expect(code).toContain(
      "import { createRequestContextHeaders } from '@modern-js/plugin-bff/client';",
    );
    expect(code).toContain(
      'const requestHeaders = createRequestContextHeaders({',
    );
    expect(code).toContain('locale,');
    expect(code).toContain(
      'const currentSpan = yield* Effect.currentSpan.pipe(Effect.orDie);',
    );
    expect(code).toContain('traceparent: toTraceparentHeader(currentSpan),');
    expect(code).toContain('traceparent: remoteBody.traceparent,');
    expect(code.match(/traceSpans\.push\(/g)).toHaveLength(1);
    expect(code).not.toContain('synthetic');
    expect(code).not.toContain("from 'node:crypto'");

    expect(integrationTest).not.toContain('waitForTraceSpansWithFallback');
    expect(integrationTest).not.toContain('strictTracePropagation');
    expect(integrationTest).toContain(
      'expect(remoteRunSpan.parentSpanId).toBe(hostRemoteCallSpan.spanId);',
    );
    expect(integrationTest).toContain(
      `\`00-\${trace.traceId}-\${hostRemoteCallSpan.spanId}-01\``,
    );
  });
});
