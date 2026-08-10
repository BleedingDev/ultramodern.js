import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadBackendFederatedEffectApiFromManifest } from '../../../../cli/plugin-bff/src/runtime/effect';
import { emitBackendFederationArtifacts } from '../../src/plugins/backendFederationBuild';

const execFileAsync = promisify(execFile);

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

const createBuildArtifact = (overrides: Record<string, unknown> = {}) => {
  const deliveryUnit = {
    schemaVersion: 1,
    kind: 'microvertical-delivery-unit',
    appId: 'explore',
    unitId: 'tractor-store-vertical-demo/explore',
    packageName: '@tractor-store-vertical-demo/explore',
    version: '0.1.0',
    sourceRevision: 'workspace',
    buildMarker: 'tractor-explore-build-1234',
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
    build: 'tractor-explore-build-1234',
    ...overrides,
  };

  return {
    schemaVersion: 1,
    kind: 'ultramodern-build-artifact',
    deliveryUnit,
    surfaces: {
      ui: { ...deliveryUnit, surface: 'ui' },
      api: { ...deliveryUnit, surface: 'api' },
    },
  };
};

const writeBuildArtifact = async (
  appDirectory: string,
  overrides: Record<string, unknown> = {},
) => {
  await writeJson(
    path.join(appDirectory, 'shared/ultramodern-build.json'),
    createBuildArtifact(overrides),
  );
};

const withSourceRevision = async <T>(
  revision: string,
  callback: () => Promise<T>,
) => {
  const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
  process.env.ULTRAMODERN_SOURCE_REVISION = revision;
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.ULTRAMODERN_SOURCE_REVISION;
    } else {
      process.env.ULTRAMODERN_SOURCE_REVISION = previous;
    }
  }
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
    await writeBuildArtifact(appDirectory);
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
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
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
        remoteType: 'commonjs-module',
      }),
    );
    const manifest = JSON.parse(
      await fs.readFile(path.join(distDirectory, 'backend-mf-manifest.json'), {
        encoding: 'utf8',
      }),
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
          path: 'verticals/explore/dist/backendRemoteEntry.cjs',
          type: 'commonjs-module',
          url: 'http://localhost:3021/backendRemoteEntry.cjs',
        }),
        backendFederation: expect.objectContaining({
          contractVersion: 'microvertical-server-effect-v1',
          nodeAdapterVersion: 'backend-mf-effect-v1',
          readinessPath: '/explore-api/explore/readiness',
          remoteType: 'commonjs-module',
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
  });

  it('uses configured container entry base as backend public path', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');
    const containerEntry =
      'https://delivery.example.test/explore/assets/backendRemoteEntry.cjs';

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory);
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
            backendFederation: {
              name: 'verticalExploreBackend',
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl:
                    'https://delivery.example.test/explore/backend-mf-manifest.json',
                  containerEntry,
                  remoteType: 'commonjs-module',
                },
              },
            },
          },
        ],
      },
    });

    await emitBackendFederationArtifacts(appDirectory, distDirectory);

    const manifest = JSON.parse(
      await fs.readFile(path.join(distDirectory, 'backend-mf-manifest.json'), {
        encoding: 'utf8',
      }),
    );

    expect(manifest.entry.url).toBe(containerEntry);
    expect(manifest.backendFederation.containerEntry).toBe(containerEntry);
    expect(manifest.metaData.publicPath).toBe(
      'https://delivery.example.test/explore/assets/',
    );
    expect(manifest.metaData.ssrPublicPath).toBe(
      'https://delivery.example.test/explore/assets/',
    );
  });

  it('loads its emitted bundled container from live HTTP through the official runtime', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      `
export const backendFederationContract = {
  name: 'verticalExploreBackend',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
};
export const api = { service: 'explore' };
export const runtime = { brand: 'emitted-live-http' };
`,
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory);
    await fs.writeFile(
      path.join(appDirectory, 'backend-federation.config.ts'),
      'export default {};\n',
    );

    const requests: string[] = [];
    const server = http.createServer(async (request, response) => {
      requests.push(request.url ?? '');
      const fileName = request.url?.slice(1);
      if (
        fileName !== 'backend-mf-manifest.json' &&
        fileName !== 'backendRemoteEntry.cjs'
      ) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader(
        'content-type',
        fileName.endsWith('.json') ? 'application/json' : 'text/javascript',
      );
      response.end(await fs.readFile(path.join(distDirectory, fileName)));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected backend federation test server TCP address.');
    }
    const origin = `http://127.0.0.1:${address.port}`;

    await writeJson(path.join(workspaceRoot, '.modernjs/ultramodern.json'), {
      topology: {
        apps: [
          {
            id: 'explore',
            kind: 'vertical',
            package: '@tractor-store-vertical-demo/explore',
            path: 'verticals/explore',
            port: address.port,
            api: {
              prefix: '/explore-api',
              stem: 'explore',
            },
            backendFederation: {
              name: 'verticalExploreBackend',
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: `${origin}/backend-mf-manifest.json`,
                  containerEntry: `${origin}/backendRemoteEntry.cjs`,
                  remoteType: 'commonjs-module',
                },
              },
            },
          },
        ],
      },
    });

    try {
      await withSourceRevision('2'.repeat(40), () =>
        emitBackendFederationArtifacts(appDirectory, distDirectory),
      );
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(distDirectory, 'backend-mf-manifest.json'),
          'utf8',
        ),
      );
      const loaded = await loadBackendFederatedEffectApiFromManifest({
        hostName: `appToolsLiveHttpHost-${Date.now()}`,
        manifestUrl: `${origin}/backend-mf-manifest.json`,
        expected: {
          buildMarker: manifest.backendFederation.deliveryUnit.buildMarker,
          unitId: manifest.backendFederation.deliveryUnit.unitId,
        },
      });

      expect(loaded.api).toEqual({ service: 'explore' });
      expect(loaded.runtime).toEqual({ brand: 'emitted-live-http' });
      expect(requests).toEqual([
        '/backend-mf-manifest.json',
        '/backend-mf-manifest.json',
        '/backendRemoteEntry.cjs',
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it('emits matching deliveryUnit blocks when compact config and shared build agree', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory);
    await fs.writeFile(
      path.join(appDirectory, 'shared/ultramodern-build.ts'),
      [
        'export const ultramodernDeliveryUnit = {',
        "  appId: 'explore',",
        "  build: 'tractor-explore-build-1234',",
        "  packageName: '@tractor-store-vertical-demo/explore',",
        "  version: '0.1.0',",
        "  sourceRevision: 'workspace',",
        "  unitId: 'tractor-store-vertical-demo/explore',",
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
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
                },
              },
            },
            deliveryUnit: {
              unitId: 'tractor-store-vertical-demo/explore',
              buildMarker: 'tractor-explore-build-1234',
              sourceRevision: 'workspace',
              packageName: '@tractor-store-vertical-demo/explore',
              version: '0.1.0',
            },
          },
        ],
      },
    });

    await emitBackendFederationArtifacts(appDirectory, distDirectory);

    const manifest = JSON.parse(
      await fs.readFile(path.join(distDirectory, 'backend-mf-manifest.json'), {
        encoding: 'utf8',
      }),
    );
    expect(manifest.backendFederation.deliveryUnit).toEqual({
      schemaVersion: 1,
      kind: 'microvertical-delivery-unit',
      unitId: 'tractor-store-vertical-demo/explore',
      packageName: '@tractor-store-vertical-demo/explore',
      version: '0.1.0',
      buildMarker: 'tractor-explore-build-1234',
      sourceRevision: 'workspace',
    });
    expect(manifest.backendFederation.versionBoundary.deliveryUnit).toEqual({
      unitId: 'tractor-store-vertical-demo/explore',
      buildMarker: 'tractor-explore-build-1234',
      sourceRevision: 'workspace',
    });
    expect(
      manifest.backendFederation.versionBoundary.deliveryUnit.buildMarker,
    ).toBe(manifest.backendFederation.versionBoundary.buildVersion);
  });

  it('stamps sourceRevision from build revision into manifest and delivery-unit artifact', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distOne = path.join(appDirectory, 'dist-one');
    const distTwo = path.join(appDirectory, 'dist-two');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory);
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
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
                  containerEntry:
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
                },
              },
            },
          },
        ],
      },
    });

    const sourceRevision = '1'.repeat(40);
    const secondSourceRevision = '2'.repeat(40);
    const first = await withSourceRevision(sourceRevision, () =>
      emitBackendFederationArtifacts(appDirectory, distOne),
    );
    const second = await withSourceRevision(secondSourceRevision, () =>
      emitBackendFederationArtifacts(appDirectory, distTwo),
    );

    expect(first?.deliveryUnitArtifactPath).toBeDefined();
    expect(second?.deliveryUnitArtifactPath).toBeDefined();

    const firstManifest = JSON.parse(
      await fs.readFile(path.join(distOne, 'backend-mf-manifest.json'), 'utf8'),
    );
    const secondManifest = JSON.parse(
      await fs.readFile(path.join(distTwo, 'backend-mf-manifest.json'), 'utf8'),
    );
    const firstArtifact = JSON.parse(
      await fs.readFile(first!.deliveryUnitArtifactPath!, 'utf8'),
    );
    const secondArtifact = JSON.parse(
      await fs.readFile(second!.deliveryUnitArtifactPath!, 'utf8'),
    );

    expect(firstManifest.backendFederation.deliveryUnit.sourceRevision).toBe(
      sourceRevision,
    );
    expect(secondManifest.backendFederation.deliveryUnit.sourceRevision).toBe(
      secondSourceRevision,
    );
    expect(
      firstManifest.backendFederation.deliveryUnit.sourceRevision,
    ).not.toBe(secondManifest.backendFederation.deliveryUnit.sourceRevision);
    expect(firstArtifact.deliveryUnit.sourceRevision).toBe(sourceRevision);
    expect(firstArtifact.surfaces.ui.sourceRevision).toBe(sourceRevision);
    expect(firstArtifact.surfaces.api.sourceRevision).toBe(sourceRevision);
    expect(secondArtifact.deliveryUnit.sourceRevision).toBe(
      secondSourceRevision,
    );
  });

  it('honors explicit sourceRevision override inside git workspaces', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await execFileAsync('git', ['init'], { cwd: workspaceRoot });
    await execFileAsync(
      'git',
      ['config', 'user.email', 'modern@example.test'],
      {
        cwd: workspaceRoot,
      },
    );
    await execFileAsync('git', ['config', 'user.name', 'Modern Test'], {
      cwd: workspaceRoot,
    });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: workspaceRoot,
    });
    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await writeBuildArtifact(appDirectory);
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
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
                  containerEntry:
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
                },
              },
            },
          },
        ],
      },
    });

    await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
    await execFileAsync('git', ['commit', '-m', 'add delivery unit'], {
      cwd: workspaceRoot,
    });
    const { stdout: gitHead } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: workspaceRoot },
    );
    const sourceRevision = gitHead.trim();
    const result = await withSourceRevision(sourceRevision, () =>
      emitBackendFederationArtifacts(appDirectory, distDirectory),
    );

    expect(result?.deliveryUnitArtifactPath).toBeDefined();
    const manifest = JSON.parse(
      await fs.readFile(path.join(distDirectory, 'backend-mf-manifest.json'), {
        encoding: 'utf8',
      }),
    );
    const artifact = JSON.parse(
      await fs.readFile(result!.deliveryUnitArtifactPath!, {
        encoding: 'utf8',
      }),
    );

    expect(manifest.backendFederation.deliveryUnit.sourceRevision).toBe(
      sourceRevision,
    );
    expect(artifact.deliveryUnit.sourceRevision).toBe(sourceRevision);
    expect(artifact.deliveryUnit.sourceRevision).toBe(gitHead.trim());
  });

  it('throws when compact deliveryUnit and shared/ultramodern-build.ts disagree', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory, {
      build: 'tractor-explore-build-DRIFTED',
      buildMarker: 'tractor-explore-build-DRIFTED',
    });
    await fs.writeFile(
      path.join(appDirectory, 'shared/ultramodern-build.ts'),
      [
        'export const ultramodernDeliveryUnit = {',
        "  appId: 'explore',",
        "  build: 'tractor-explore-build-DRIFTED',",
        "  packageName: '@tractor-store-vertical-demo/explore',",
        "  version: '0.1.0',",
        "  sourceRevision: 'workspace',",
        "  unitId: 'tractor-store-vertical-demo/explore',",
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
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
                  containerEntry:
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
                },
              },
            },
            deliveryUnit: {
              unitId: 'tractor-store-vertical-demo/explore',
              buildMarker: 'tractor-explore-build-1234',
              sourceRevision: 'workspace',
              packageName: '@tractor-store-vertical-demo/explore',
              version: '0.1.0',
            },
          },
        ],
      },
    });

    await expect(
      emitBackendFederationArtifacts(appDirectory, distDirectory),
    ).rejects.toThrow(/Delivery-unit identity drift/);
  });

  it('throws when build artifact appId belongs to another vertical', async () => {
    const workspaceRoot = await createTempDir();
    const appDirectory = path.join(workspaceRoot, 'verticals/explore');
    const distDirectory = path.join(appDirectory, 'dist');

    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'api/effect-api.ts'),
      'export const backendFederationContract = {};\n',
    );
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await writeBuildArtifact(appDirectory, { appId: 'inventory' });
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
              executionSurfaces: {
                node: {
                  remoteName: 'verticalExploreBackend',
                  manifestUrl: 'http://localhost:3021/backend-mf-manifest.json',
                  containerEntry:
                    'http://localhost:3021/backendRemoteEntry.cjs',
                  remoteType: 'commonjs-module',
                },
              },
            },
          },
        ],
      },
    });

    await expect(
      emitBackendFederationArtifacts(appDirectory, distDirectory),
    ).rejects.toThrow(/appId: topology=explore vs ultramodern-build=inventory/);
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
