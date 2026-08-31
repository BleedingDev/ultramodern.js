import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  BackendFederationManifestAdapterError,
  loadBackendFederatedEffectApi,
  loadBackendFederatedEffectApiFromManifest,
  loadBackendFederationManifest,
} from '../src/runtime/effect';
import {
  type BackendFederationEntryExports,
  type BackendFederationRemote,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
  loadBackendFederatedEffectApi as loadEdgeBackendFederatedEffectApi,
} from '../src/runtime/effect/edge';

function createBackendRemoteEntryDataUrl(moduleSource: string) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleSource)}`;
}

function createEffectApiEntryExports(
  effectApiModule: Record<string, unknown>,
): BackendFederationEntryExports {
  return {
    init() {},
    get(id: string) {
      if (id !== './effect-api') {
        throw new Error(`Unexpected backend federation expose: ${id}`);
      }

      return async () => effectApiModule;
    },
  };
}

function createBackendManifest() {
  return {
    schemaVersion: 1,
    id: 'verticalCatalogBackend',
    name: 'verticalCatalogBackend',
    version: '1.2.3',
    buildVersion: 'catalog-build-123',
    entry: {
      url: 'service:verticalCatalogBackend',
      type: 'module',
    },
    backendFederation: {
      role: 'microvertical-server',
      name: 'verticalCatalogBackend',
      runtimeFramework: 'effect',
      strictEffectApproach: true,
      contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
      nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
      remoteType: 'module',
      expose: './effect-api',
      manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
      containerEntry: 'service:verticalCatalogBackend',
      versionBoundary: {
        invariant: 'web-and-api-same-build',
        packageName: '@tractor-store-vertical-demo/catalog',
        version: '1.2.3',
        buildVersion: 'catalog-build-123',
      },
    },
  };
}

async function listen(server: http.Server) {
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
  return `http://127.0.0.1:${address.port}`;
}

function createManifestEffectApiModule(
  overrides: Record<string, unknown> = {},
) {
  return {
    backendFederationContract: {
      compatibility: {
        build: 'catalog-build-123',
        contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
        nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
        packageName: '@tractor-store-vertical-demo/catalog',
      },
      name: 'verticalCatalogBackend',
      role: 'microvertical-server',
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    },
    contract: { servicePrefix: '/catalog-api' },
    runtime: { brand: 'defineEffectBff-runtime' },
    ...overrides,
  };
}

function createLiveBackendEntrySource(
  containerName: string,
  compatibilityBuild: string,
) {
  return `
module.exports = {
  init() {},
  get(id) {
    if (id !== './effect-api') throw new Error('Unexpected expose ' + id);
    return async () => ({
      backendFederationContract: {
        compatibility: {
          build: '${compatibilityBuild}',
          contractVersion: '${BACKEND_FEDERATION_CONTRACT_VERSION}',
          nodeAdapterVersion: '${BACKEND_FEDERATION_NODE_ADAPTER_VERSION}',
          packageName: '@tractor-store-vertical-demo/catalog',
          unitId: 'catalog@21',
        },
        name: '${containerName}',
        role: 'microvertical-server',
        runtimeFramework: 'effect',
        strictEffectApproach: true,
      },
      contract: { servicePrefix: '/catalog-api' },
      runtime: { brand: 'official-runtime-http' },
    });
  },
};
`;
}

function createVerifiedBackendManifest(
  entrySource: string,
  entryUrl = 'https://catalog.example.test/backendRemoteEntry.cjs',
) {
  const manifest = createBackendManifest();
  manifest.entry = {
    byteLength: Buffer.byteLength(entrySource),
    sha256: createHash('sha256').update(entrySource).digest('hex'),
    type: 'commonjs-module',
    url: entryUrl,
  } as typeof manifest.entry;
  manifest.backendFederation.containerEntry = entryUrl;
  manifest.backendFederation.remoteType = 'commonjs-module';
  return manifest;
}

describe('backend federation runtime', () => {
  test('rejects unverified network entries without an integrity record', async () => {
    await expect(
      loadBackendFederatedEffectApi({
        hostName: 'unverifiedNetworkBackendHost',
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
        },
      }),
    ).rejects.toThrow(/requires verified entry bytes/u);
  });

  test('does not let an explicit legacy policy execute unverified network bytes', async () => {
    delete (globalThis as Record<string, unknown>).__legacyBackendEvaluated;
    const unverifiedSource = `
globalThis.__legacyBackendEvaluated = true;
module.exports = { get() { return () => ({}) } };
`;

    await expect(
      loadBackendFederatedEffectApi({
        entryPolicy: {
          ...({ allowUnverifiedNetworkEntry: true } as Record<string, unknown>),
          fetch: async () => new Response(unverifiedSource),
        },
        hostName: 'unverifiedLegacyNetworkBackendHost',
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
        },
      }),
    ).rejects.toThrow(/requires verified entry bytes/u);

    expect(
      (globalThis as Record<string, unknown>).__legacyBackendEvaluated,
    ).toBeUndefined();
  });

  test('verifies a network remote before consulting a custom entry plugin', async () => {
    const verifiedSource = createLiveBackendEntrySource(
      'verticalCatalogBackend',
      'catalog-build-123',
    );
    const mutatedSource = verifiedSource.replace(
      'official-runtime-http',
      'tampered-runtime-http',
    );
    let pluginCalls = 0;

    await expect(
      loadBackendFederatedEffectApi({
        entryPolicy: {
          ...({ allowTrustedEntryProvider: true } as Record<string, unknown>),
          fetch: async () => new Response(mutatedSource),
        },
        hostName: 'verifiedPluginBypassBackendHost',
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              pluginCalls += 1;
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
          verification: {
            byteLength: Buffer.byteLength(verifiedSource),
            entryUrl: 'https://catalog.example.test/backendRemoteEntry.cjs',
            remoteName: 'verticalCatalogBackend',
            sha256: createHash('sha256').update(verifiedSource).digest('hex'),
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'integrity_mismatch' });

    expect(pluginCalls).toBe(0);
  });

  test('rejects an unverified network remote before consulting a global entry', async () => {
    let globalGetCalls = 0;
    (globalThis as Record<string, unknown>).__catalogBackendGlobal = {
      get() {
        globalGetCalls += 1;
        return () => createManifestEffectApiModule();
      },
    };

    try {
      await expect(
        loadBackendFederatedEffectApi({
          hostName: 'globalBypassBackendHost',
          remote: {
            entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
            entryGlobalName: '__catalogBackendGlobal',
            name: 'verticalCatalogBackend',
            type: 'commonjs-module',
          },
        }),
      ).rejects.toThrow(/requires verified entry bytes/u);
      expect(globalGetCalls).toBe(0);
    } finally {
      delete (globalThis as Record<string, unknown>).__catalogBackendGlobal;
    }
  });

  test('rejects unverified bytes before invoking a custom evaluator', async () => {
    let evaluatorCalls = 0;

    await expect(
      loadBackendFederatedEffectApi({
        entryPolicy: {
          ...({ allowUnverifiedNetworkEntry: true } as Record<string, unknown>),
          evaluateCommonJs() {
            evaluatorCalls += 1;
            return createEffectApiEntryExports(createManifestEffectApiModule());
          },
          fetch: async () => new Response('module.exports = {};'),
        },
        hostName: 'customEvaluatorBypassBackendHost',
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
        },
      }),
    ).rejects.toThrow(/requires verified entry bytes/u);

    expect(evaluatorCalls).toBe(0);
  });

  test('does not let a custom runtime bypass network entry verification', async () => {
    const loadRemote = rs.fn(async () => createManifestEffectApiModule());

    await expect(
      loadBackendFederatedEffectApi({
        hostName: 'customRuntimeBypassBackendHost',
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
        },
        runtime: { loadRemote } as never,
      }),
    ).rejects.toThrow(/cannot execute network backend federation entries/u);

    expect(loadRemote).not.toHaveBeenCalled();
  });

  test('shares one aborting deadline through manifest fallback and entry verification', async () => {
    delete (globalThis as Record<string, unknown>).__lateBackendEvaluation;
    const entrySource = `
globalThis.__lateBackendEvaluation = true;
module.exports = { get() { return () => ({}) } };
`;
    const entryUrl =
      'https://catalog.example.test/backendRemoteEntry-timeout.cjs';
    const manifest = createVerifiedBackendManifest(entrySource, entryUrl);
    const bytes = new TextEncoder().encode(entrySource);
    let fetchSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;

    const loaded = await loadBackendFederatedEffectApiFromManifest({
      entryPolicy: {
        fetch: async (_url, init) => {
          fetchSignal = init?.signal ?? undefined;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes.subarray(0, 8));
                release = () => {
                  try {
                    controller.enqueue(bytes.subarray(8));
                    controller.close();
                  } catch {
                    // Expected after the shared deadline cancels the stream.
                  }
                };
              },
            }),
          );
        },
        timeoutMs: 1_000,
      },
      fallback(error) {
        expect(error.code).toBe('timeout');
        return createManifestEffectApiModule({
          runtime: { brand: 'deadline-fallback' },
        });
      },
      hostName: 'deadlineManifestBackendHost',
      manifest,
      timeoutMs: 20,
    });

    expect(loaded.runtime).toEqual({ brand: 'deadline-fallback' });
    expect(fetchSignal?.aborted).toBe(true);
    release?.();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(
      (globalThis as Record<string, unknown>).__lateBackendEvaluation,
    ).toBeUndefined();
  });

  test('loads a strict Effect backend expose from a Node CommonJS remote entry through Module Federation runtime', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalCatalogBackend',
      entry: createBackendRemoteEntryDataUrl(`
module.exports = {
  init() {},
  get(id) {
    if (id !== './effect-api') {
      throw new Error('Unexpected expose ' + id);
    }

    return async () => ({
      default: { brand: 'defineEffectBff-runtime' },
      backendFederationContract: {
        runtimeFramework: 'effect',
        strictEffectApproach: true,
      },
      contract: { ownerId: 'catalog' },
      runtime: { brand: 'defineEffectBff-runtime' },
    });
  },
};
`),
      type: 'commonjs-module',
    };

    const loaded = await loadBackendFederatedEffectApi({
      hostName: 'shellBackendHost',
      remote,
    });

    expect(loaded.backendFederationContract).toEqual({
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    });
    expect(loaded.contract).toEqual({ ownerId: 'catalog' });
    expect(loaded.default).toEqual({ brand: 'defineEffectBff-runtime' });
  });

  test('loads a strict Effect backend expose from an ESM remote entry through Module Federation runtime', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalExploreBackend',
      entry: createBackendRemoteEntryDataUrl(`
        export function init() {}
        export function get(id) {
          if (id !== './effect-api') throw new Error('Unexpected expose ' + id);

          return async () => ({
            backendFederationContract: {
              runtimeFramework: 'effect',
              strictEffectApproach: true,
            },
            contract: { ownerId: 'explore' },
            runtime: { brand: 'defineEffectBff-runtime' },
          });
        }
      `),
      type: 'module',
    };

    const loaded = await loadBackendFederatedEffectApi({
      hostName: 'shellBackendHost',
      remote,
    });

    expect(loaded.backendFederationContract).toEqual({
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    });
    expect(loaded.contract).toEqual({ ownerId: 'explore' });
    expect(loaded.runtime).toEqual({ brand: 'defineEffectBff-runtime' });
  });

  test('loads a strict Effect backend expose from a local file URL ESM remote entry', async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-backend-federation-'),
    );
    const entryPath = path.join(tempDirectory, 'backendRemoteEntry.mjs');

    try {
      await fs.writeFile(
        entryPath,
        `
          export function init() {}
          export function get(id) {
            if (id !== './effect-api') throw new Error('Unexpected expose ' + id);
            return async () => ({
              backendFederationContract: {
                runtimeFramework: 'effect',
                strictEffectApproach: true,
              },
              runtime: { brand: 'defineEffectBff-runtime' },
            });
          }
        `,
      );

      const remote: BackendFederationRemote = {
        name: 'verticalFileBackend',
        entry: pathToFileURL(entryPath).href,
        type: 'module',
      };

      const loaded = await loadBackendFederatedEffectApi({
        hostName: 'localFileBackendHost',
        remote,
      });

      expect(loaded.runtime).toEqual({ brand: 'defineEffectBff-runtime' });
    } finally {
      await fs.rm(tempDirectory, { force: true, recursive: true });
    }
  });

  test('loads a strict Effect backend expose in a Worker-like runtime through a public MF loadEntry plugin', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalCheckoutBackend',
      entry: 'service:verticalCheckoutBackend',
      type: 'module',
    };
    const resolvedRemotes: BackendFederationRemote[] = [];
    const loaded = await loadEdgeBackendFederatedEffectApi({
      hostName: 'cloudflareWorkerBackendHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry(resolvedRemote) {
            resolvedRemotes.push(resolvedRemote);
            return createEffectApiEntryExports({
              backendFederationContract: {
                runtimeFramework: 'effect',
                strictEffectApproach: true,
              },
              runtime: { brand: 'defineEffectBff-runtime' },
            });
          },
        }),
      ],
    });

    expect(resolvedRemotes).toEqual([
      expect.objectContaining({
        name: 'verticalCheckoutBackend',
        entry: 'service:verticalCheckoutBackend',
        type: 'module',
      }),
    ]);
    expect(loaded.runtime).toEqual({ brand: 'defineEffectBff-runtime' });
  });

  test('fails closed before an edge provider can execute a network remote', async () => {
    let providerCalls = 0;

    await expect(
      loadEdgeBackendFederatedEffectApi({
        hostName: 'cloudflareNetworkBackendHost',
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              providerCalls += 1;
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
        remote: {
          entry: 'https://checkout.example.test/backendRemoteEntry.mjs',
          name: 'verticalCheckoutBackend',
          type: 'module',
        },
      }),
    ).rejects.toThrow(/static or service-binding entries/u);

    expect(providerCalls).toBe(0);
  });

  test('fails closed for network entries supplied through the edge remotes array', async () => {
    let evaluatorCalls = 0;
    await expect(
      loadEdgeBackendFederatedEffectApi({
        ...({
          entryPolicy: {
            evaluateCommonJs() {
              evaluatorCalls += 1;
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          },
        } as Record<string, unknown>),
        hostName: 'cloudflareArrayNetworkBackendHost',
        remoteName: 'verticalCheckoutBackend',
        remotes: [
          {
            entry: 'https://checkout.example.test/backendRemoteEntry.cjs',
            name: 'verticalCheckoutBackend',
            type: 'commonjs-module',
          },
        ],
      }),
    ).rejects.toThrow(/does not execute custom runtimes or entry evaluators/u);

    expect(evaluatorCalls).toBe(0);
  });

  test('isolates custom entry plugins between runtime instances sharing a remote identity', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalSharedBackend',
      entry: 'service:verticalSharedBackend',
      type: 'module',
    };
    const createRuntime = (brand: string) =>
      createBackendFederationRuntime({
        hostName: 'sharedBackendHost',
        remote,
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              return createEffectApiEntryExports({ runtime: { brand } });
            },
          }),
        ],
      });

    const first = await createRuntime('first').loadRemote<{
      runtime: { brand: string };
    }>('verticalSharedBackend/effect-api');
    const second = await createRuntime('second').loadRemote<{
      runtime: { brand: string };
    }>('verticalSharedBackend/effect-api');

    expect(first?.runtime.brand).toBe('first');
    expect(second?.runtime.brand).toBe('second');
  });

  test('loads a strict Effect backend expose through the Node manifest adapter', async () => {
    const manifest = createBackendManifest();
    const resolvedRemotes: BackendFederationRemote[] = [];

    const loaded = await loadBackendFederatedEffectApiFromManifest({
      hostName: 'nodeManifestBackendHost',
      manifest,
      remote: {
        entry: 'service:local-node',
      },
      expected: {
        buildVersion: 'catalog-build-123',
        packageName: '@tractor-store-vertical-demo/catalog',
        version: '1.2.3',
      },
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry(resolvedRemote) {
            resolvedRemotes.push(resolvedRemote);
            return createEffectApiEntryExports(createManifestEffectApiModule());
          },
        }),
      ],
    });

    expect(resolvedRemotes).toEqual([
      expect.objectContaining({
        entry: 'service:local-node',
        name: 'verticalCatalogBackend',
        type: 'module',
      }),
    ]);
    expect(loaded.backendFederationContract?.compatibility).toEqual({
      build: 'catalog-build-123',
      contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
      nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
      packageName: '@tractor-store-vertical-demo/catalog',
    });
  });

  test('loads a live HTTP manifest and CommonJS container through the official Module Federation runtime', async () => {
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      requests.push(request.url ?? '');
      const origin = `http://127.0.0.1:${
        (server.address() as { port: number }).port
      }`;

      if (
        request.url === '/backend-mf-manifest.json' ||
        request.url === '/backend-mf-manifest-mismatch.json'
      ) {
        const entryFile =
          request.url === '/backend-mf-manifest-mismatch.json'
            ? 'backendRemoteEntry-mismatch.cjs'
            : 'backendRemoteEntry.cjs';
        const remoteName =
          request.url === '/backend-mf-manifest-mismatch.json'
            ? 'verticalCatalogMismatchBackend'
            : 'verticalCatalogBackend';
        const compatibilityBuild =
          request.url === '/backend-mf-manifest-mismatch.json'
            ? 'catalog-build-wrong'
            : 'catalog-build-123';
        const entrySource = createLiveBackendEntrySource(
          remoteName,
          compatibilityBuild,
        );
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            id: remoteName,
            name: remoteName,
            version: '1.2.3',
            buildVersion: 'catalog-build-123',
            metaData: {
              name: remoteName,
              type: 'backend',
              buildInfo: {
                buildName: '@tractor-store-vertical-demo/catalog',
                buildVersion: 'catalog-build-123',
              },
              remoteEntry: {
                name: entryFile,
                path: '',
                type: 'commonjs-module',
              },
              globalName: remoteName,
              publicPath: `${origin}/`,
              ssrRemoteEntry: {
                name: entryFile,
                path: '',
                type: 'commonjs-module',
              },
              ssrPublicPath: `${origin}/`,
            },
            entry: {
              byteLength: Buffer.byteLength(entrySource),
              file: entryFile,
              path: `dist/${entryFile}`,
              sha256: createHash('sha256').update(entrySource).digest('hex'),
              type: 'commonjs-module',
              url: `${origin}/${entryFile}`,
            },
            exposes: [
              {
                id: `${remoteName}:./effect-api`,
                name: './effect-api',
                path: '',
                assets: {
                  js: { async: [], sync: [entryFile] },
                  css: { async: [], sync: [] },
                },
              },
            ],
            shared: [],
            backendFederation: {
              role: 'microvertical-server',
              name: remoteName,
              runtimeFramework: 'effect',
              strictEffectApproach: true,
              contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
              nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
              remoteType: 'commonjs-module',
              expose: './effect-api',
              manifestUrl: `${origin}${request.url}`,
              containerEntry: `${origin}/${entryFile}`,
              deliveryUnit: {
                unitId: 'catalog@21',
                buildMarker: 'catalog-build-123',
              },
              versionBoundary: {
                invariant: 'web-and-api-same-build',
                packageName: '@tractor-store-vertical-demo/catalog',
                version: '1.2.3',
                buildVersion: 'catalog-build-123',
                deliveryUnit: {
                  unitId: 'catalog@21',
                  buildMarker: 'catalog-build-123',
                },
              },
            },
          }),
        );
        return;
      }

      if (
        request.url === '/backendRemoteEntry.cjs' ||
        request.url === '/backendRemoteEntry-mismatch.cjs'
      ) {
        const compatibilityBuild =
          request.url === '/backendRemoteEntry-mismatch.cjs'
            ? 'catalog-build-wrong'
            : 'catalog-build-123';
        const containerName =
          request.url === '/backendRemoteEntry-mismatch.cjs'
            ? 'verticalCatalogMismatchBackend'
            : 'verticalCatalogBackend';
        response.setHeader('content-type', 'text/javascript');
        response.end(
          createLiveBackendEntrySource(containerName, compatibilityBuild),
        );
        return;
      }

      response.statusCode = 404;
      response.end();
    });
    const origin = await listen(server);

    try {
      const entrySource = createLiveBackendEntrySource(
        'verticalCatalogBackend',
        'catalog-build-123',
      );
      const loaded = await loadBackendFederatedEffectApiFromManifest({
        entryPolicy: {
          expected: {
            byteLength: Buffer.byteLength(entrySource),
            entryUrl: `${origin}/backendRemoteEntry.cjs`,
            remoteName: 'verticalCatalogBackend',
            sha256: createHash('sha256').update(entrySource).digest('hex'),
          },
        },
        hostName: `nodeHttpManifestBackendHost-${Date.now()}`,
        manifestUrl: `${origin}/backend-mf-manifest.json`,
        expected: {
          buildMarker: 'catalog-build-123',
          unitId: 'catalog@21',
        },
      });

      expect(loaded.runtime).toEqual({ brand: 'official-runtime-http' });
      expect(requests).toEqual([
        '/backend-mf-manifest.json',
        '/backendRemoteEntry.cjs',
      ]);

      await expect(
        loadBackendFederatedEffectApiFromManifest({
          entryPolicy: {
            expected: (() => {
              const mismatchSource = createLiveBackendEntrySource(
                'verticalCatalogMismatchBackend',
                'catalog-build-wrong',
              );
              return {
                byteLength: Buffer.byteLength(mismatchSource),
                entryUrl: `${origin}/backendRemoteEntry-mismatch.cjs`,
                remoteName: 'verticalCatalogMismatchBackend',
                sha256: createHash('sha256')
                  .update(mismatchSource)
                  .digest('hex'),
              };
            })(),
          },
          hostName: `nodeHttpMismatchBackendHost-${Date.now()}`,
          manifestUrl: `${origin}/backend-mf-manifest-mismatch.json`,
          expected: {
            buildMarker: 'catalog-build-123',
            unitId: 'catalog@21',
          },
        }),
      ).rejects.toMatchObject({
        code: 'version_mismatch',
        failureEvent: 'modernjs:microvertical-server-fallback',
      });
      expect(requests.slice(-2)).toEqual([
        '/backend-mf-manifest-mismatch.json',
        '/backendRemoteEntry-mismatch.cjs',
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  test('resolves backend federation manifest URLs from generated env metadata', async () => {
    const manifest: any = createBackendManifest();
    manifest.backendFederation.deliveryUnit = {
      unitId: 'catalog@21',
      buildMarker: 'catalog-build-123',
    };
    manifest.backendFederation.versionBoundary.deliveryUnit = {
      unitId: 'catalog@21',
      buildMarker: 'catalog-build-123',
    };
    const fetchedUrls: string[] = [];

    const loaded = await loadBackendFederatedEffectApiFromManifest({
      hostName: 'nodeManifestEnvBackendHost',
      manifestEnv: 'CATALOG_BACKEND_MANIFEST_URL',
      env: {
        CATALOG_BACKEND_MANIFEST_URL:
          'https://catalog.example.test/backend-mf-manifest.json',
      },
      fetch: async url => {
        fetchedUrls.push(url);
        return new Response(JSON.stringify(manifest));
      },
      remote: {
        entry: 'service:verticalCatalogBackend',
        name: 'verticalCatalogBackend',
      },
      expected: {
        buildMarker: 'catalog-build-123',
        unitId: 'catalog@21',
      },
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports(createManifestEffectApiModule());
          },
        }),
      ],
    });

    expect(fetchedUrls).toEqual([
      'https://catalog.example.test/backend-mf-manifest.json',
    ]);
    expect(loaded.contract).toEqual({ servicePrefix: '/catalog-api' });
  });

  test('requires expected delivery-unit identity for URL manifest references', async () => {
    await expect(
      loadBackendFederationManifest({
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
        fetch: async () =>
          new Response(JSON.stringify(createBackendManifest())),
      }),
    ).rejects.toMatchObject({
      code: 'version_mismatch',
      details: expect.objectContaining({
        label: 'expected.deliveryUnit',
        referenceSource: 'url',
      }),
    });
  });

  test('rejects non-HTTP manifest URL references instead of reading local files', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-backend-manifest-url-scheme-'),
    );
    try {
      const manifestPath = path.join(tempRoot, 'backend-mf-manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(createBackendManifest()));

      await expect(
        loadBackendFederationManifest({
          expected: {
            buildMarker: 'catalog-build-123',
            unitId: 'catalog@21',
          },
          manifestUrl: pathToFileURL(manifestPath).href,
        }),
      ).rejects.toMatchObject({ code: 'manifest_unavailable' });
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('does not let manifestPath disguise a network fetch as a trusted local manifest', async () => {
    const fetchManifest = rs.fn(
      async () => new Response(JSON.stringify(createBackendManifest())),
    );

    await expect(
      loadBackendFederationManifest({
        manifestPath: 'https://catalog.example.test/backend-mf-manifest.json',
        fetch: fetchManifest,
      }),
    ).rejects.toThrow(/manifestPath must identify an explicit local file/u);

    expect(fetchManifest).not.toHaveBeenCalled();
  });

  test('rejects local or plugin execution selected by a network manifest', async () => {
    const manifest = createBackendManifest();
    manifest.entry.url = createBackendRemoteEntryDataUrl(
      'globalThis.__networkManifestDataExecuted = true;',
    );
    manifest.backendFederation.containerEntry = manifest.entry.url;
    let providerCalls = 0;
    delete (globalThis as Record<string, unknown>)
      .__networkManifestDataExecuted;

    await expect(
      loadBackendFederatedEffectApiFromManifest({
        expected: {
          buildMarker: 'catalog-build-123',
          unitId: 'catalog@21',
        },
        fetch: async () => new Response(JSON.stringify(manifest)),
        hostName: 'networkManifestLocalEntryHost',
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              providerCalls += 1;
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
      }),
    ).rejects.toThrow(
      /network manifests cannot select local, global, or plugin entry/u,
    );

    expect(providerCalls).toBe(0);
    expect(
      (globalThis as Record<string, unknown>).__networkManifestDataExecuted,
    ).toBeUndefined();
  });

  test('does not trust an entry digest asserted only by a network manifest', async () => {
    const entrySource = createLiveBackendEntrySource(
      'verticalCatalogBackend',
      'catalog-build-123',
    );
    const manifest = createVerifiedBackendManifest(entrySource);
    const fetchedUrls: string[] = [];

    await expect(
      loadBackendFederatedEffectApiFromManifest({
        expected: {
          buildMarker: 'catalog-build-123',
          unitId: 'catalog@21',
        },
        fetch: async url => {
          fetchedUrls.push(url);
          return new Response(JSON.stringify(manifest));
        },
        hostName: 'selfAssertedManifestIntegrityHost',
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
      }),
    ).rejects.toThrow(
      /requires caller-pinned entryUrl, remoteName, sha256, and byteLength/u,
    );

    expect(fetchedUrls).toEqual([
      'https://catalog.example.test/backend-mf-manifest.json',
    ]);
  });

  test('does not expose a legacy URL manifest identity bypass', async () => {
    await expect(
      loadBackendFederationManifest({
        ...({ allowLegacyManifest: true } as Record<string, unknown>),
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
        fetch: async () =>
          new Response(JSON.stringify(createBackendManifest())),
      }),
    ).rejects.toMatchObject({ code: 'version_mismatch' });
  });

  test('keeps file-path manifest loading compatible without expected identity', async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-backend-manifest-path-'),
    );
    try {
      const manifestPath = path.join(tempRoot, 'backend-mf-manifest.json');
      const manifest = createBackendManifest();
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

      await expect(
        loadBackendFederationManifest({ manifestPath }),
      ).resolves.toEqual(manifest);
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });

  test('rejects backend federation manifests that do not preserve strict Effect metadata', async () => {
    const manifest = createBackendManifest();

    await expect(
      loadBackendFederatedEffectApiFromManifest({
        hostName: 'unsafeManifestBackendHost',
        manifest: {
          ...manifest,
          backendFederation: {
            ...manifest.backendFederation,
            strictEffectApproach: false,
          },
        },
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
      }),
    ).rejects.toThrow(/strictEffectApproach: true/u);
  });

  test('reports unavailable remotes through the Node manifest adapter', async () => {
    const manifest = createBackendManifest();
    manifest.id = 'verticalOfflineBackend';
    manifest.name = 'verticalOfflineBackend';
    manifest.backendFederation.name = 'verticalOfflineBackend';
    manifest.entry.url = 'service:verticalOfflineBackend';
    manifest.backendFederation.containerEntry =
      'service:verticalOfflineBackend';

    await expect(
      loadBackendFederatedEffectApiFromManifest({
        hostName: 'unavailableManifestBackendHost',
        manifest,
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              throw new Error('backend is offline');
            },
          }),
        ],
      }),
    ).rejects.toThrow(/could not load \.\/effect-api/u);
  });

  test('supports typed fallback when manifest version boundary mismatches', async () => {
    const fallbackErrors: BackendFederationManifestAdapterError[] = [];

    const loaded = await loadBackendFederatedEffectApiFromManifest({
      hostName: 'fallbackManifestBackendHost',
      manifest: createBackendManifest(),
      expected: {
        buildVersion: 'catalog-build-456',
      },
      fallback(error) {
        fallbackErrors.push(error);
        return createManifestEffectApiModule({
          runtime: { brand: 'typed-effect-fallback' },
        });
      },
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports(createManifestEffectApiModule());
          },
        }),
      ],
    });

    expect(fallbackErrors).toHaveLength(1);
    expect(fallbackErrors[0]).toBeInstanceOf(
      BackendFederationManifestAdapterError,
    );
    expect(fallbackErrors[0].code).toBe('version_mismatch');
    expect(loaded.runtime).toEqual({ brand: 'typed-effect-fallback' });
  });

  test('rejects backend exposes that do not preserve strict Effect contract metadata', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalUnsafeBackend',
      entry: 'service:verticalUnsafeBackend',
      type: 'module',
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'strictBackendHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports({
              backendFederationContract: {
                runtimeFramework: 'effect',
                strictEffectApproach: false,
              },
              runtime: { brand: 'defineEffectBff-runtime' },
            });
          },
        }),
      ],
    });

    await expect(
      loadBackendFederatedEffectApi({
        hostName: 'strictBackendHost',
        remote,
        runtime,
      }),
    ).rejects.toThrow(/strictEffectApproach: true/u);
  });

  test('rejects strict backend exposes that do not declare Effect runtime framework', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalNonEffectBackend',
      entry: 'service:verticalNonEffectBackend',
      type: 'module',
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'nonEffectBackendHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports({
              backendFederationContract: {
                runtimeFramework: 'hono',
                strictEffectApproach: true,
              },
              runtime: { brand: 'defineEffectBff-runtime' },
            });
          },
        }),
      ],
    });

    await expect(
      loadBackendFederatedEffectApi({
        hostName: 'nonEffectBackendHost',
        remote,
        runtime,
      }),
    ).rejects.toThrow(/runtimeFramework: "effect"/u);
  });

  test('rejects backend exposes missing strict Effect contract metadata', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalMissingContractBackend',
      entry: 'service:verticalMissingContractBackend',
      type: 'module',
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'missingContractBackendHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports({
              runtime: { brand: 'defineEffectBff-runtime' },
            });
          },
        }),
      ],
    });

    await expect(
      loadBackendFederatedEffectApi({
        hostName: 'missingContractBackendHost',
        remote,
        runtime,
      }),
    ).rejects.toThrow(/strictEffectApproach: true/u);
  });

  describe('ADR-0019 delivery-unit identity root', () => {
    function createBackendManifestWithDeliveryUnit(
      deliveryUnit: Record<string, unknown>,
    ) {
      const manifest = createBackendManifest();
      manifest.backendFederation.versionBoundary.deliveryUnit = deliveryUnit;
      return manifest;
    }

    test('legacy manifest without deliveryUnit metadata still passes existing checks', async () => {
      const manifest = createBackendManifest();

      const loaded = await loadBackendFederatedEffectApiFromManifest({
        hostName: 'legacyManifestBackendHost',
        manifest,
        expected: {
          buildVersion: 'catalog-build-123',
          packageName: '@tractor-store-vertical-demo/catalog',
          version: '1.2.3',
        },
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
      });

      expect(loaded.contract).toEqual({ servicePrefix: '/catalog-api' });
    });

    test('fails closed, telemetry-visible, when manifest deliveryUnit.buildMarker disagrees with versionBoundary.buildVersion', async () => {
      const manifest = createBackendManifestWithDeliveryUnit({
        unitId: 'catalog@21',
        buildMarker: 'catalog-build-999',
      });

      await expect(
        loadBackendFederatedEffectApiFromManifest({
          hostName: 'deliveryUnitMismatchBackendHost',
          manifest,
          plugins: [
            createBackendFederationLoadEntryPlugin({
              resolveEntry() {
                return createEffectApiEntryExports(
                  createManifestEffectApiModule(),
                );
              },
            }),
          ],
        }),
      ).rejects.toMatchObject({
        code: 'version_mismatch',
        failureEvent: 'modernjs:microvertical-server-fallback',
      });
    });

    test('fails closed when expected.unitId does not match manifest deliveryUnit.unitId', async () => {
      const manifest = createBackendManifestWithDeliveryUnit({
        unitId: 'catalog@21',
        buildMarker: 'catalog-build-123',
      });
      const fallbackErrors: BackendFederationManifestAdapterError[] = [];

      const loaded = await loadBackendFederatedEffectApiFromManifest({
        hostName: 'unitIdMismatchBackendHost',
        manifest,
        expected: {
          unitId: 'catalog@17',
        },
        fallback(error) {
          fallbackErrors.push(error);
          return createManifestEffectApiModule({
            runtime: { brand: 'typed-effect-fallback' },
          });
        },
        plugins: [
          createBackendFederationLoadEntryPlugin({
            resolveEntry() {
              return createEffectApiEntryExports(
                createManifestEffectApiModule(),
              );
            },
          }),
        ],
      });

      expect(fallbackErrors).toHaveLength(1);
      const [fallbackError] = fallbackErrors;
      expect(fallbackError).toBeInstanceOf(
        BackendFederationManifestAdapterError,
      );
      expect(fallbackError.code).toBe('version_mismatch');
      expect(fallbackError.failureEvent).toBe(
        'modernjs:microvertical-server-fallback',
      );
      expect(fallbackError.details).toMatchObject({
        label: 'deliveryUnit.unitId',
        expected: 'catalog@17',
        received: 'catalog@21',
      });
      expect(loaded.runtime).toEqual({ brand: 'typed-effect-fallback' });
    });

    test('fails closed when loaded compatibility.unitId does not match manifest deliveryUnit.unitId', async () => {
      const manifest = createBackendManifestWithDeliveryUnit({
        unitId: 'catalog@21',
        buildMarker: 'catalog-build-123',
      });

      await expect(
        loadBackendFederatedEffectApiFromManifest({
          hostName: 'exposeUnitIdMismatchBackendHost',
          manifest,
          plugins: [
            createBackendFederationLoadEntryPlugin({
              resolveEntry() {
                return createEffectApiEntryExports(
                  createManifestEffectApiModule({
                    backendFederationContract: {
                      compatibility: {
                        build: 'catalog-build-123',
                        contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
                        nodeAdapterVersion:
                          BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
                        packageName: '@tractor-store-vertical-demo/catalog',
                        unitId: 'catalog@17',
                      },
                      name: 'verticalCatalogBackend',
                      role: 'microvertical-server',
                      runtimeFramework: 'effect',
                      strictEffectApproach: true,
                    },
                  }),
                );
              },
            }),
          ],
        }),
      ).rejects.toMatchObject({
        code: 'version_mismatch',
        failureEvent: 'modernjs:microvertical-server-fallback',
      });
    });
  });
});
