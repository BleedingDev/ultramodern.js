import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type EnvironmentConfig,
  type ModifyBundlerChainFn,
  rspack,
} from '@rsbuild/core';
import {
  applyCloudflareBuilderEnvironments,
  createCloudflareBuilderPlugin,
  getCloudflareBuilderEnvironments,
  getCloudflareWorkerRspackConfig,
  type ModifyCloudflareBuilderEnvironments,
} from '../src/cloudflare-builder';

const createWorkerEnvironments = (
  bundlerChain?: ModifyBundlerChainFn,
  entry = './src/bootstrap.jsx',
): Record<string, EnvironmentConfig> => ({
  client: { output: { target: 'web' } },
  workerSSR: {
    output: { target: 'web-worker' },
    source: { entry: { main: [entry] } },
    ...(bundlerChain ? { tools: { bundlerChain } } : {}),
  },
});

const writeTestPackage = (
  appDirectory: string,
  packageName: string,
  files: string[],
) => {
  const packageDirectory = path.join(appDirectory, 'node_modules', packageName);
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ main: 'index.js', name: packageName }),
  );

  for (const file of new Set(['index.js', ...files])) {
    const filePath = path.join(packageDirectory, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
  }

  return packageDirectory;
};

describe('Cloudflare builder environments', () => {
  it('preserves the environment map identity for ordinary workers', () => {
    const environments = createWorkerEnvironments();

    expect(
      getCloudflareBuilderEnvironments({
        appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
        environments,
        normalizedConfig: { deploy: { target: 'node' } },
        resolveDeployProvider: () => 'cloudflare',
      }),
    ).toBe(environments);
  });

  it('prefers MODERNJS_DEPLOY over provider detection', () => {
    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    const environments = createWorkerEnvironments();
    process.env.MODERNJS_DEPLOY = 'node';

    try {
      expect(
        getCloudflareBuilderEnvironments({
          appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
          environments,
          normalizedConfig: {},
          resolveDeployProvider: () => 'cloudflare',
        }),
      ).toBe(environments);
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it('prefers the configured deploy target over MODERNJS_DEPLOY', () => {
    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    process.env.MODERNJS_DEPLOY = 'node';

    try {
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
        environments: createWorkerEnvironments(),
        normalizedConfig: { deploy: { target: 'cloudflare' } },
      });

      expect(result.workerSSR?.output).toEqual({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
      });
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it.each([
    'cloudflare',
    'cloudflare_pages',
    'cloudflare_workers',
  ])('enables Cloudflare worker output from the %s provider alone', detectedProvider => {
    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    delete process.env.MODERNJS_DEPLOY;

    try {
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
        environments: createWorkerEnvironments(),
        normalizedConfig: {},
        resolveDeployProvider: () => detectedProvider,
      });

      expect(result.workerSSR?.output).toEqual({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
      });
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it('lets Rspack derive the ESM worker contract from output.module', async () => {
    const environments = getCloudflareBuilderEnvironments({
      appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
      environments: createWorkerEnvironments(),
      normalizedConfig: { deploy: { target: 'cloudflare' } },
    });
    const compiler = rspack({
      entry: {},
      output: { module: environments.workerSSR?.output?.module },
      target: environments.workerSSR?.output?.target,
    });

    try {
      expect(compiler.options.output.module).toBe(true);
      expect(compiler.options.output.filename).toBe('[name].mjs');
      expect(compiler.options.output.chunkFormat).toBe('module');
      expect(compiler.options.output.chunkLoading).toBe('import');
      expect(compiler.options.externalsType).toBe('module-import');
      expect(compiler.options.experiments).not.toHaveProperty('outputModule');
    } finally {
      await new Promise<void>((resolve, reject) => {
        compiler.close(error => (error ? reject(error) : resolve()));
      });
    }
  });

  it('preserves generic worker output for a non-Cloudflare provider', () => {
    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    const environments = createWorkerEnvironments();
    delete process.env.MODERNJS_DEPLOY;

    try {
      expect(
        getCloudflareBuilderEnvironments({
          appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
          environments,
          normalizedConfig: {},
          resolveDeployProvider: () => 'netlify',
        }),
      ).toBe(environments);
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it('rewrites Cloudflare worker entries and adds an Effect BFF entry', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-builder-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');
    const existingBundlerChain: ModifyBundlerChainFn = () => {};

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');
      const environments = createWorkerEnvironments(existingBundlerChain);
      const result = getCloudflareBuilderEnvironments({
        appContext: { apiDirectory, appDirectory },
        environments,
        normalizedConfig: {
          bff: { runtimeFramework: 'effect' },
          deploy: { target: 'cloudflare' },
        },
      });

      expect(result).not.toBe(environments);
      expect(result.workerSSR?.output).toEqual({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
      expect(result.workerSSR?.tools?.htmlPlugin).toBe(false);
      const bundlerChain = result.workerSSR?.tools?.bundlerChain;
      expect(Array.isArray(bundlerChain)).toBe(true);
      if (!Array.isArray(bundlerChain)) {
        throw new Error(
          'Expected the Cloudflare bundler chain to be composed.',
        );
      }
      expect(typeof bundlerChain[0]).toBe('function');
      expect(bundlerChain[1]).toBe(existingBundlerChain);
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('rewrites the generic builder bootstrap.server worker entry', () => {
    const result = getCloudflareBuilderEnvironments({
      appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
      environments: createWorkerEnvironments(
        undefined,
        './src/bootstrap.server.jsx',
      ),
      normalizedConfig: { deploy: { target: 'cloudflare' } },
    });

    expect(result.workerSSR?.source?.entry).toEqual({
      main: ['./src/index.server.jsx'],
    });
  });

  it('applies the complete worker bundler contract before user handlers', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-bundler-contract-'),
    );
    const packageDirectories = {
      loadable: writeTestPackage(appDirectory, '@loadable/component', [
        'dist/esm/loadable.esm.mjs',
      ]),
      react: writeTestPackage(appDirectory, 'react', [
        'jsx-dev-runtime.js',
        'jsx-runtime.js',
      ]),
      reactDom: writeTestPackage(appDirectory, 'react-dom', ['server.edge.js']),
      render: writeTestPackage(appDirectory, '@modern-js/render', [
        'dist/esm/rscWorker.mjs',
      ]),
      router: writeTestPackage(appDirectory, '@tanstack/router-core', [
        'dist/esm/ssr/ssr-server.js',
      ]),
      runtime: writeTestPackage(appDirectory, '@modern-js/runtime', [
        'dist/esm/rsc/server.worker.mjs',
      ]),
    };
    const executionOrder: string[] = [];
    const existingBundlerChain: ModifyBundlerChainFn = () => {
      executionOrder.push('user');
    };

    try {
      const result = getCloudflareBuilderEnvironments({
        appContext: {
          apiDirectory: path.join(appDirectory, 'api'),
          appDirectory,
        },
        environments: createWorkerEnvironments(existingBundlerChain),
        normalizedConfig: { deploy: { target: 'cloudflare' } },
      });
      const bundlerChain = result.workerSSR?.tools?.bundlerChain;
      expect(Array.isArray(bundlerChain)).toBe(true);
      if (!Array.isArray(bundlerChain)) {
        throw new Error('Expected composed Cloudflare bundler handlers.');
      }

      const aliases = new Map<string, string>();
      const conditionNames = new Set<string>();
      const deletedPlugins = new Set<string>();
      const fallbacks = new Map<string, false>();
      const externals = rstest.fn((_: Record<string, string>) => {
        executionOrder.push('cloudflare');
      });
      const externalsType = rstest.fn();
      const parserMerge = rstest.fn();
      const runtimeChunk = rstest.fn();
      const splitChunks = rstest.fn();
      const output = {
        chunkFormat: rstest.fn().mockReturnThis(),
        chunkLoading: rstest.fn().mockReturnThis(),
        library: rstest.fn().mockReturnThis(),
        module: rstest.fn().mockReturnThis(),
        publicPath: rstest.fn().mockReturnThis(),
        workerChunkLoading: rstest.fn().mockReturnThis(),
      };
      const chain = {
        externals,
        externalsType,
        module: { parser: { merge: parserMerge } },
        optimization: { runtimeChunk, splitChunks },
        output,
        plugins: {
          delete: (name: string) => deletedPlugins.add(name),
        },
        resolve: {
          alias: {
            set: (name: string, value: string) => aliases.set(name, value),
          },
          conditionNames: {
            add: (name: string) => conditionNames.add(name),
          },
          fallback: {
            set: (name: string, value: false) => fallbacks.set(name, value),
          },
        },
      };

      for (const handler of bundlerChain) {
        Reflect.apply(handler, undefined, [chain, {}]);
      }

      expect(executionOrder).toEqual(['cloudflare', 'user']);
      expect(externals).toHaveBeenCalledWith(
        expect.objectContaining({
          'fs/promises': 'module-import node:fs/promises',
          'node:fs/promises': 'module-import node:fs/promises',
          'node:path': 'module-import node:path',
          path: 'module-import node:path',
        }),
      );
      expect(externalsType).toHaveBeenCalledWith('module-import');
      expect(parserMerge).toHaveBeenCalledWith({
        javascript: { dynamicImportMode: 'eager' },
      });
      expect(runtimeChunk).toHaveBeenCalledWith({
        name: '__modern_worker_runtime',
      });
      expect(splitChunks).toHaveBeenCalledWith({
        chunks: 'all',
        minSize: 0,
        name: '__modern_worker_shared',
      });
      expect(output.module).toHaveBeenCalledWith(true);
      expect(output.library).toHaveBeenCalledWith({ type: 'module' });
      expect(output.publicPath).toHaveBeenCalledWith('/');
      expect(output.chunkFormat).toHaveBeenCalledWith('module');
      expect(output.chunkLoading).toHaveBeenCalledWith('import');
      expect(output.workerChunkLoading).toHaveBeenCalledWith('import');
      expect(conditionNames).toEqual(
        new Set([
          'workerd',
          'worker',
          'webpack',
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
          'import',
          'require',
          'module',
        ]),
      );
      expect(deletedPlugins).toContain('plugin-module-federation');
      expect(aliases.get('@tanstack/router-core/ssr/server$')).toBe(
        fs.realpathSync(
          path.join(packageDirectories.router, 'dist/esm/ssr/ssr-server.js'),
        ),
      );
      expect(aliases.get('@tanstack/router-core/ssr/server')).toBe(
        aliases.get('@tanstack/router-core/ssr/server$'),
      );
      expect(aliases.get('@modern-js/runtime/rsc/server$')).toBe(
        fs.realpathSync(
          path.join(
            packageDirectories.runtime,
            'dist/esm/rsc/server.worker.mjs',
          ),
        ),
      );
      expect(aliases.get('@modern-js/runtime/rsc/server')).toBe(
        aliases.get('@modern-js/runtime/rsc/server$'),
      );
      expect(aliases.get('@modern-js/render/rsc$')).toBe(
        fs.realpathSync(
          path.join(packageDirectories.render, 'dist/esm/rscWorker.mjs'),
        ),
      );
      expect(aliases.get('@modern-js/render/rsc')).toBe(
        aliases.get('@modern-js/render/rsc$'),
      );
      expect(aliases.get('@modern-js/render/rsc-worker$')).toBe(
        aliases.get('@modern-js/render/rsc$'),
      );
      expect(aliases.get('react$')).toBe(
        fs.realpathSync(path.join(packageDirectories.react, 'index.js')),
      );
      expect(aliases.get('react/jsx-runtime$')).toBe(
        fs.realpathSync(path.join(packageDirectories.react, 'jsx-runtime.js')),
      );
      expect(aliases.get('react/jsx-dev-runtime$')).toBe(
        fs.realpathSync(
          path.join(packageDirectories.react, 'jsx-dev-runtime.js'),
        ),
      );
      expect(aliases.get('react-dom$')).toBe(
        fs.realpathSync(path.join(packageDirectories.reactDom, 'index.js')),
      );
      expect(aliases.get('react-dom/server.edge$')).toBe(
        fs.realpathSync(
          path.join(packageDirectories.reactDom, 'server.edge.js'),
        ),
      );
      expect(aliases.get('@loadable/component$')).toBe(
        fs.realpathSync(
          path.join(packageDirectories.loadable, 'dist/esm/loadable.esm.mjs'),
        ),
      );

      const mfRuntimePlugin = aliases.get(
        '@module-federation/modern-js-v3/ssr-inject-data-fetch-function-plugin$',
      );
      expect(mfRuntimePlugin).toMatch(
        /cloudflare-worker-mf-ssr-runtime-plugin\.mjs$/,
      );
      expect(fs.existsSync(mfRuntimePlugin ?? '')).toBe(true);
      expect(
        aliases.get('@module-federation/modern-js-v3/ssr-dev-plugin$'),
      ).toBe(mfRuntimePlugin);
      expect(aliases.get('@loadable/server$')).toMatch(
        /cloudflare-worker-loadable-server\.mjs$/,
      );
      expect(aliases.get('fs/promises$')).toMatch(
        /cloudflare-worker-fs-promises\.mjs$/,
      );
      expect(aliases.get('node:fs/promises$')).toBe(
        aliases.get('fs/promises$'),
      );
      expect(aliases.get('path$')).toMatch(/cloudflare-worker-path\.mjs$/);
      expect(aliases.get('node:path$')).toBe(aliases.get('path$'));
      for (const templateAlias of [
        aliases.get('@loadable/server$'),
        aliases.get('fs/promises$'),
        aliases.get('path$'),
      ]) {
        expect(fs.existsSync(templateAlias ?? '')).toBe(true);
      }
      expect(aliases.get('react-server-dom-rspack/server.node$')).toBe(
        'react-server-dom-rspack/server.edge',
      );
      expect(aliases.get('react-server-dom-rspack/server.node')).toBe(
        aliases.get('react-server-dom-rspack/server.node$'),
      );
      expect(aliases.get('react-server-dom-rspack/client.node$')).toBe(
        'react-server-dom-rspack/client.edge',
      );
      expect(aliases.get('react-server-dom-rspack/client.node')).toBe(
        aliases.get('react-server-dom-rspack/client.node$'),
      );
      expect(fallbacks).toEqual(
        new Map([
          ['fs', false],
          ['node:fs', false],
        ]),
      );
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('returns a transform payload from the apply helper', () => {
    const environments = createWorkerEnvironments();
    const result = applyCloudflareBuilderEnvironments({
      appContext: { apiDirectory: '/app/api', appDirectory: '/app' },
      environments,
      normalizedConfig: { deploy: { target: 'node' } },
    });

    expect(result.environments).toBe(environments);
  });

  it('registers a structural app-tools transform plugin', async () => {
    const environments = createWorkerEnvironments();
    let transform: ModifyCloudflareBuilderEnvironments | undefined;
    const plugin = createCloudflareBuilderPlugin();

    plugin.setup({
      getAppContext: () => ({
        apiDirectory: '/app/api',
        appDirectory: '/app',
      }),
      getNormalizedConfig: () => ({ deploy: { target: 'node' } }),
      modifyBuilderEnvironments: handler => {
        transform = handler;
      },
    });

    expect(plugin.name).toBe('@modern-js/cloudflare-builder');
    if (!transform) {
      throw new Error('Expected the plugin to register its environment hook.');
    }
    const result = await transform({ environments });
    expect(result?.environments).toBe(environments);
  });

  it('reserves eager runtime and shared chunks around worker entry names', () => {
    const config = getCloudflareWorkerRspackConfig([
      '__modern_worker_runtime',
      '__modern_worker_shared',
    ]);

    expect(config.module.parser.javascript.dynamicImportMode).toBe('eager');
    expect(config.optimization.runtimeChunk.name).toBe(
      '__modern_worker_runtime_',
    );
    expect(config.optimization.splitChunks.name).toBe(
      '__modern_worker_shared_',
    );
    expect(config.externals['node:path']).toBe('module-import node:path');
  });
});
