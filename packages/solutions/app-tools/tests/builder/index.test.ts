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
