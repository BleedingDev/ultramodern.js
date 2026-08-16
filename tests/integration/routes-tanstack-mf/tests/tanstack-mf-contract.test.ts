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

setSuiteTimeout(1000 * 60 * 20);

const projectRoot = path.resolve(__dirname, '../../..');
const tanstackMfRoot = path.join(projectRoot, 'integration/routes-tanstack-mf');
const require = createRequire(import.meta.url);
const { modernBuild } = require('../../../utils/modernTestUtils.js');
const ensureWorkspacePackages = [
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

const readFixtureJson = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));

const reactRendererSingletons = () =>
  ['react', 'react-dom', 'react-dom/client'].map(name =>
    expect.objectContaining({ name, singleton: true }),
  );

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
      | { code: number | null; stdout?: string; stderr?: string }
      | undefined;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      fs.rmSync(path.join(appDir, 'dist'), { recursive: true, force: true });
      result = await build();
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (result.code === 0 || !isTransientWorkspaceDistRace(output)) {
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

describe('tanstack + module federation build contracts', () => {
  test('host manifest publishes remote aliases and singleton router dependencies', () => {
    const hostManifest = readFixtureJson(
      'integration/routes-tanstack-mf/mf-host/dist/mf-manifest.json',
    );

    expect(hostManifest).toMatchObject({
      id: 'tanstackHost',
      remotes: expect.arrayContaining([
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
      shared: expect.arrayContaining([
        expect.objectContaining({
          name: '@modern-js/runtime',
          singleton: true,
        }),
        expect.objectContaining({
          name: '@tanstack/react-router',
          singleton: true,
        }),
        ...reactRendererSingletons(),
      ]),
    });
  });

  test('remote manifests publish their modules and singleton router dependency', () => {
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
    for (const manifest of [remoteManifest, remote2Manifest]) {
      expect(manifest.shared).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: '@tanstack/react-router',
            singleton: true,
          }),
          ...reactRendererSingletons(),
        ]),
      );
      expect(manifest.remotes).toEqual([]);
    }
  });
});
