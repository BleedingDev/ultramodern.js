import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { semver } from '@modern-js/utils';
import { build } from 'esbuild';
import defaultBffPlugin, { bffPlugin } from '../src/cli';
import {
  type BackendFederationEntryExports,
  type BackendFederationRemote,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
  loadBackendFederatedEffectApi,
} from '../src/runtime/effect';
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
    const effectRuntimePackageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../server/bff-effect/package.json'),
        'utf8',
      ),
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
      import: './dist/esm/runtime/effect-client/index.mjs',
      default: './dist/esm/runtime/effect-client/index.mjs',
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
      // @effect/opentelemetry peer stays a hard dependency of the Effect
      // runtime package that imports it.
      const dependencyRange =
        effectRuntimePackageJson.dependencies[peerName] ??
        effectRuntimePackageJson.peerDependencies?.[peerName];
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
    expect(entryOutput.imports).toContainEqual({
      external: true,
      kind: 'dynamic-import',
      path: '@modern-js/plugin-bff-extensions/effect-adapter',
    });
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
      name: remoteName,
      runtimeFramework: 'effect',
      strictEffectApproach: true,
    },
    api: { id: 'api' },
    runtime: { id: 'runtime' },
  });

  test('backend federation runtime loads caller-pinned Tractor proof-shaped strict Effect API exposes', async () => {
    const entryExports: BackendFederationEntryExports = {
      init(...args) {
        const [scope] = args as [{ hostName: string }];
        globalThis.__modernBackendHostName = scope.hostName;
      },
      get(id) {
        if (id !== './effect-api') {
          throw new Error(`unexpected expose ${id}`);
        }
        return async () => strictEffectApiModule();
      },
    };
    const { remote, runtime } = createPinnedBackendRuntime({ entryExports });

    const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

    expect(globalThis.__modernBackendHostName).toBe('proofHost');
    expect(loaded.backendFederationContract?.name).toBe(
      'verticalExploreBackend',
    );
    expect(loaded.api).toEqual({ id: 'api' });
    expect(loaded.runtime).toEqual({ id: 'runtime' });
  });

  test('backend federation runtime supports caller-pinned service-binding remotes', async () => {
    const entryExports: BackendFederationEntryExports = {
      init(...args) {
        const [scope] = args as [{ hostName: string }];
        globalThis.__modernBackendServiceBindingHostName = scope.hostName;
      },
      get(id) {
        if (id !== './effect-api') {
          throw new Error(`unexpected expose ${id}`);
        }
        return async () => strictEffectApiModule();
      },
    };
    const { remote, runtime } = createPinnedBackendRuntime({
      entryExports,
      scheme: 'service',
    });

    const loaded = await loadBackendFederatedEffectApi({ runtime, remote });

    expect(globalThis.__modernBackendServiceBindingHostName).toBe('proofHost');
    expect(loaded.api).toEqual({ id: 'api' });
  });

  test('backend federation runtime rejects network entries before custom runtime or fetch execution', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = async input => {
      fetchCalls.push(String(input));
      return new Response('untrusted network entry', { status: 200 });
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

      await expect(
        loadBackendFederatedEffectApi({ runtime, remote }),
      ).rejects.toThrow('cannot execute network backend federation entries');
      expect(fetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('backend federation runtime rejects missing strict Effect metadata', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({
      module: {
        backendFederationContract: {
          name: 'verticalExploreBackend',
          runtimeFramework: 'hono',
          strictEffectApproach: false,
        },
        api: {},
        runtime: {},
      },
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must expose strict Effect metadata');
  });

  test('backend federation runtime rejects mismatched remote metadata names', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({
      module: strictEffectApiModule('verticalDecideBackend'),
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('metadata name mismatch');
  });

  test('backend federation runtime rejects exposes missing runtime', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({
      module: {
        backendFederationContract: {
          name: 'verticalExploreBackend',
          runtimeFramework: 'effect',
          strictEffectApproach: true,
        },
        api: {},
      },
    });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must expose runtime');
  });

  test('backend federation runtime rejects exposes that load non-object modules', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({ module: null });

    await expect(
      loadBackendFederatedEffectApi({ runtime, remote }),
    ).rejects.toThrow('must load an object module');
  });

  test('backend federation runtime rejects unknown remote names', async () => {
    const runtime = createBackendFederationRuntime({
      hostName: 'proofHost',
      remotes: [],
    });
    const remote: BackendFederationRemote = {
      entry: 'static:verticalExploreBackend',
      name: 'verticalExploreBackend',
    };

    await expect(
      loadBackendFederatedEffectApi({
        remote,
        runtime,
      }),
    ).rejects.toThrow('Missing backend federation remote');
  });

  test('backend federation runtime propagates wrong expose errors', async () => {
    const { remote, runtime } = createPinnedBackendRuntime({
      module: strictEffectApiModule(),
    });

    await expect(
      loadBackendFederatedEffectApi({
        runtime,
        remote,
        expose: './wrong',
      }),
    ).rejects.toThrow('unexpected expose ./wrong');
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

      await expect(clientGenerator(options)).resolves.toBeNull();
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
