import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
} from '../src/backend-federation';
import {
  type BackendFederationEntryExports,
  type BackendFederationRemote,
  createBackendFederationLoadEntryPlugin as createEdgeBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime as createEdgeBackendFederationRuntime,
  loadBackendFederatedEffectApi as loadEdgeBackendFederatedEffectApi,
} from '../src/backend-federation/edge';
import { loadBackendFederatedEffectApi } from '../src/backend-federation/node';
import {
  BackendFederationManifestAdapterError,
  loadBackendFederationManifest,
} from '../src/backend-federation-manifest';
import { loadBackendFederatedEffectApiFromManifest } from '../src/backend-federation-manifest/node';

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
      deliveryUnit: {
        schemaVersion: 1,
        kind: 'microvertical-delivery-unit',
        packageName: '@tractor-store-vertical-demo/catalog',
        version: '1.2.3',
        sourceRevision: 'a'.repeat(40),
        unitId: 'catalog@21',
        buildMarker: 'catalog-build-123',
      },
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
        deliveryUnit: {
          schemaVersion: 1,
          kind: 'microvertical-delivery-unit',
          packageName: '@tractor-store-vertical-demo/catalog',
          version: '1.2.3',
          sourceRevision: 'a'.repeat(40),
          unitId: 'catalog@21',
          buildMarker: 'catalog-build-123',
        },
        invariant: 'web-and-api-same-build',
        packageName: '@tractor-store-vertical-demo/catalog',
        version: '1.2.3',
        buildVersion: 'catalog-build-123',
      },
    },
  };
}

function withDeliveryUnitIdentity(
  manifest: ReturnType<typeof createBackendManifest>,
) {
  const identity = {
    schemaVersion: 1,
    kind: 'microvertical-delivery-unit',
    packageName: '@tractor-store-vertical-demo/catalog',
    version: '1.2.3',
    sourceRevision: 'a'.repeat(40),
    buildMarker: 'catalog-build-123',
    unitId: 'catalog@21',
  };
  Object.assign(manifest.backendFederation, {
    deliveryUnit: identity,
    versionBoundary: {
      ...manifest.backendFederation.versionBoundary,
      deliveryUnit: identity,
    },
  });
  return manifest;
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
        unitId: 'catalog@21',
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
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        hostName: 'unverifiedNetworkBackendHost',
        remote: {
          entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
          name: 'verticalCatalogBackend',
          type: 'commonjs-module',
        },
      }),
    ).rejects.toThrow(/requires verified entry bytes/u);
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
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
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

  test('does not let a custom runtime bypass network entry verification', async () => {
    const loadRemote = rs.fn(async () => createManifestEffectApiModule());

    await expect(
      loadBackendFederatedEffectApi({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
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
        compatibility: { unitId: 'catalog@21', build: 'catalog-build-123' },
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
      expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
      hostName: 'shellBackendHost',
      remote,
    });

    expect(loaded.backendFederationContract).toEqual({
      compatibility: { unitId: 'catalog@21', build: 'catalog-build-123' },
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    });
    expect(loaded.contract).toEqual({ ownerId: 'catalog' });
    expect(loaded.default).toEqual({ brand: 'defineEffectBff-runtime' });
  });

  test('initializes one edge binding container once across repeated exposes', async () => {
    let providerCalls = 0;
    const initCalls: unknown[][] = [];
    const getCalls: string[] = [];
    const runtime = createEdgeBackendFederationRuntime({
      expected: {
        buildMarker: 'checkout-build-7',
        unitId: 'checkout@7',
      },
      hostName: 'cloudflareWorkerBackendHost',
      plugins: [
        createEdgeBackendFederationLoadEntryPlugin({
          resolveEntry() {
            providerCalls += 1;
            return {
              get(id) {
                getCalls.push(id);
                return () => ({
                  backendFederationContract: {
                    compatibility: {
                      build: 'checkout-build-7',
                      unitId: 'checkout@7',
                    },
                    runtimeFramework: 'effect',
                    strictEffectApproach: true,
                  },
                  expose: id,
                  runtime: { brand: 'defineEffectBff-runtime' },
                });
              },
              init(...args) {
                initCalls.push(args);
              },
            };
          },
        }),
      ],
      remote: {
        entry: 'binding:verticalCheckoutBackend',
        name: 'verticalCheckoutBackend',
        type: 'module',
      },
    });

    const [first, repeated, secondExpose] = await Promise.all([
      runtime.loadRemote<{ expose: string }>(
        'verticalCheckoutBackend/effect-api',
      ),
      runtime.loadRemote<{ expose: string }>(
        'verticalCheckoutBackend/effect-api',
      ),
      runtime.loadRemote<{ expose: string }>('verticalCheckoutBackend/health'),
    ]);

    expect(first).toBe(repeated);
    expect(secondExpose).toEqual(
      expect.objectContaining({ expose: './health' }),
    );
    expect(providerCalls).toBe(1);
    expect(initCalls).toEqual([[{ hostName: 'cloudflareWorkerBackendHost' }]]);
    expect(getCalls).toEqual(['./effect-api', './health']);
  });

  test('validates delivery-unit identity on the edge binding path', async () => {
    await expect(
      loadEdgeBackendFederatedEffectApi({
        expected: { buildMarker: 'expected-build', unitId: 'checkout@7' },
        hostName: 'cloudflareWorkerBackendHost',
        plugins: [
          createEdgeBackendFederationLoadEntryPlugin({
            resolveEntry() {
              return createEffectApiEntryExports({
                backendFederationContract: {
                  compatibility: {
                    build: 'stale-build',
                    unitId: 'checkout@7',
                  },
                  runtimeFramework: 'effect',
                  strictEffectApproach: true,
                },
                runtime: { brand: 'defineEffectBff-runtime' },
              });
            },
          }),
        ],
        remote: {
          entry: 'binding:verticalCheckoutBackend',
          name: 'verticalCheckoutBackend',
          type: 'module',
        },
      }),
    ).rejects.toThrow(/delivery-unit identity mismatch.*stale-build/su);
  });

  test('fails closed for network entries supplied through the edge remotes array', async () => {
    await expect(
      loadEdgeBackendFederatedEffectApi({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
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
    ).rejects.toThrow(/static or service-binding entries/u);
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
    const manifest = withDeliveryUnitIdentity(createBackendManifest());
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
    const manifest = withDeliveryUnitIdentity(
      createVerifiedBackendManifest(entrySource),
    );
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

  test('rejects a backend expose without strict Effect metadata', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalNonStrictBackend',
      entry: 'service:verticalNonStrictBackend',
      type: 'module',
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'nonStrictBackendHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry() {
            return createEffectApiEntryExports({
              backendFederationContract: {
                compatibility: {
                  unitId: 'catalog@21',
                  build: 'catalog-build-123',
                },
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
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        hostName: 'nonStrictBackendHost',
        remote,
        runtime,
      }),
    ).rejects.toThrow(/strictEffectApproach: true/u);
  });

  describe('shared manifest-plus-entry load deadline', () => {
    function createHangingFetch() {
      let settled = false;
      let resolveResponse!: (response: Response) => void;
      const response = new Promise<Response>(resolve => {
        resolveResponse = resolve;
      });
      const fetch = rs.fn(async () => response);
      return {
        fetch,
        resolveWithManifest(manifest: unknown) {
          if (settled) {
            return;
          }
          settled = true;
          resolveResponse(new Response(JSON.stringify(manifest)));
        },
      };
    }

    function loadWithHangingManifestFetch(
      overrides: Partial<
        Pick<
          Parameters<typeof loadBackendFederatedEffectApiFromManifest>[0],
          'entryPolicy' | 'manifestPolicy' | 'timeoutMs'
        >
      >,
    ) {
      // The manifest's own declared remote (service:verticalCatalogBackend)
      // is a caller-pinned static binding, matched via `remote` below, so a
      // load that survives to the entry stage succeeds instead of tripping
      // the "network manifests cannot select local/global/plugin entry"
      // guard that a bare network-manifest reference would hit.
      const manifest = withDeliveryUnitIdentity(createBackendManifest());
      const { fetch, resolveWithManifest } = createHangingFetch();
      const resolveEntry = rs.fn(() =>
        createEffectApiEntryExports(createManifestEffectApiModule()),
      );
      const resultPromise = loadBackendFederatedEffectApiFromManifest({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        fetch,
        hostName: 'sharedDeadlineHost',
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
        plugins: [createBackendFederationLoadEntryPlugin({ resolveEntry })],
        remote: {
          entry: 'service:verticalCatalogBackend',
          name: 'verticalCatalogBackend',
        },
        ...overrides,
      });
      // Attach the outcome handler immediately, in the same tick the
      // promise is created, so nothing is ever unhandled regardless of when
      // fake timers are advanced or the manifest fetch is resolved.
      let outcome: { ok: true } | { error: unknown } | undefined;
      const tracked = resultPromise.then(
        () => {
          outcome = { ok: true };
        },
        error => {
          outcome = { error };
        },
      );
      return {
        fetch,
        manifest,
        resolveEntry,
        resolveWithManifest: () => resolveWithManifest(manifest),
        resultPromise,
        settled: () => outcome !== undefined,
        tracked,
      };
    }

    beforeEach(() => {
      rs.useFakeTimers();
    });

    afterEach(() => {
      rs.useRealTimers();
    });

    test('applies a finite 10s shared default when no timeout is configured', async () => {
      const { resolveEntry, resultPromise } = loadWithHangingManifestFetch({});

      await rs.advanceTimersByTimeAsync(9_999);
      expect(resolveEntry).not.toHaveBeenCalled();

      await rs.advanceTimersByTimeAsync(1);

      await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
      expect(resolveEntry).not.toHaveBeenCalled();
    });

    test('honors an explicit positive outer timeoutMs override', async () => {
      const { resultPromise } = loadWithHangingManifestFetch({
        timeoutMs: 50,
      });

      await rs.advanceTimersByTimeAsync(49);
      await rs.advanceTimersByTimeAsync(1);

      await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
    });

    test('treats an explicit outer timeoutMs of 0 as a deliberate opt-out', async () => {
      const { resolveWithManifest, resultPromise, settled } =
        loadWithHangingManifestFetch({ timeoutMs: 0 });

      await rs.advanceTimersByTimeAsync(1_000_000);
      expect(settled()).toBe(false);

      resolveWithManifest();
      await expect(resultPromise).resolves.toBeDefined();
    });

    test('picks the smallest explicit positive nested policy timeout when no outer override is set', async () => {
      const { resultPromise } = loadWithHangingManifestFetch({
        manifestPolicy: { timeoutMs: 300 },
        entryPolicy: { timeoutMs: 150 },
      });

      await rs.advanceTimersByTimeAsync(149);
      await rs.advanceTimersByTimeAsync(1);

      await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
    });

    test('an explicit nested zero does not disable an explicitly positive nested limit', async () => {
      const { resultPromise } = loadWithHangingManifestFetch({
        manifestPolicy: { timeoutMs: 0 },
        entryPolicy: { timeoutMs: 200 },
      });

      await rs.advanceTimersByTimeAsync(199);
      await rs.advanceTimersByTimeAsync(1);

      await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
    });

    test('opts out only when every explicit nested policy timeout is zero', async () => {
      const { resolveWithManifest, resultPromise, settled } =
        loadWithHangingManifestFetch({
          manifestPolicy: { timeoutMs: 0 },
          entryPolicy: { timeoutMs: 0 },
        });

      await rs.advanceTimersByTimeAsync(1_000_000);
      expect(settled()).toBe(false);

      resolveWithManifest();
      await expect(resultPromise).resolves.toBeDefined();
    });

    test('spends the same shared budget across the manifest and entry network stages, not a fresh one per hop', async () => {
      const entryUrl = 'https://catalog.example.test/backendRemoteEntry.cjs';
      const entrySource = createLiveBackendEntrySource(
        'verticalCatalogBackend',
        'catalog-build-123',
      );
      const manifest = withDeliveryUnitIdentity(
        createVerifiedBackendManifest(entrySource, entryUrl),
      );
      const { fetch: manifestFetch, resolveWithManifest } =
        createHangingFetch();
      const entryFetch = rs.fn(() => new Promise<Response>(() => {}));

      const resultPromise = loadBackendFederatedEffectApiFromManifest({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        fetch: manifestFetch,
        hostName: 'sharedDeadlineAcrossStagesHost',
        manifestUrl: 'https://catalog.example.test/backend-mf-manifest.json',
        timeoutMs: 100,
        entryPolicy: {
          expected: {
            byteLength: Buffer.byteLength(entrySource),
            entryUrl,
            remoteName: 'verticalCatalogBackend',
            sha256: createHash('sha256').update(entrySource).digest('hex'),
          },
          fetch: entryFetch,
        },
      });
      resultPromise.then(
        () => {},
        () => {},
      );

      // The manifest fetch consumes 60ms of the shared 100ms budget before
      // resolving; the entry stage then begins with only ~40ms left of the
      // SAME deadline.
      await rs.advanceTimersByTimeAsync(60);
      resolveWithManifest(manifest);
      await rs.advanceTimersByTimeAsync(0);
      expect(entryFetch).toHaveBeenCalledTimes(1);

      // If the entry stage reset its own fresh 100ms budget instead of
      // spending down the remaining shared allowance, this would still be
      // pending at the 100ms mark.
      await rs.advanceTimersByTimeAsync(39);
      await rs.advanceTimersByTimeAsync(1);

      await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
      expect(entryFetch).toHaveBeenCalledTimes(1);
    });

    describe('a hanging entry stage (PR87 verified deadline correction)', () => {
      // The shared timeout/abort only cancels network fetches wired to the
      // shared signal. A caller-pinned service/static entry plugin (or a
      // custom runtime) is arbitrary, uncooperative JS: nothing can force
      // its loadEntry/init/get/loadRemote promise to actually stop running.
      // These tests prove the top-level load still *settles* on the shared
      // deadline/abort in that case, instead of hanging forever.
      function manifestOptions() {
        return {
          expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
          manifest: withDeliveryUnitIdentity(createBackendManifest()),
        } as const;
      }

      test('settles a hanging caller-pinned loadEntry plugin on the default shared deadline', async () => {
        const resolveEntry = rs.fn(() => new Promise<never>(() => {}));
        const resultPromise = loadBackendFederatedEffectApiFromManifest({
          ...manifestOptions(),
          hostName: 'hangingLoadEntryHost',
          plugins: [createBackendFederationLoadEntryPlugin({ resolveEntry })],
        });
        resultPromise.then(
          () => {},
          () => {},
        );

        await rs.advanceTimersByTimeAsync(9_999);
        expect(resolveEntry).toHaveBeenCalledTimes(1);

        await rs.advanceTimersByTimeAsync(1);
        await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
      });

      test('settles a hanging entry.init() on an explicit shared deadline, then falls back', async () => {
        const initHang = new Promise<void>(() => {});
        const fallbackErrors: BackendFederationManifestAdapterError[] = [];
        const resultPromise = loadBackendFederatedEffectApiFromManifest({
          ...manifestOptions(),
          hostName: 'hangingInitHost',
          timeoutMs: 25,
          plugins: [
            createBackendFederationLoadEntryPlugin({
              resolveEntry: () => ({
                init: () => initHang,
                get(id: string) {
                  if (id !== './effect-api') {
                    throw new Error(`Unexpected expose ${id}`);
                  }
                  return async () => createManifestEffectApiModule();
                },
              }),
            }),
          ],
          fallback(error) {
            fallbackErrors.push(error);
            return createManifestEffectApiModule({
              runtime: { brand: 'fallback-after-hang' },
            });
          },
        });

        await rs.advanceTimersByTimeAsync(24);
        await rs.advanceTimersByTimeAsync(1);

        const loaded = await resultPromise;
        expect(loaded.runtime).toEqual({ brand: 'fallback-after-hang' });
        expect(fallbackErrors).toHaveLength(1);
        expect(fallbackErrors[0].code).toBe('timeout');
      });

      test('settles a hanging custom runtime.loadRemote on the default shared deadline', async () => {
        const loadRemote = rs.fn(() => new Promise<never>(() => {}));
        const resultPromise = loadBackendFederatedEffectApiFromManifest({
          ...manifestOptions(),
          hostName: 'hangingRuntimeLoadRemoteHost',
          runtime: { loadRemote } as never,
        });
        resultPromise.then(
          () => {},
          () => {},
        );

        await rs.advanceTimersByTimeAsync(9_999);
        expect(loadRemote).toHaveBeenCalledTimes(1);

        await rs.advanceTimersByTimeAsync(1);
        await expect(resultPromise).rejects.toMatchObject({ code: 'timeout' });
      });

      test('rejects promptly on an external abort while a loadEntry plugin hangs, and observes its late rejection', async () => {
        const controller = new AbortController();
        let rejectHangingEntry!: (error: unknown) => void;
        const hangingEntry = new Promise<BackendFederationEntryExports>(
          (_resolve, reject) => {
            rejectHangingEntry = reject;
          },
        );

        const resultPromise = loadBackendFederatedEffectApiFromManifest({
          ...manifestOptions(),
          hostName: 'externalAbortHangingEntryHost',
          plugins: [
            createBackendFederationLoadEntryPlugin({
              resolveEntry: () => hangingEntry,
            }),
          ],
          signal: controller.signal,
        });

        // Give the plugin's promise a tick to be requested, then cancel from
        // the outside well before the 10s default deadline would ever fire.
        await rs.advanceTimersByTimeAsync(5);
        controller.abort(new Error('caller cancelled'));

        await expect(resultPromise).rejects.toMatchObject({
          code: 'remote_unavailable',
        });

        // The plugin never actually stops running; it rejects later, well
        // after the adapter already settled via the external abort. That
        // late rejection must be observed here instead of surfacing as an
        // unhandled rejection for the suite.
        rejectHangingEntry(new Error('late plugin failure'));
        await Promise.resolve();
        await Promise.resolve();
      });
    });
  });

  describe('ADR-0019 delivery-unit identity root', () => {
    function createBackendManifestWithDeliveryUnit(
      deliveryUnit: Record<string, unknown>,
    ) {
      const manifest = createBackendManifest();
      manifest.backendFederation.versionBoundary.deliveryUnit = {
        ...manifest.backendFederation.versionBoundary.deliveryUnit,
        ...deliveryUnit,
      };
      return manifest;
    }

    test('falls back with a typed error when expected.unitId does not match the manifest delivery unit', async () => {
      const manifest = createBackendManifestWithDeliveryUnit({
        unitId: 'catalog@21',
        buildMarker: 'catalog-build-123',
      });
      const fallbackErrors: BackendFederationManifestAdapterError[] = [];

      const loaded = await loadBackendFederatedEffectApiFromManifest({
        hostName: 'unitIdMismatchBackendHost',
        manifest,
        expected: { unitId: 'catalog@17' },
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
      expect(fallbackErrors[0].failureEvent).toBe(
        'modernjs:microvertical-server-fallback',
      );
      expect(loaded.runtime).toEqual({ brand: 'typed-effect-fallback' });
    });
  });
});

describe('caller-pinned backend federation regressions', () => {
  const createPinnedBackendRuntime = ({
    entryExports,
    module,
    remoteName = 'verticalExploreBackend',
    scheme = 'static',
  }: {
    entryExports?: BackendFederationEntryExports;
    module?: unknown;
    remoteName?: string;
    scheme?: 'service' | 'static';
  }) => {
    const remote: BackendFederationRemote = {
      name: remoteName,
      type: 'module',
      entry: `${scheme}:${remoteName}`,
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
      plugins: [
        createBackendFederationLoadEntryPlugin({
          resolveEntry: () =>
            entryExports ?? {
              get(id) {
                if (id !== './effect-api') {
                  throw new Error(`unexpected expose ${id}`);
                }
                return async () => module;
              },
            },
        }),
      ],
    });
    return { remote, runtime };
  };

  const strictEffectApiModule = (remoteName = 'verticalExploreBackend') => ({
    backendFederationContract: {
      compatibility: { unitId: 'catalog@21', build: 'catalog-build-123' },
      name: remoteName,
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    },
    api: { id: 'api' },
    runtime: { id: 'runtime' },
  });

  test('rejects a caller-pinned remote whose loaded metadata names a different backend', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({
      entryExports: createEffectApiEntryExports({
        ...strictEffectApiModule('verticalDecideBackend'),
      }),
    });

    await expect(
      loadBackendFederatedEffectApi({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        runtime,
        remote,
      }),
    ).rejects.toThrow('metadata name mismatch');
  });
  test.each([
    undefined,
    { unitId: 'catalog@21' },
    { unitId: 'catalog@21', build: '' },
    { unitId: 'catalog@21', build: 'another-build' },
  ])('rejects missing or drifting executed identity independently of pinned remote identity: %j', async compatibility => {
    const module = strictEffectApiModule();
    const { remote, runtime } = createPinnedBackendRuntime({
      module: {
        ...module,
        backendFederationContract: {
          ...module.backendFederationContract,
          compatibility,
        },
      },
    });
    await expect(
      loadBackendFederatedEffectApi({
        expected: { unitId: 'catalog@21', buildMarker: 'catalog-build-123' },
        runtime,
        remote,
      }),
    ).rejects.toThrow('delivery-unit identity mismatch');
  });
});
