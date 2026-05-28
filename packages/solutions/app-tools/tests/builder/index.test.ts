import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { createBuilderProviderConfig } from '../../src/builder/generator/createBuilderProviderConfig';
import { getBuilderEnvironments } from '../../src/builder/generator/getBuilderEnvironments';

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
  });

  it('adds the Effect BFF entry to Cloudflare workerSSR builds', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-bff-entry-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    fs.mkdirSync(path.join(apiDirectory, 'effect'), { recursive: true });
    fs.writeFileSync(path.join(apiDirectory, 'effect/index.ts'), '');

    try {
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
          `${path.join(apiDirectory, 'effect/index.ts')}?modern-bff-runtime`,
        ],
      });
      expect(result.environments.workerSSR?.tools?.htmlPlugin).toBe(false);
      expect(typeof result.environments.workerSSR?.tools?.bundlerChain).toBe(
        'function',
      );

      const aliases = new Map<string, string>();
      const fallbacks = new Map<string, false>();
      const deletedPlugins = new Set<string>();
      const chain = {
        merge: rstest.fn(),
        externalsPresets: rstest.fn(),
        plugins: {
          delete: (name: string) => {
            deletedPlugins.add(name);
          },
        },
        resolve: {
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
      });
      expect(chain.externalsPresets).not.toHaveBeenCalled();
      expect(chain.target).toHaveBeenCalledWith('webworker');
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
      expect(fallbacks.get('async_hooks')).toBe(false);
      expect(fallbacks.get('node:async_hooks')).toBe(false);
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
