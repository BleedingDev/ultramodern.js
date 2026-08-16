import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { semver } from '@modern-js/utils';
import { build } from 'esbuild';
import defaultBffPlugin, { bffPlugin } from '../src/cli';
import {
  createBackendFederationRuntime,
  loadBackendFederatedEffectApi,
} from '../src/runtime/effect';
import { EffectAdapter } from '../src/runtime/effect/adapter';
import {
  type EffectContext,
  useEffectContext,
  useOperationContext,
} from '../src/runtime/effect/context';
import clientGenerator, {
  type APILoaderOptions,
} from '../src/utils/clientGenerator';
import runtimeGenerator from '../src/utils/runtimeGenerator';

const require = createRequire(import.meta.url);

describe('plugin-bff regressions', () => {
  test('default and named CLI exports create the same public plugin', () => {
    expect(defaultBffPlugin).toBe(bffPlugin);
    expect(defaultBffPlugin().name).toBe('@modern-js/plugin-bff');
  });

  test('package server export is Effect-first and Hono remains explicit compatibility', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
    );

    expect(packageJson.exports['./package.json']).toBe('./package.json');
    expect(packageJson.exports['./server']).toEqual(
      packageJson.exports['./effect-server'],
    );
    expect(packageJson.exports['./effect']).toEqual(
      packageJson.exports['./effect-server'],
    );
    expect(packageJson.exports['./hono-server']).toEqual({
      types: './dist/types/runtime/hono/index.d.ts',
      node: {
        import: './dist/esm-node/runtime/hono/index.mjs',
        require: './dist/cjs/runtime/hono/index.js',
      },
      default: './dist/cjs/runtime/hono/index.js',
    });
    expect(packageJson.typesVersions['*'].server).toEqual(
      packageJson.typesVersions['*']['effect-server'],
    );
    expect(packageJson.typesVersions['*'].effect).toEqual(
      packageJson.typesVersions['*']['effect-server'],
    );
    expect(packageJson.typesVersions['*']['hono-server']).toEqual([
      './dist/types/runtime/hono/index.d.ts',
    ]);
    expect(packageJson.exports['./effect-client']).toEqual({
      types: './dist/types/runtime/effect-client/index.d.ts',
      node: {
        import: './dist/esm-node/runtime/effect-client/index.mjs',
        require: './dist/cjs/runtime/effect-client/index.js',
      },
      default: './dist/cjs/runtime/effect-client/index.js',
    });
    expect(packageJson.typesVersions['*']['effect-client']).toEqual([
      './dist/types/runtime/effect-client/index.d.ts',
    ]);

    const effectEntry = require('@modern-js/plugin-bff/effect') as {
      defineEffectRpcBff?: unknown;
    };
    const dataPlatformEntry =
      require('@modern-js/plugin-bff/data-platform') as Record<string, unknown>;
    expect(effectEntry.defineEffectRpcBff).toBeTypeOf('function');
    for (const name of [
      'buildQueryKey',
      'buildScopeKey',
      'createHydrationEnvelope',
      'createInvalidationEvent',
      'createOperationId',
      'createRequestEnvelope',
      'deriveChildTraceContext',
      'shouldApplyInvalidation',
      'validateHydrationEnvelope',
      'validateRequestEnvelope',
    ]) {
      expect(dataPlatformEntry[name]).toBeTypeOf('function');
    }

    const openTelemetryPackage = JSON.parse(
      fs.readFileSync(
        require.resolve('@effect/opentelemetry/package.json'),
        'utf8',
      ),
    );
    for (const [peerName, peerRange] of Object.entries(
      openTelemetryPackage.peerDependencies ?? {},
    )) {
      // `effect` is declared as an optional exact peer (not a dependency) so a
      // consumer keeps a single Effect Context/Service identity; every other
      // @effect/opentelemetry peer stays a hard dependency.
      const dependencyRange =
        packageJson.dependencies[peerName] ??
        packageJson.peerDependencies?.[peerName];
      expect({
        compatible: semver.subset(dependencyRange, peerRange as string, {
          includePrerelease: true,
        }),
        dependencyRange,
        peerName,
        peerRange,
      }).toEqual({
        compatible: true,
        dependencyRange: expect.any(String),
        peerName,
        peerRange,
      });
    }

    // FORK: upstream's plugin-bff has no `effect` dependency and no
    // `peerDependencies` block at all — the whole peer/optional-peer/devDep
    // triple below is fork-added (see FORK-DIVERGENCE.md, packages/cli
    // plugin-bff). A sync merge that takes "theirs" on package.json silently
    // drops the peer and reintroduces the duplicate-Effect-identity defect.
    //
    // `@effect/opentelemetry` MUST move with `effect`: it declares a REQUIRED
    // (non-optional) `effect` peer of its own, so leaving it in `dependencies`
    // would re-impose that peer on every hono-only consumer transitively and
    // make the "optional" claim false.
    for (const name of ['effect', '@effect/opentelemetry']) {
      expect({
        name,
        dependency: packageJson.dependencies[name],
        peer: packageJson.peerDependencies?.[name],
        optional: packageJson.peerDependenciesMeta?.[name]?.optional,
        dev: packageJson.devDependencies?.[name],
      }).toEqual({
        name,
        dependency: undefined,
        peer: packageJson.devDependencies?.[name],
        optional: true,
        dev: expect.stringMatching(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
      });
    }
    // The whole Effect cohort moves in lockstep at one exact version.
    expect(packageJson.devDependencies['@effect/opentelemetry']).toBe(
      packageJson.devDependencies.effect,
    );
  });

  test('server entry keeps Effect in an asynchronous bundle', async () => {
    const result = await build({
      bundle: true,
      entryPoints: [path.resolve(__dirname, '../src/server.ts')],
      format: 'esm',
      metafile: true,
      outdir: 'out',
      packages: 'external',
      platform: 'node',
      splitting: true,
      write: false,
    });
    const entryOutput = Object.values(result.metafile.outputs).find(output =>
      output.entryPoint?.endsWith('/server.ts'),
    );
    if (!entryOutput) {
      throw new Error('server entry output was not generated');
    }
    const dynamicOutputNames = entryOutput.imports
      .filter(moduleImport => moduleImport.kind === 'dynamic-import')
      .map(moduleImport => path.basename(moduleImport.path));
    const dynamicEntries = Object.entries(result.metafile.outputs)
      .filter(([outputPath]) =>
        dynamicOutputNames.includes(path.basename(outputPath)),
      )
      .map(([, output]) => path.basename(output.entryPoint ?? ''));

    expect(dynamicEntries).toContain('adapter.ts');
    expect(
      entryOutput.imports.filter(
        moduleImport =>
          moduleImport.kind === 'import-statement' &&
          (moduleImport.path === 'effect' ||
            moduleImport.path.startsWith('effect/') ||
            moduleImport.path.startsWith('@effect/')),
      ),
    ).toEqual([]);
  });

  const backendEffectApiModuleUrl = (remoteName = 'verticalExploreBackend') =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(`
    export const backendFederationContract = {
      name: '${remoteName}',
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    };
    export const api = { id: 'api' };
    export const runtime = { id: 'runtime' };
  `)}`;

  const commonjsBackendRemoteEntry = (source: string) =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;

  test('backend federation runtime loads Tractor proof-shaped strict Effect API exposes', async () => {
    const exposedModuleUrl = backendEffectApiModuleUrl();
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          init(scope) {
            globalThis.__modernBackendHostName = scope.hostName;
          },
          get(id) {
            if (id !== './effect-api') {
              throw new Error('unexpected expose ' + id);
            }
            return async () => import(${JSON.stringify(exposedModuleUrl)});
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

    expect(globalThis.__modernBackendHostName).toBe('proofHost');
    expect(loaded.backendFederationContract?.name).toBe(
      'verticalExploreBackend',
    );
    expect(loaded.api).toEqual({ id: 'api' });
    expect(loaded.runtime).toEqual({ id: 'runtime' });
  });

  test('backend federation runtime supports CommonJS exports alias remotes', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        exports.init = (scope) => {
          globalThis.__modernBackendExportsAliasHostName = scope.hostName;
        };
        exports.get = (id) => {
          if (id !== './effect-api') {
            throw new Error('unexpected expose ' + id);
          }
          return async () => ({
            backendFederationContract: {
              name: 'verticalExploreBackend',
              runtimeFramework: 'effect',
              strictEffectApproach: true,
            },
            api: { id: 'api' },
            runtime: { id: 'runtime' },
          });
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

    expect(globalThis.__modernBackendExportsAliasHostName).toBe('proofHost');
    expect(loaded.api).toEqual({ id: 'api' });
  });

  test('backend federation runtime loads fetched CommonJS remote entries', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = async input => {
      fetchCalls.push(String(input));
      return new Response(
        `
          module.exports = {
            get(id) {
              if (id !== './effect-api') {
                throw new Error('unexpected expose ' + id);
              }
              return async () => ({
                backendFederationContract: {
                  name: 'verticalExploreBackend',
                  runtimeFramework: 'effect',
                  strictEffectApproach: true,
                },
                api: { id: 'api' },
                runtime: { id: 'runtime' },
              });
            },
          };
        `,
        { status: 200 },
      );
    };
    try {
      const remote = {
        name: 'verticalExploreBackend',
        type: 'commonjs-module' as const,
        entry: 'https://cdn.example.test/backendRemoteEntry.js',
      };
      const runtime = createBackendFederationRuntime({
        hostName: 'proofHost',
        remote,
      });

      const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

      expect(fetchCalls).toEqual([
        'https://cdn.example.test/backendRemoteEntry.js',
      ]);
      expect(loaded.runtime).toEqual({ id: 'runtime' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('backend federation runtime rejects failed fetched remote entries with remote name and status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('missing', { status: 503 });
    try {
      const remote = {
        name: 'verticalExploreBackend',
        type: 'commonjs-module' as const,
        entry: 'https://cdn.example.test/backendRemoteEntry.js',
      };
      const runtime = createBackendFederationRuntime({
        hostName: 'proofHost',
        remote,
      });

      await expect(
        loadBackendFederatedEffectApi({ runtime, remote }),
      ).rejects.toThrow(
        'Failed to load backend federation remote verticalExploreBackend: 503',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('backend federation runtime loads ESM module remote entries', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'module' as const,
      entry: `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        export function init(scope) {
          globalThis.__modernBackendModuleHostName = scope.hostName;
        }
        export function get(id) {
          if (id !== './effect-api') {
            throw new Error('unexpected expose ' + id);
          }
          return async () => ({
            backendFederationContract: {
              name: 'verticalExploreBackend',
              runtimeFramework: 'effect',
              strictEffectApproach: true,
            },
            api: { id: 'api' },
            runtime: { id: 'runtime' },
          });
        }
      `)}`,
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

    expect(globalThis.__modernBackendModuleHostName).toBe('proofHost');
    expect(loaded.api).toEqual({ id: 'api' });
  });

  test('backend federation runtime rejects missing strict Effect metadata', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          get() {
            return async () => ({
              backendFederationContract: {
                name: 'verticalExploreBackend',
                runtimeFramework: 'hono',
                strictEffectApproach: false,
              },
              api: {},
              runtime: {},
            });
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must expose strict Effect metadata');
  });

  test('backend federation runtime rejects mismatched remote metadata names', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          get() {
            return async () => ({
              backendFederationContract: {
                name: 'verticalDecideBackend',
                runtimeFramework: 'effect',
                strictEffectApproach: true,
              },
              api: {},
              runtime: {},
            });
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('metadata name mismatch');
  });

  test('backend federation runtime rejects exposes missing api or runtime', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          get() {
            return async () => ({
              backendFederationContract: {
                name: 'verticalExploreBackend',
                runtimeFramework: 'effect',
                strictEffectApproach: true,
              },
              api: {},
            });
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must expose api and runtime');
  });

  test('backend federation runtime rejects exposes that load non-object modules', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          get() {
            return async () => null;
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must load an object module');
  });

  test('backend federation runtime rejects unknown remote names', async () => {
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remotes: [],
    });

    await expect(
      loadBackendFederatedEffectApi({
        runtime,
        remoteName: 'verticalExploreBackend',
      }),
    ).rejects.toThrow('Missing backend federation remote');
  });

  test('backend federation runtime propagates wrong expose errors', async () => {
    const remote = {
      name: 'verticalExploreBackend',
      type: 'commonjs-module' as const,
      entry: commonjsBackendRemoteEntry(`
        module.exports = {
          get(id) {
            if (id !== './effect-api') {
              throw new Error('unexpected expose ' + id);
            }
            return async () => ({});
          },
        };
      `),
    };
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remote,
    });

    await expect(
      loadBackendFederatedEffectApi({
        runtime,
        remote,
        expose: './wrong',
      }),
    ).rejects.toThrow('unexpected expose ./wrong');
  });

  test('effect adapter strips API prefix in enableHandleWeb mode', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;

    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      reloadLegacyApiRoutes: () => Promise<void>;
      handler: (request: Request) => Promise<Response>;
    };
    let seenPath = '';

    adapterState.reloadHandler = async () => {
      adapterState.handler = async (request: Request) => {
        seenPath = new URL(request.url).pathname;
        return new Response('ok');
      };
    };
    adapterState.reloadLegacyApiRoutes = async () => {};

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: true,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const context = {
      req: {
        raw: new Request('http://localhost/api/hello'),
        path: '/api/hello',
        method: 'GET',
      },
      env: {},
    };

    const response = (await middleware.handler(
      context as unknown,
      async () => {},
    )) as Response | undefined;

    expect(seenPath).toBe('/hello');
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(200);
  });

  test('effect adapter returns handler-thrown Response instances', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;
    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: () => Promise<Response>;
    };
    adapterState.reloadHandler = async () => {
      adapterState.handler = async () => {
        throw new Response('missing from adapter handler', {
          status: 404,
          headers: {
            'x-effect-adapter': 'thrown-response',
          },
        });
      };
    };

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: false,
    });

    const response = (await middlewares[0]!.handler(
      {
        req: {
          raw: new Request('http://localhost/api/missing'),
          path: '/api/missing',
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(response?.status).toBe(404);
    expect(response?.headers.get('x-effect-adapter')).toBe('thrown-response');
    await expect(response?.text()).resolves.toBe(
      'missing from adapter handler',
    );
  });

  test('effect adapter wraps non-Response handler returns', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;
    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: () => Promise<Response>;
    };
    adapterState.reloadHandler = async () => {
      adapterState.handler = async () => 'not response' as unknown as Response;
    };

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: false,
    });

    const response = (await middlewares[0]!.handler(
      {
        req: {
          raw: new Request('http://localhost/api/invalid'),
          path: '/api/invalid',
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal Server Error',
        status: 500,
      },
    });
  });

  test('effect adapter passes 404 responses to next in enableHandleWeb mode', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;
    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: () => Promise<Response>;
    };
    adapterState.reloadHandler = async () => {
      adapterState.handler = async () =>
        new Response('not found', { status: 404 });
    };

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: true,
    });

    let nextCalls = 0;
    const response = await middlewares[0]!.handler(
      {
        req: {
          raw: new Request('http://localhost/api/not-found'),
          path: '/api/not-found',
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {
        nextCalls += 1;
      },
    );

    expect(nextCalls).toBe(1);
    expect(response).toBeUndefined();
  });

  test('effect adapter preserves onError before safe maintenance fallback', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const onErrorCalls: Array<{
      error: unknown;
      canJson: boolean;
    }> = [];
    const maintenanceError = Object.assign(new Error('maintenance detail'), {
      status: 503,
      retryAfterMs: 2500,
    });
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
      getServerConfig() {
        return {
          onError: (error: unknown, context: { json?: unknown }) => {
            onErrorCalls.push({
              error,
              canJson: typeof context.json === 'function',
            });
          },
        };
      },
    } as unknown;

    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: () => Promise<Response>;
    };

    adapterState.reloadHandler = async () => {
      adapterState.handler = async () => {
        throw maintenanceError;
      };
    };

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: false,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const response = (await middleware.handler(
      {
        req: {
          raw: new Request('http://localhost/api/maintenance'),
          path: '/api/maintenance',
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(onErrorCalls).toEqual([
      {
        error: maintenanceError,
        canJson: true,
      },
    ]);
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Retry-After')).toBe('3');
    await expect(response?.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service Unavailable',
        status: 503,
      },
    });
  });

  test('effect adapter synthetic json context accepts response init in onError', async () => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const runtimeError = new Error('custom failure');
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
      getServerConfig() {
        return {
          onError: (
            error: unknown,
            context: {
              json: (
                data: unknown,
                init?: { status?: number; headers?: HeadersInit },
              ) => Response;
            },
          ) => {
            expect(error).toBe(runtimeError);
            return context.json(
              {
                handled: true,
              },
              {
                status: 418,
                headers: {
                  'x-error-source': 'custom-on-error',
                },
              },
            );
          },
        };
      },
    } as unknown;

    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: () => Promise<Response>;
    };

    adapterState.reloadHandler = async () => {
      adapterState.handler = async () => {
        throw runtimeError;
      };
    };

    await adapter.registerMiddleware({
      prefix: '/api',
      enableHandleWeb: false,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const response = (await middleware.handler(
      {
        req: {
          raw: new Request('http://localhost/api/custom-error'),
          path: '/api/custom-error',
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(response?.status).toBe(418);
    expect(response?.headers.get('x-error-source')).toBe('custom-on-error');
    await expect(response?.json()).resolves.toEqual({
      handled: true,
    });
  });

  test.each([
    {
      surface: 'dev mounted web middleware',
      prefix: '/api',
      enableHandleWeb: true,
      url: 'http://shell.local/api/whoami',
      contextPath: '/api/whoami',
      servicePath: '/whoami',
    },
    {
      surface: 'build mounted API middleware',
      prefix: '/api',
      enableHandleWeb: false,
      url: 'http://shell.local/api/whoami',
      contextPath: '/api/whoami',
      servicePath: '/whoami',
    },
    {
      surface: 'serve root middleware',
      prefix: '/',
      enableHandleWeb: false,
      url: 'http://remote.local/whoami',
      contextPath: '/whoami',
      servicePath: '/whoami',
    },
  ])('propagates auth, tenant, locale, and trace metadata into Effect services for $surface', async ({
    prefix,
    enableHandleWeb,
    url,
    contextPath,
    servicePath,
  }) => {
    const middlewares: Array<{
      handler: (ctx: unknown, next: () => Promise<void>) => Promise<unknown>;
    }> = [];
    const api = {
      getServerContext() {
        return {
          bffRuntimeFramework: 'effect',
          middlewares,
        };
      },
    } as unknown;

    const adapter = new EffectAdapter(api as ServerPluginAPI);
    const adapterState = adapter as unknown as {
      reloadHandler: () => Promise<void>;
      handler: (request: Request, context: EffectContext) => Promise<Response>;
    };

    adapterState.reloadHandler = async () => {
      adapterState.handler = async (
        request: Request,
        context: EffectContext,
      ) => {
        const storedContext = useEffectContext();
        const operationContext = useOperationContext();
        return Response.json({
          request: {
            auth: request.headers.get('authorization'),
            tenant: request.headers.get('x-tenant-id'),
            locale: request.headers.get('accept-language'),
            trace: request.headers.get('traceparent'),
            correlation: request.headers.get('x-correlation-id'),
            path: new URL(request.url).pathname,
          },
          explicitContext: {
            auth: context.request.headers.get('authorization'),
            tenant: context.request.headers.get('x-tenant-id'),
            locale: context.request.headers.get('accept-language'),
            trace: context.request.headers.get('traceparent'),
            correlation: context.request.headers.get('x-correlation-id'),
            path: new URL(context.request.url).pathname,
          },
          storedContext: {
            auth: storedContext.request.headers.get('authorization'),
            tenant: storedContext.request.headers.get('x-tenant-id'),
            locale: storedContext.request.headers.get('accept-language'),
            trace: storedContext.request.headers.get('traceparent'),
            correlation: storedContext.request.headers.get('x-correlation-id'),
            path: new URL(storedContext.request.url).pathname,
          },
          middleware: {
            path: context.path,
            method: context.method,
          },
          operationContext,
        });
      };
    };

    await adapter.registerMiddleware({
      prefix,
      enableHandleWeb,
    });

    const middleware = middlewares[0];
    expect(middleware).toBeDefined();

    const response = (await middleware.handler(
      {
        req: {
          raw: new Request(url, {
            headers: {
              authorization: 'Bearer shell-user-token',
              'x-tenant-id': 'tenant-acme',
              'accept-language': 'cs-CZ, en;q=0.8',
              traceparent:
                '00-11111111111111111111111111111111-2222222222222222-01',
              'x-correlation-id': 'corr-shell-remote-001',
            },
          }),
          path: contextPath,
          method: 'GET',
        },
        env: {},
      } as unknown,
      async () => {},
    )) as Response | undefined;

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      request: {
        auth: 'Bearer shell-user-token',
        tenant: 'tenant-acme',
        locale: 'cs-CZ, en;q=0.8',
        trace: '00-11111111111111111111111111111111-2222222222222222-01',
        correlation: 'corr-shell-remote-001',
        path: servicePath,
      },
      explicitContext: {
        auth: 'Bearer shell-user-token',
        tenant: 'tenant-acme',
        locale: 'cs-CZ, en;q=0.8',
        trace: '00-11111111111111111111111111111111-2222222222222222-01',
        correlation: 'corr-shell-remote-001',
        path: servicePath,
      },
      storedContext: {
        auth: 'Bearer shell-user-token',
        tenant: 'tenant-acme',
        locale: 'cs-CZ, en;q=0.8',
        trace: '00-11111111111111111111111111111111-2222222222222222-01',
        correlation: 'corr-shell-remote-001',
        path: servicePath,
      },
      middleware: {
        path: contextPath,
        method: 'GET',
      },
      operationContext: {
        ...(contextPath !== servicePath
          ? {
              attributes: {
                mountedPath: contextPath,
              },
            }
          : {}),
        locale: 'cs-CZ, en;q=0.8',
        method: 'GET',
        routePath: servicePath,
        source: 'effect-adapter',
        traceId: '11111111111111111111111111111111',
        spanId: '2222222222222222',
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      },
    });
  });

  test('effect adapter resolves default api entry when server context omits apiDirectory', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-entry-'),
    );

    try {
      const entryFile = path.join(appDir, 'api', 'index.js');
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(
        entryFile,
        'module.exports = { handler: () => new Response("ok") };',
      );

      const api = {
        getServerContext() {
          return {
            appDirectory: appDir,
            apiDirectory: undefined,
          };
        },
        getServerConfig() {
          return {};
        },
      } as unknown;

      const adapter = new EffectAdapter(api as ServerPluginAPI);
      const adapterState = adapter as unknown as {
        resolveEntryFile: () => string | undefined;
      };

      expect(adapterState.resolveEntryFile()).toBe(entryFile);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test.each([
    '.ts',
    '.js',
    '.mts',
    '.cts',
  ])('effect adapter resolves configured Effect entry with %s extension', async extension => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-configured-entry-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const entryFile = path.join(apiDir, `custom${extension}`);
      await fs.promises.mkdir(path.dirname(entryFile), { recursive: true });
      await fs.promises.writeFile(entryFile, '');

      const api = {
        getServerContext() {
          return {
            appDirectory: appDir,
            apiDirectory: apiDir,
          };
        },
        getServerConfig() {
          return {
            bff: {
              effect: {
                entry: `api/custom${extension}`,
              },
            },
          };
        },
      } as unknown;

      const adapter = new EffectAdapter(api as ServerPluginAPI);
      const adapterState = adapter as unknown as {
        resolveEntryFile: () => string | undefined;
      };

      expect(adapterState.resolveEntryFile()).toBe(entryFile);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test.each([
    'api/custom.ts',
    'api/custom',
  ])('production Effect entry %s resolves only from the built artifact root', async configuredEntry => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-effect-built-entry-'),
    );
    const previousNodeEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';
      const apiDir = path.join(appDir, 'api');
      const distDirectory = path.join(appDir, 'dist');
      const sourceEntry = path.join(apiDir, 'custom.ts');
      const builtEntry = path.join(distDirectory, 'api', 'custom.js');
      await fs.promises.mkdir(path.dirname(sourceEntry), { recursive: true });
      await fs.promises.mkdir(path.dirname(builtEntry), { recursive: true });
      await fs.promises.writeFile(sourceEntry, 'source');
      await fs.promises.writeFile(builtEntry, 'built');

      const api = {
        getServerContext() {
          return {
            appDirectory: appDir,
            apiDirectory: apiDir,
            distDirectory,
          };
        },
        getServerConfig() {
          return {
            bff: {
              effect: {
                entry: configuredEntry,
              },
            },
          };
        },
      } as unknown;
      const adapter = new EffectAdapter(api as ServerPluginAPI);
      const adapterState = adapter as unknown as {
        resolveEntryFile: () => string | undefined;
      };

      expect(adapterState.resolveEntryFile()).toBe(builtEntry);
      await fs.promises.rm(builtEntry);
      expect(adapterState.resolveEntryFile()).toBeUndefined();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('client generator skips lambda scan when existLambda is false', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-regression-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'regression-app', version: '1.0.0' }, null, 2),
      );

      const options: APILoaderOptions = {
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        apiFiles: [],
        bffRuntimeFramework: 'effect',
      };

      await expect(clientGenerator(options)).resolves.toBeUndefined();
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('client generator marks generated client output as ESM', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-client-module-'),
    );
    const previousCwd = process.cwd();

    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'module-app', version: '1.0.0' }, null, 2),
      );
      await fs.promises.writeFile(
        path.join(apiDir, 'index.js'),
        `const {
          HttpApi,
          HttpApiEndpoint,
          HttpApiGroup,
          Layer,
          Schema,
        } = require('@modern-js/plugin-bff/effect-client');

const api = HttpApi.make('ModuleApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({
        ok: Schema.Boolean,
      }),
    }),
  ),
);

        module.exports = { api, layer: Layer.empty };
        `,
      );

      process.chdir(appDir);
      await clientGenerator({
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        apiFiles: [],
        bffRuntimeFramework: 'effect',
      });

      const clientPackageJson = JSON.parse(
        await fs.promises.readFile(
          path.join(appDir, '.modern-js', 'client', 'package.json'),
          'utf8',
        ),
      );
      expect(clientPackageJson).toEqual({
        private: true,
        name: 'module-app-bff-client',
        type: 'module',
      });
      await expect(
        fs.promises.stat(path.join(appDir, '.modern-js', 'client', 'index.js')),
      ).resolves.toBeDefined();
    } finally {
      process.chdir(previousCwd);
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('runtime generator exposes initProducerClient alias', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-runtime-'),
    );

    try {
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ name: 'runtime-app', version: '1.0.0' }, null, 2),
      );
      await runtimeGenerator({
        runtime: '@modern-js/plugin-bff/client',
        appDirectory: appDir,
        relativeDistPath: '.modern-js',
      });

      const generatedRuntimeDirectory = path.join(
        appDir,
        '.modern-js',
        'runtime',
      );
      const requestRuntimeDirectory = path.join(
        appDir,
        '.modern-js',
        'node_modules',
        '@modern-js',
        'plugin-bff',
      );
      await fs.promises.mkdir(requestRuntimeDirectory, { recursive: true });
      await fs.promises.writeFile(
        path.join(requestRuntimeDirectory, 'package.json'),
        JSON.stringify({
          exports: { './client': './client.js' },
          name: '@modern-js/plugin-bff',
        }),
      );
      await fs.promises.writeFile(
        path.join(requestRuntimeDirectory, 'client.js'),
        'exports.configure = options => options;',
      );
      const generatedRequire = createRequire(
        path.join(generatedRuntimeDirectory, 'index.js'),
      );
      const generatedRuntime = generatedRequire('./index.js') as {
        configure: (options?: Record<string, unknown>) => unknown;
        initProducerClient: (options?: Record<string, unknown>) => unknown;
      };
      const expectedDefaults = {
        requestId: 'runtime-app',
        requireEnvelope: true,
        identityBinding: { enabled: true, strict: true },
        operationContract: {
          enabled: true,
          strict: true,
          requireSchemaHash: true,
          requireOperationVersion: true,
        },
      };

      expect(generatedRuntime.initProducerClient()).toEqual(expectedDefaults);
      expect(generatedRuntime.configure()).toEqual(expectedDefaults);
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });

  test('client generator fails fast on package export collisions', async () => {
    const appDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'modern-plugin-bff-collision-'),
    );

    try {
      const apiDir = path.join(appDir, 'api');
      const lambdaDir = path.join(apiDir, 'lambda');
      await fs.promises.mkdir(apiDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify(
          {
            name: 'collision-app',
            version: '1.0.0',
            exports: {
              './api/*': {
                import: './custom/api/*.js',
                types: './custom/api/*.d.ts',
              },
            },
          },
          null,
          2,
        ),
      );

      const options: APILoaderOptions = {
        prefix: '/api',
        appDir,
        apiDir,
        lambdaDir,
        existLambda: false,
        port: 8080,
        relativeDistPath: '.modern-js',
        relativeApiPath: './api',
        apiFiles: [],
      };

      await expect(clientGenerator(options)).rejects.toThrow(
        /package\.json exports conflict/,
      );
    } finally {
      await fs.promises.rm(appDir, { recursive: true, force: true });
    }
  });
});
