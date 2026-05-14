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
import { ensurePluginDataLoaderRuntimeBuilt } from '../test/pluginDataLoaderRuntime';

const projectRoot = path.resolve(__dirname, '../../..');
const tanstackMfRoot = path.join(projectRoot, 'integration/routes-tanstack-mf');
const require = createRequire(import.meta.url);
const { modernBuild } = require('../../../utils/modernTestUtils.js');
const ensureWorkspacePackages = [
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

async function ensureTanstackMfDistFixtures() {
  ensurePluginDataLoaderRuntimeBuilt();

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
      if (result.code === 0 || !output.includes('ENOTEMPTY')) {
        break;
      }
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
  test('executable SSR gap matrix records current MF route contract', () => {
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
    const ssrDataRuntime = readFixture(
      '../packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts',
    );

    const matrix = [
      {
        id: 'federated-content-ssr',
        status: 'gap-runtime-seam',
        assert: () => {
          expect(hostPage).toContain("typeof window === 'undefined'");
          expect(hostPage).toContain('id="remote-ssr-contract-gap"');
          expect(hostPage).toContain(
            'data-runtime-seam="tanstack-mf-server-remote-render"',
          );
          expect(hostPage).toContain(
            'data-expected-remotes="remote/Widget,remote/Mutator,remote2/Panel"',
          );
          expect(hostPage).toContain('id="remote-ssr-placeholder"');
          expect(hostPage).toContain('remote-widget:pending');
          expect(hostPage).toContain('id="remote-mutator-ssr-placeholder"');
          expect(hostPage).toContain('remote-mutator:pending');
          expect(hostPage).toContain('id="remote2-ssr-placeholder"');
          expect(hostPage).toContain('remote2-panel:pending');
          expect(remoteLoader).toContain('import { loadRemote }');
          expect(remoteLoader).toContain('if (typeof window ===');
          expect(remoteLoader).toContain('React.lazy');
          for (const config of [hostConfig, remoteConfig, remoteTwoConfig]) {
            expect(config).toContain("mode: 'string'");
            expect(config).toContain('moduleFederationAppSSR: true');
          }
        },
      },
      {
        id: 'tanstack-hydration-dehydrate',
        status: 'covered-runtime-surface',
        assert: () => {
          expect(tanstackServerRuntime).toContain(
            'attachRouterServerSsrUtils({',
          );
          expect(tanstackServerRuntime).toContain(
            'await (tanstackRouter as any).serverSsr?.dehydrate?.();',
          );
          expect(tanstackServerRuntime).toContain(
            'serverSsr?.takeBufferedScripts?.()',
          );
          expect(tanstackServerRuntime).toContain('hydrationScripts');
          expect(ssrDataRuntime).toContain('hydrationScript');
          expect(ssrDataRuntime).toContain('ssrDataScripts +=');
          expect(tanstackClientRuntime).toContain('(window as any).$_TSR');
          expect(tanstackClientRuntime).toContain(
            '<RouterClient router={router} />',
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
          expect(generatedRouter).toContain(
            'const baseRequest: Request | undefined =',
          );
          expect(generatedRouter).toContain(
            'context: ctx?.context?.requestContext',
          );
        },
      },
      {
        id: 'action-handoff',
        status: 'covered-generated-bridge',
        assert: () => {
          expect(hostPageData).toContain('export const action');
          expect(tanstackDataMutationRuntime).toContain('modernRouteAction');
          expect(generatedRouter).toContain(
            'import { loader as loader_1, action as action_1 }',
          );
          expect(generatedRouter).toContain('modernRouteAction: action_1');
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
            hostManifest,
            remoteManifest,
            remote2Manifest,
          ]) {
            const shared = manifest.shared as Array<{
              name: string;
              singleton?: boolean;
              requiredVersion?: string;
            }>;
            expect(shared).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  name: '@tanstack/react-router',
                  singleton: true,
                  requiredVersion: expect.any(String),
                }),
              ]),
            );
          }
        },
      },
    ];

    expect(matrix.map(row => [row.id, row.status])).toEqual([
      ['federated-content-ssr', 'gap-runtime-seam'],
      ['tanstack-hydration-dehydrate', 'covered-runtime-surface'],
      ['loader-handoff', 'covered'],
      ['action-handoff', 'covered-generated-bridge'],
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
        expect.objectContaining({ name: 'Widget', path: './Widget' }),
        expect.objectContaining({ name: 'Mutator', path: './Mutator' }),
      ]),
    );
    expect(remote2Manifest.exposes).toEqual(
      expect.arrayContaining([
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

  test('generated host tanstack router preserves loader bridge for MF routes', () => {
    const code = readFixture(
      'integration/routes-tanstack-mf/mf-host/src/modern-tanstack/index/router.gen.ts',
    );

    expect(code).toContain('function createRouteStaticData');
    expect(code).toContain('function modernLoaderToTanstack');
    expect(code).toContain('throwTanstackRedirect(location)');
    expect(code).toContain('throw notFound();');
    expect(code).toContain('route_mf_page');
    expect(code).toContain('path: "mf"');
    expect(code).toContain('createMemoryHistory');
    expect(code).toContain('const request = baseRequest');
    expect(code).toContain('const baseRequest: Request | undefined =');
    expect(code).toContain('requestContext?: unknown;');
    expect(code).toContain('context: ctx?.context?.requestContext');
    expect(code).toContain('staticData: createRouteStaticData({');
    expect(code).toContain('modernRouteId: "mf/page"');
    expect(code).toContain('modernRouteLoader: loader_1');
    expect(code).toContain('import { loader as loader_1, action as action_1 }');
    expect(code).toContain('modernRouteAction: action_1');
  });

  test('host effect boundary uses shared request-context propagation helper', () => {
    const code = readFixture(
      'integration/routes-tanstack-mf/mf-host/api/effect/index.ts',
    );

    expect(code).toContain(
      "import { createRequestContextHeaders } from '@modern-js/plugin-bff/client';",
    );
    expect(code).toContain(
      'const requestHeaders = createRequestContextHeaders({',
    );
    expect(code).toContain('locale,');
    expect(code).toContain('traceparent: syntheticTraceparent || traceparent,');
  });
});
