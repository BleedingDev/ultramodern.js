import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
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
    const remoteEntry = await fs.readFile(
      path.join(distDirectory, 'backendRemoteEntry.mjs'),
      'utf8',
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
    expect(remoteEntry).toContain(
      '"unitId": "tractor-store-vertical-demo/explore"',
    );
    expect(remoteEntry).toContain('"sourceRevision": "workspace"');
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
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
                },
              },
            },
          },
        ],
      },
    });

    const first = await withSourceRevision('revision-one', () =>
      emitBackendFederationArtifacts(appDirectory, distOne),
    );
    const second = await withSourceRevision('revision-two', () =>
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
      'revision-one',
    );
    expect(secondManifest.backendFederation.deliveryUnit.sourceRevision).toBe(
      'revision-two',
    );
    expect(
      firstManifest.backendFederation.deliveryUnit.sourceRevision,
    ).not.toBe(secondManifest.backendFederation.deliveryUnit.sourceRevision);
    expect(firstArtifact.deliveryUnit.sourceRevision).toBe('revision-one');
    expect(firstArtifact.surfaces.ui.sourceRevision).toBe('revision-one');
    expect(firstArtifact.surfaces.api.sourceRevision).toBe('revision-one');
    expect(secondArtifact.deliveryUnit.sourceRevision).toBe('revision-two');
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
    const { stdout: gitHead } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: workspaceRoot },
    );

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
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
                },
              },
            },
          },
        ],
      },
    });

    const result = await withSourceRevision('explicit-build-revision', () =>
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
      'explicit-build-revision',
    );
    expect(artifact.deliveryUnit.sourceRevision).toBe(
      'explicit-build-revision',
    );
    expect(artifact.deliveryUnit.sourceRevision).not.toBe(gitHead.trim());
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
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
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
                    'http://localhost:3021/backendRemoteEntry.mjs',
                  remoteType: 'module',
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
