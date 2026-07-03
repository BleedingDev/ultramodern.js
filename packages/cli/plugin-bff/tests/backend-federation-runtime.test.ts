import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type BackendFederationEntryExports,
  type BackendFederationRemote,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
  loadBackendFederatedEffectApi,
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

describe('backend federation runtime', () => {
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
      entry: 'https://checkout.example.test/backendRemoteEntry.mjs',
      type: 'module',
    };
    const resolvedRemotes: BackendFederationRemote[] = [];
    const runtime = createBackendFederationRuntime({
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

    const loaded = await loadBackendFederatedEffectApi({
      hostName: 'cloudflareWorkerBackendHost',
      remote,
      runtime,
    });

    expect(resolvedRemotes).toEqual([
      expect.objectContaining({
        name: 'verticalCheckoutBackend',
        entry: 'https://checkout.example.test/backendRemoteEntry.mjs',
        type: 'module',
      }),
    ]);
    expect(loaded.runtime).toEqual({ brand: 'defineEffectBff-runtime' });
  });

  test('rejects backend exposes that do not preserve strict Effect contract metadata', async () => {
    const remote: BackendFederationRemote = {
      name: 'verticalUnsafeBackend',
      entry: 'https://unsafe.example.test/backendRemoteEntry.mjs',
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
      entry: 'https://unsafe.example.test/backendRemoteEntry.mjs',
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
      entry: 'https://missing-contract.example.test/backendRemoteEntry.mjs',
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
});
