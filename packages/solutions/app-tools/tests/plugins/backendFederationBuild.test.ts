import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emitBackendFederationArtifacts } from '../../src/plugins/backendFederationBuild';

const tempDirectories: string[] = [];

const createTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-backend-mf-'));
  tempDirectories.push(dir);
  return dir;
};

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(dir => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('backend federation build artifacts', () => {
  it('emits backend manifest and remote entry for generated vertical apps', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'shared/ultramodern-build.ts'),
      [
        'export const ultramodernVerticalIdentity = {',
        "  appId: 'explore',",
        "  build: 'tractor-explore-build-1234',",
        "  packageName: '@tractor-store-vertical-demo/explore',",
        "  version: '0.1.0',",
        '} as const;',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(appDirectory, 'backend-federation.config.ts'),
      'export default {};\n',
    );
    await writeJson(path.join(workspaceRoot, '.modernjs/ultramodern.json'), {
      topology: {
        apps: [
          {
            id: 'explore',
            kind: 'vertical',
            package: '@tractor-store-vertical-demo/explore',
            path: 'verticals/explore',
            port: 3021,
            api: {
              prefix: '/explore-api',
              stem: 'explore',
            },
            moduleFederation: {
              name: 'verticalExplore',
              manifestUrl: 'http://localhost:3021/mf-manifest.json',
            },
            backendFederation: {
              name: 'verticalExploreBackend',
              versionBoundary: {
                ui: {
                  manifestUrl: 'http://localhost:3021/mf-manifest.json',
                },
              },
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
                  containerEntry:
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
                },
              },
            },
          },
        ],
      },
    });

    const result = await emitBackendFederationArtifacts(
      appDirectory,
      distDirectory,
    );

    expect(result).toEqual(
      expect.objectContaining({
        appId: 'explore',
        remoteName: 'verticalExploreBackend',
        remoteType: 'module',
      }),
    );
    const manifest = JSON.parse(
      await fs.readFile(path.join(distDirectory, 'backend-mf-manifest.json'), {
        encoding: 'utf8',
      }),
    );
    const remoteEntry = await fs.readFile(
      path.join(distDirectory, 'backendRemoteEntry.mjs'),
      'utf8',
    );

    expect(manifest).toEqual(
      expect.objectContaining({
        name: 'verticalExploreBackend',
        version: '0.1.0',
        buildVersion: 'tractor-explore-build-1234',
        metaData: expect.objectContaining({
          buildInfo: expect.objectContaining({
            buildName: '@tractor-store-vertical-demo/explore',
            buildVersion: 'tractor-explore-build-1234',
          }),
        }),
        entry: expect.objectContaining({
          path: 'verticals/explore/dist/backendRemoteEntry.mjs',
          type: 'module',
          url: 'http://localhost:3021/backendRemoteEntry.mjs',
        }),
        backendFederation: expect.objectContaining({
          contractVersion: 'microvertical-server-effect-v1',
          nodeAdapterVersion: 'backend-mf-effect-v1',
          readinessPath: '/explore-api/explore/readiness',
          remoteType: 'module',
          versionBoundary: expect.objectContaining({
            invariant: 'web-and-api-same-build',
            packageName: '@tractor-store-vertical-demo/explore',
            version: '0.1.0',
            buildVersion: 'tractor-explore-build-1234',
            uiManifestUrl: 'http://localhost:3021/mf-manifest.json',
          }),
        }),
      }),
    );
    expect(remoteEntry).toContain('export function get(id)');
    expect(remoteEntry).toContain('../api/effect-api.ts');
    expect(remoteEntry).toContain(
      '"buildVersion": "tractor-explore-build-1234"',
    );
    expect(remoteEntry).toContain('"version": "0.1.0"');
  });

  it('skips apps without generated backend federation metadata', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'apps/shell-super-app');
    const distDirectory = path.join(appDirectory, 'dist');

    await writeJson(path.join(workspaceRoot, '.modernjs/ultramodern.json'), {
      topology: {
        apps: [
          {
            id: 'shell-super-app',
            kind: 'shell',
            path: 'apps/shell-super-app',
          },
        ],
      },
    });

    await expect(
      emitBackendFederationArtifacts(appDirectory, distDirectory),
    ).resolves.toBeUndefined();
  });
});
