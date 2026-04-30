import fs from 'fs';
/**
 * @jest-environment node
 */
import { createRequire } from 'module';
import path from 'path';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';

const projectRoot = path.resolve(__dirname, '../../..');
const tanstackMfRoot = path.join(projectRoot, 'integration/routes-tanstack-mf');
const require = createRequire(import.meta.url);
const { modernBuild } = require('../../../utils/modernTestUtils.js');
const ensureWorkspacePackages = [
  '@modern-js/create-request',
  '@modern-js/bff-core',
  '@modern-js/runtime',
  '@modern-js/plugin-bff',
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
  for (const appName of ['mf-host', 'mf-remote', 'mf-remote-2']) {
    const result = await modernBuild(path.join(tanstackMfRoot, appName), [], {
      ensureWorkspacePackages,
      env: defaultFederatedEnv,
    });

    if (result.code !== 0) {
      throw new Error(
        `Failed to build routes-tanstack-mf fixture ${appName}.\n` +
          `${result.stdout || ''}\n${result.stderr || ''}`,
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
