import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadBackendFederatedEffectApiFromManifest } from '@modern-js/plugin-bff-extensions/backend-federation-manifest/node';
import { Effect, ManagedRuntime } from 'effect';
import { HttpApi } from 'effect/unstable/httpapi';
import { emitBackendFederationArtifacts } from '../../src/backend-federation-build';

const temporaryDirectories: string[] = [];

const createTempDir = async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-backend-mf-'),
  );
  temporaryDirectories.push(directory);
  return directory;
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

type WorkspaceOptions = {
  artifactOverrides?: Record<string, unknown>;
  backendBase?: string;
  topologyDeliveryUnit?: Record<string, unknown>;
  distName?: string;
  effectApiSource?: string;
  appId?: string;
};

const createWorkspace = async ({
  artifactOverrides = {},
  backendBase = 'http://localhost:3021',
  topologyDeliveryUnit,
  distName = 'dist',
  effectApiSource = 'export const backendFederationContract = {};\n',
  appId = 'explore',
}: WorkspaceOptions = {}) => {
  const workspaceRoot = await createTempDir();
  const appDirectory = path.join(workspaceRoot, 'verticals/explore');
  const distDirectory = path.join(appDirectory, distName);
  await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
  await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
  await fs.symlink(
    path.resolve(__dirname, '../../node_modules'),
    path.join(appDirectory, 'node_modules'),
    'dir',
  );
  await fs.writeFile(
    path.join(appDirectory, 'api/effect-api.ts'),
    effectApiSource,
  );
  await fs.writeFile(
    path.join(appDirectory, 'backend-federation.config.ts'),
    'export default {};\n',
  );
  await writeJson(
    path.join(appDirectory, 'shared/ultramodern-build.json'),
    createBuildArtifact(artifactOverrides),
  );
  await writeJson(path.join(appDirectory, 'package.json'), {
    name: '@tractor-store-vertical-demo/explore',
    version: '0.1.0',
  });
  await writeJson(
    path.join(workspaceRoot, 'topology/reference-topology.json'),
    {
      shell: { id: 'shell', kind: 'shell', path: 'shell' },
      verticals: [
        {
          id: appId,
          kind: 'vertical',
          package: '@tractor-store-vertical-demo/explore',
          path: 'verticals/explore',
          api: { bff: { prefix: '/explore-api' }, stem: 'explore' },
          moduleFederation: {
            name: 'verticalExplore',
            manifestUrl: `${backendBase}/mf-manifest.json`,
          },
          backendFederation: {
            name: 'verticalExploreBackend',
            versionBoundary: {
              ui: { manifestUrl: `${backendBase}/mf-manifest.json` },
            },
            executionSurfaces: {
              node: {
                remoteName: 'verticalExploreBackend',
                manifestUrl: `${backendBase}/backend-mf-manifest.json`,
                containerEntry: `${backendBase}/backendRemoteEntry.cjs`,
                remoteType: 'commonjs-module',
              },
            },
          },
          ...(topologyDeliveryUnit
            ? { deliveryUnit: topologyDeliveryUnit }
            : {}),
        },
      ],
    },
  );
  await writeJson(
    path.join(workspaceRoot, 'topology/local-overlays/development.json'),
    {
      ports: { explore: 3021 },
      manifests: { explore: `${backendBase}/mf-manifest.json` },
      serverExecution: {
        explore: {
          node: {
            remoteName: 'verticalExploreBackend',
            manifestUrl: `${backendBase}/backend-mf-manifest.json`,
            containerEntry: `${backendBase}/backendRemoteEntry.cjs`,
            remoteType: 'commonjs-module',
          },
        },
      },
    },
  );
  return { appDirectory, distDirectory, workspaceRoot };
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
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe('backend federation build artifacts', () => {
  it('loads its emitted container from a verified live HTTP path', async () => {
    const publicBasePath = '/delivery/explore/assets';
    let distDirectory = '';
    const requests: string[] = [];
    const server = http.createServer(async (request, response) => {
      const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1')
        .pathname;
      requests.push(requestPath);
      const fileName = requestPath.endsWith('backend-mf-manifest.json')
        ? 'backend-mf-manifest.json'
        : requestPath.endsWith('backendRemoteEntry.cjs')
          ? 'backendRemoteEntry.cjs'
          : undefined;
      if (!fileName) {
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

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected backend federation test server address.');
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const workspace = await createWorkspace({
        backendBase: `${origin}${publicBasePath}`,
        effectApiSource: `
export const backendFederationContract = {
  name: 'verticalExploreBackend',
  role: 'microvertical-server',
  runtimeFramework: 'effect',
  strictEffectApproach: true,
};
import { Layer, ManagedRuntime, Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
export const api = HttpApi.make('ExploreApi').add(
  HttpApiGroup.make('explore').add(
    HttpApiEndpoint.get('ping', '/ping', { success: Schema.String }),
  ),
);
export const runtime = ManagedRuntime.make(Layer.empty);
export { api as nativeApi, runtime as nativeRuntime };
`,
      });
      distDirectory = workspace.distDirectory;

      await withSourceRevision('2'.repeat(40), () =>
        emitBackendFederationArtifacts(
          workspace.appDirectory,
          workspace.distDirectory,
        ),
      );
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(workspace.distDirectory, 'backend-mf-manifest.json'),
          'utf8',
        ),
      );
      const loaded = await loadBackendFederatedEffectApiFromManifest({
        hostName: `appToolsLiveHttpHost-${Date.now()}`,
        manifestUrl: `${origin}${publicBasePath}/backend-mf-manifest.json`,
        entryPolicy: {
          expected: {
            byteLength: manifest.entry.byteLength,
            entryUrl: manifest.entry.url,
            remoteName: manifest.backendFederation.name,
            sha256: manifest.entry.sha256,
          },
        },
        expected: {
          buildMarker: manifest.backendFederation.deliveryUnit.buildMarker,
          unitId: manifest.backendFederation.deliveryUnit.unitId,
        },
      });

      expect(HttpApi.isHttpApi(loaded.api)).toBe(true);
      expect(loaded.api).toBe(Reflect.get(loaded, 'nativeApi'));
      expect(loaded.runtime).toBe(Reflect.get(loaded, 'nativeRuntime'));
      if (!ManagedRuntime.isManagedRuntime(loaded.runtime)) {
        throw new Error('Expected the emitted native Effect ManagedRuntime.');
      }
      try {
        await expect(
          loaded.runtime.runPromise(Effect.succeed('emitted-live-http')),
        ).resolves.toBe('emitted-live-http');
      } finally {
        await loaded.runtime.dispose();
      }
      expect(requests).toEqual([
        `${publicBasePath}/backend-mf-manifest.json`,
        `${publicBasePath}/backendRemoteEntry.cjs`,
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects delivery-unit and generated build identity drift', async () => {
    const workspace = await createWorkspace({
      artifactOverrides: {
        build: 'tractor-explore-build-DRIFTED',
        buildMarker: 'tractor-explore-build-DRIFTED',
      },
      topologyDeliveryUnit: {
        unitId: 'tractor-store-vertical-demo/explore',
        buildMarker: 'tractor-explore-build-1234',
        sourceRevision: 'workspace',
        packageName: '@tractor-store-vertical-demo/explore',
        version: '0.1.0',
      },
    });

    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).rejects.toThrow(/Delivery-unit identity drift/u);
  });

  it('rejects a build artifact belonging to another vertical', async () => {
    const workspace = await createWorkspace({
      artifactOverrides: { appId: 'inventory' },
    });

    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).rejects.toThrow(
      /appId: topology=explore vs ultramodern-build=inventory/u,
    );
  });

  it('stays silent for an app that is not backend federated', async () => {
    const workspace = await createWorkspace();
    await fs.rm(path.join(workspace.appDirectory, 'api/effect-api.ts'));
    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).resolves.toBeUndefined();
    await expect(fs.access(workspace.distDirectory)).rejects.toThrow();

    await fs.rm(
      path.join(workspace.workspaceRoot, 'topology/reference-topology.json'),
    );
    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).resolves.toBeUndefined();
    await expect(fs.access(workspace.distDirectory)).rejects.toThrow();
  });

  it('rejects a Node backend surface that is not the CommonJS container entry', async () => {
    const workspace = await createWorkspace();
    const configPath = path.join(
      workspace.workspaceRoot,
      'topology/local-overlays/development.json',
    );
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const node = config.serverExecution.explore.node;
    node.remoteType = 'module';
    await writeJson(configPath, config);
    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).rejects.toThrow(/Node backend federation remoteType must/u);

    node.remoteType = 'commonjs-module';
    node.containerEntry = 'http://localhost:3021/worker.mjs';
    await writeJson(configPath, config);
    await expect(
      emitBackendFederationArtifacts(
        workspace.appDirectory,
        workspace.distDirectory,
      ),
    ).rejects.toThrow(/Node backend federation containerEntry must/u);
  });
});
