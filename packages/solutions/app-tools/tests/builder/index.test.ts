import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { createBuilderProviderConfig } from '../../src/builder/generator/createBuilderProviderConfig';
import { getBuilderEnvironments } from '../../src/builder/generator/getBuilderEnvironments';

const linkTestPackage = (
  appDirectory: string,
  packageName: string,
  packageDirectory: string,
) => {
  const linkPath = path.join(appDirectory, 'node_modules', packageName);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(fs.realpathSync(packageDirectory), linkPath, 'junction');
};

describe('create builder Options', () => {
  it('test create builder environments config', () => {
    const appContext = {
      entrypoints: [
        {
          entryName: 'main',
          entry: './src/index.ts',
        },
        {
          entryName: 'main',
          entry: './src/main.ts',
        },
        {
          entryName: 'next',
          entry: './src/next.ts',
        },
        {
          entryName: 'error',
          entry: '',
        },
      ],
      checkedEntries: ['main', 'next'],
      configFile: 'modern.config.ts',
      appDirectory: 'appDirectory',
    };

    expect(
      getBuilderEnvironments({} as any, appContext as any, {} as any),
    ).toMatchSnapshot();

    expect(
      getBuilderEnvironments(
        {
          server: {
            ssr: true,
          },
        } as any,
        appContext as any,
        {} as any,
      ),
    ).toMatchSnapshot();

    expect(
      getBuilderEnvironments(
        {
          output: {
            ssg: true,
          },
          deploy: {
            worker: {
              ssr: true,
            },
          },
        } as any,
        appContext as any,
        {
          output: {
            copy: [
              {
                from: '**/*',
                to: 'upload',
              },
            ],
          },
        } as any,
      ),
    ).toMatchSnapshot();

    const cloudflareResult = getBuilderEnvironments(
      {
        output: {
          ssg: true,
        },
        deploy: {
          target: 'cloudflare',
          worker: {
            ssr: true,
          },
        },
      } as any,
      appContext as any,
      {} as any,
    );

    expect(cloudflareResult.environments.workerSSR?.output).toEqual({
      module: true,
      target: 'web',
    });
    expect(cloudflareResult.environments.workerSSR?.source?.entry).toEqual({
      main: ['./src/index.ts', './src/main.ts'],
      next: ['./src/next.ts'],
    });
    expect(cloudflareResult.environments.workerSSR?.tools?.htmlPlugin).toBe(
      false,
    );
    expect(
      typeof cloudflareResult.environments.workerSSR?.tools?.bundlerChain,
    ).toBe('function');

    const previousDeployTarget = process.env.MODERNJS_DEPLOY;
    process.env.MODERNJS_DEPLOY = 'cloudflare';
    try {
      const envCloudflareResult = getBuilderEnvironments(
        {
          output: {
            ssg: true,
          },
          deploy: {
            worker: {
              ssr: true,
            },
          },
        } as any,
        appContext as any,
        {} as any,
      );

      expect(envCloudflareResult.environments.workerSSR?.output).toEqual({
        module: true,
        target: 'web',
      });
      expect(
        typeof envCloudflareResult.environments.workerSSR?.tools?.bundlerChain,
      ).toBe('function');
    } finally {
      if (previousDeployTarget === undefined) {
        delete process.env.MODERNJS_DEPLOY;
      } else {
        process.env.MODERNJS_DEPLOY = previousDeployTarget;
      }
    }
  });

  it('adds the Effect BFF entry to Cloudflare workerSSR builds', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-bff-entry-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');

      const packagesDirectory = path.resolve(__dirname, '../../../..');
      const runtimeDirectory = path.join(
        packagesDirectory,
        'runtime/plugin-runtime',
      );
      linkTestPackage(appDirectory, '@modern-js/runtime', runtimeDirectory);
      linkTestPackage(
        appDirectory,
        '@modern-js/render',
        path.join(packagesDirectory, 'runtime/render'),
      );
      linkTestPackage(
        appDirectory,
        '@tanstack/router-core',
        path.join(
          packagesDirectory,
          'runtime/plugin-tanstack/node_modules/@tanstack/router-core',
        ),
      );
      for (const packageName of ['@loadable/server', 'react', 'react-dom']) {
        linkTestPackage(
          appDirectory,
          packageName,
          path.join(runtimeDirectory, 'node_modules', packageName),
        );
      }

      const appContext = {
        appDirectory,
        apiDirectory,
        entrypoints: [
          {
            entryName: 'main',
            entry: './src/index.jsx',
          },
        ],
      };

      const result = getBuilderEnvironments(
        {
          bff: {
            prefix: '/commerce-api',
            runtimeFramework: 'effect',
          },
          output: {
            ssg: true,
          },
          deploy: {
            target: 'cloudflare',
            worker: {
              ssr: true,
            },
          },
        } as any,
        appContext as any,
        {} as any,
      );

      expect(result.environments.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
      expect(result.environments.workerSSR?.tools?.htmlPlugin).toBe(false);
      expect(typeof result.environments.workerSSR?.tools?.bundlerChain).toBe(
        'function',
      );

      const aliases = new Map<string, string>();
      const fallbacks = new Map<string, false>();
      const deletedPlugins = new Set<string>();
      const module = rstest.fn().mockReturnThis();
      const library = rstest.fn().mockReturnThis();
      const publicPath = rstest.fn().mockReturnThis();
      const chunkFormat = rstest.fn().mockReturnThis();
      const chunkLoading = rstest.fn().mockReturnThis();
      const workerChunkLoading = rstest.fn().mockReturnThis();
      const usedExports = rstest.fn().mockReturnThis();
      const providedExports = rstest.fn().mockReturnThis();
      const innerGraph = rstest.fn().mockReturnThis();
      const sideEffects = rstest.fn().mockReturnThis();
      const conditionNames = {
        add: rstest.fn().mockReturnThis(),
        delete: rstest.fn().mockReturnThis(),
      };
      const chain = {
        merge: rstest.fn(),
        externalsPresets: rstest.fn(),
        output: {
          module,
          library,
          publicPath,
          chunkFormat,
          chunkLoading,
          workerChunkLoading,
        },
        optimization: {
          usedExports,
          providedExports,
          innerGraph,
          sideEffects,
        },
        plugins: {
          delete: (name: string) => {
            deletedPlugins.add(name);
          },
        },
        resolve: {
          conditionNames,
          alias: {
            set: (name: string, value: string) => {
              aliases.set(name, value);
            },
          },
          fallback: {
            set: (name: string, value: false) => {
              fallbacks.set(name, value);
            },
          },
        },
        target: rstest.fn(),
      };

      result.environments.workerSSR?.tools?.bundlerChain?.(
        chain as any,
        {} as any,
      );

      expect(chain.merge).toHaveBeenCalledWith({
        experiments: {
          outputModule: true,
        },
        externals: {
          async_hooks: 'module-import node:async_hooks',
          buffer: 'module-import node:buffer',
          crypto: 'module-import node:crypto',
          events: 'module-import node:events',
          'fs/promises': 'module-import node:fs/promises',
          module: 'module-import node:module',
          'node:async_hooks': 'module-import node:async_hooks',
          'node:buffer': 'module-import node:buffer',
          'node:crypto': 'module-import node:crypto',
          'node:events': 'module-import node:events',
          'node:fs/promises': 'module-import node:fs/promises',
          'node:module': 'module-import node:module',
          'node:path': 'module-import node:path',
          'node:process': 'module-import node:process',
          'node:stream': 'module-import node:stream',
          'node:string_decoder': 'module-import node:string_decoder',
          'node:url': 'module-import node:url',
          'node:util': 'module-import node:util',
          path: 'module-import node:path',
          process: 'module-import node:process',
          stream: 'module-import node:stream',
          string_decoder: 'module-import node:string_decoder',
          url: 'module-import node:url',
          util: 'module-import node:util',
        },
        externalsType: 'module-import',
      });
      expect(chain.externalsPresets).not.toHaveBeenCalled();
      expect(chain.target).not.toHaveBeenCalled();
      expect(module).toHaveBeenCalledWith(true);
      expect(library).toHaveBeenCalledWith({ type: 'module' });
      expect(publicPath).toHaveBeenCalledWith('/');
      expect(chunkFormat).toHaveBeenCalledWith('module');
      expect(chunkLoading).toHaveBeenCalledWith('import');
      expect(workerChunkLoading).toHaveBeenCalledWith('import');
      expect(usedExports).toHaveBeenCalledWith(false);
      expect(providedExports).toHaveBeenCalledWith(true);
      expect(innerGraph).toHaveBeenCalledWith(false);
      expect(sideEffects).toHaveBeenCalledWith(false);
      expect(conditionNames.add).toHaveBeenCalledWith('workerd');
      expect(conditionNames.add).toHaveBeenCalledWith('worker');
      expect(conditionNames.add).toHaveBeenCalledWith('webpack');
      expect(conditionNames.add).toHaveBeenCalledWith('development');
      expect(conditionNames.add).toHaveBeenCalledWith('import');
      expect(conditionNames.add).toHaveBeenCalledWith('require');
      expect(conditionNames.add).toHaveBeenCalledWith('module');
      // ADR-0021: Worker SSR resolves generated `.worker.tsx` boundaries that
      // contain no native remote imports. Keeping the MF transform here would
      // initialize its Node runtime at module scope and perform forbidden I/O.
      expect(deletedPlugins.has('plugin-module-federation')).toBe(true);
      expect(aliases.get('@modern-js/runtime/rsc/server$')).toMatch(
        /runtime[/\\]plugin-runtime[/\\]dist[/\\]esm[/\\]rsc[/\\]server\.worker\.mjs$/,
      );
      expect(aliases.get('react-server-dom-rspack/server.node$')).toBe(
        'react-server-dom-rspack/server.edge',
      );
      expect(aliases.get('react-server-dom-rspack/client.node$')).toBe(
        'react-server-dom-rspack/client.edge',
      );
      expect(aliases.get('react$')).toMatch(/react[/\\]index\.js$/);
      expect(aliases.get('react/jsx-runtime$')).toMatch(
        /react[/\\]jsx-runtime\.js$/,
      );
      expect(aliases.get('react/jsx-dev-runtime$')).toMatch(
        /react[/\\]jsx-dev-runtime\.js$/,
      );
      expect(aliases.get('react-dom$')).toMatch(/react-dom[/\\]index\.js$/);
      expect(aliases.get('react-dom/server.edge$')).toMatch(
        /react-dom[/\\]server\.edge\.js$/,
      );
      expect(aliases.get('@loadable/component$')).toMatch(
        /@loadable[/\\]component[/\\]dist[/\\]esm[/\\]loadable\.esm\.mjs$/,
      );
      expect(aliases.get('@loadable/server$')).toMatch(
        /app-tools[/\\]src[/\\]plugins[/\\]deploy[/\\]platforms[/\\]templates[/\\]cloudflare-worker-loadable-server\.mjs$/,
      );
      expect(aliases.get('fs/promises$')).toMatch(
        /app-tools[/\\]src[/\\]plugins[/\\]deploy[/\\]platforms[/\\]templates[/\\]cloudflare-worker-fs-promises\.mjs$/,
      );
      expect(aliases.get('node:fs/promises$')).toBe(
        aliases.get('fs/promises$'),
      );
      expect(aliases.get('path$')).toMatch(
        /app-tools[/\\]src[/\\]plugins[/\\]deploy[/\\]platforms[/\\]templates[/\\]cloudflare-worker-path\.mjs$/,
      );
      expect(aliases.get('node:path$')).toBe(aliases.get('path$'));
      expect(fallbacks.has('async_hooks')).toBe(false);
      expect(fallbacks.has('node:async_hooks')).toBe(false);
      expect(fallbacks.get('fs')).toBe(false);
      expect(fallbacks.get('node:fs')).toBe(false);
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('aliases React runtimes from the consuming app for source-build packages', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-source-build-react-alias-'),
    );
    const reactDirectory = path.join(appDirectory, 'node_modules/react');

    fs.mkdirSync(reactDirectory, { recursive: true });
    for (const file of [
      'index.js',
      'jsx-runtime.js',
      'jsx-dev-runtime.js',
      'compiler-runtime.js',
    ]) {
      fs.writeFileSync(path.join(reactDirectory, file), '');
    }
    fs.writeFileSync(
      path.join(reactDirectory, 'package.json'),
      JSON.stringify({ name: 'react', version: '19.0.0' }),
    );

    try {
      const existingBundlerChain = rstest.fn();
      const tempBuilderConfig = {
        tools: {
          bundlerChain: existingBundlerChain,
        },
      };

      const result = getBuilderEnvironments(
        {
          experiments: {
            sourceBuild: true,
          },
        } as any,
        {
          appDirectory,
          entrypoints: [],
        } as any,
        tempBuilderConfig as any,
      );

      const bundlerChain = result.builderConfig.tools?.bundlerChain;

      expect(Array.isArray(bundlerChain)).toBe(true);

      const aliases = new Map<string, string>();
      const chain = {
        resolve: {
          alias: {
            set: (name: string, value: string) => {
              aliases.set(name, value);
            },
          },
        },
      };

      for (const handler of bundlerChain as any[]) {
        handler(chain, {} as any);
      }

      expect(existingBundlerChain).toHaveBeenCalledWith(chain, {});
      expect(aliases.get('react$')).toBe(
        fs.realpathSync(path.join(reactDirectory, 'index.js')),
      );
      expect(aliases.get('react/jsx-runtime$')).toBe(
        fs.realpathSync(path.join(reactDirectory, 'jsx-runtime.js')),
      );
      expect(aliases.get('react/jsx-dev-runtime$')).toBe(
        fs.realpathSync(path.join(reactDirectory, 'jsx-dev-runtime.js')),
      );
      expect(aliases.get('react/compiler-runtime$')).toBe(
        fs.realpathSync(path.join(reactDirectory, 'compiler-runtime.js')),
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  test.each([
    '.ts',
    '.js',
    '.mts',
    '.cts',
  ])('adds configured Effect BFF entry with %s extension to Cloudflare workerSSR builds', extension => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-bff-configured-entry-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');
    const entryFile = path.join(apiDirectory, 'effect', `custom${extension}`);

    fs.mkdirSync(path.dirname(entryFile), { recursive: true });
    fs.writeFileSync(entryFile, '');

    try {
      const result = getBuilderEnvironments(
        {
          bff: {
            runtimeFramework: 'effect',
            effect: {
              entry: `api/effect/custom${extension}`,
            },
          },
          output: {
            ssg: true,
          },
          deploy: {
            target: 'cloudflare',
            worker: {
              ssr: true,
            },
          },
        } as any,
        {
          appDirectory,
          apiDirectory,
          entrypoints: [
            {
              entryName: 'main',
              entry: './src/index.jsx',
            },
          ],
        } as any,
        {} as any,
      );

      expect(result.environments.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
        __modern_bff_effect: [`${entryFile}?modern-bff-runtime`],
      });
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});

describe('create builder provider config', () => {
  it('should add default config', () => {
    const config = {
      output: {
        assetPrefix: '/x',
        copy: [{ from: 'xxx', to: 'yyy' }],
      },
      source: {},
      performance: {},
      dev: {},
      html: {},
    };
    const appContext = {
      appDirectory: path.join(__dirname, '../fixtures'),
      configDir: './icons',
    };

    const builderConfig = createBuilderProviderConfig(
      config as any,
      appContext as any,
    );

    expect(builderConfig).toMatchSnapshot();
  });

  it('should passing dev.startUrl config', () => {
    const config = {
      source: {},
      output: {},
      dev: {
        startUrl: '/xxx',
      },
    };
    const appContext = {
      appDirectory: `/fixtrues`,
      configDir: './icons',
    };

    const builderConfig = createBuilderProviderConfig(
      config as any,
      appContext as any,
    );

    expect(builderConfig.dev?.startUrl).toEqual('/xxx');
  });

  it('should not pass dev.mockDir to Builder', () => {
    const config = {
      source: {},
      output: {},
      dev: {
        mockDir: './mocks',
      },
    };
    const appContext = {
      appDirectory: `/fixtures`,
      configDir: './icons',
    };

    const builderConfig = createBuilderProviderConfig(
      config as any,
      appContext as any,
    );

    expect(builderConfig.dev?.mockDir).toBeUndefined();
    expect(config.dev.mockDir).toBe('./mocks');
  });

  it('should not mutate source.preEntry when removing it from builder config', () => {
    const config = {
      source: {
        enableAsyncEntry: true,
        enableAsyncPreEntry: true,
        preEntry: ['./src/pre.ts'],
      },
      output: {},
      dev: {},
      html: {},
    };
    const appContext = {
      appDirectory: `/fixtrues`,
      configDir: './icons',
    };

    const builderConfig = createBuilderProviderConfig(
      config as any,
      appContext as any,
    );

    expect(builderConfig.source?.preEntry).toBeUndefined();
    expect(config.source.preEntry).toEqual(['./src/pre.ts']);
  });
});
