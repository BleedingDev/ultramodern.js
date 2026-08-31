import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rsbuild/core';
import LoadablePlugin from '../../../src/cli/ssr/loadable-bundler-plugin';

const hydrateEntryPath = path.resolve(
  __dirname,
  '../../../src/core/browser/hydrate.tsx',
);

const compileHydrationBundle = async (chunkLoadingGlobal: string) => {
  const outputPath = await mkdtemp(
    path.join(tmpdir(), 'modern-hydration-chunk-global-'),
  );
  const loadableMockPath = path.join(outputPath, 'loadable-component.ts');
  const bundlePath = path.join(outputPath, 'hydrate.cjs');

  try {
    await writeFile(
      loadableMockPath,
      `export const loadableReady = (callback, options) => {
  globalThis.__LOADABLE_READY_OPTIONS__ = options;
  callback();
  return Promise.resolve();
};`,
    );

    const compiler = rspack({
      context: path.dirname(hydrateEntryPath),
      entry: hydrateEntryPath,
      mode: 'production',
      module: {
        rules: [
          {
            test: /\.[cm]?[jt]sx?$/,
            type: 'javascript/auto',
            use: [
              {
                loader: 'builtin:swc-loader',
                options: {
                  jsc: {
                    parser: {
                      syntax: 'typescript',
                      tsx: true,
                    },
                    transform: {
                      react: {
                        runtime: 'automatic',
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      optimization: {
        minimize: false,
      },
      output: {
        chunkLoadingGlobal,
        filename: path.basename(bundlePath),
        library: {
          type: 'commonjs2',
        },
        path: outputPath,
      },
      plugins: [
        new LoadablePlugin({
          filename: 'loadable-stats.json',
          outputAsset: false,
        }) as never,
      ],
      resolve: {
        alias: {
          '@loadable/component': loadableMockPath,
        },
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
      },
      target: 'web',
    });

    await new Promise<void>((resolve, reject) => {
      compiler.run((runError, compilationStats) => {
        compiler.close(closeError => {
          const error = runError ?? closeError;
          if (error !== null && error !== undefined) {
            reject(error);
            return;
          }
          if (compilationStats === undefined || compilationStats.hasErrors()) {
            reject(
              new Error(
                compilationStats?.toString({
                  all: false,
                  errors: true,
                  warnings: true,
                }) ?? 'Rspack did not return compilation stats.',
              ),
            );
            return;
          }
          resolve();
        });
      });
    });

    const bundle = await readFile(bundlePath, 'utf8');
    const compiledModule = createRequire(
      path.join(__dirname, 'hydrate-bundle-loader.cjs'),
    )(bundlePath) as {
      hydrateRoot: (
        app: unknown,
        context: { routes: unknown[] },
        render: (app: unknown) => Promise<unknown>,
        hydrate: (app: unknown) => Promise<unknown>,
      ) => Promise<unknown>;
    };

    return { bundle, compiledModule };
  } finally {
    await rm(outputPath, { force: true, recursive: true });
  }
};

const createCompiler = (chunkLoadingGlobal?: string) => {
  const definitions: Array<Record<string, string>> = [];
  const definePluginApply = rstest.fn();

  class DefinePlugin {
    constructor(value: Record<string, string>) {
      definitions.push(value);
    }

    apply = definePluginApply;
  }

  return {
    compiler: {
      options: {
        output: {
          chunkLoadingGlobal,
        },
      },
      webpack: {
        DefinePlugin,
      },
    },
    definitions,
    definePluginApply,
  };
};

describe('LoadableBundlerPlugin chunk loading global', () => {
  test.each([
    {
      name: 'preserves a configured compiler output value',
      configured: '__REMOTE_INVENTORY_CHUNKS__',
      expected: '__REMOTE_INVENTORY_CHUNKS__',
    },
    {
      name: 'uses the legacy fallback when no value is configured',
      configured: undefined,
      expected: '__LOADABLE_LOADED_CHUNKS__',
    },
  ])('$name', ({ configured, expected }) => {
    const { compiler, definitions, definePluginApply } =
      createCompiler(configured);
    const plugin = new LoadablePlugin({
      filename: 'loadable-stats.json',
      outputAsset: false,
    });

    plugin.apply(compiler as never);

    expect(compiler.options.output.chunkLoadingGlobal).toBe(expected);
    expect(definitions).toEqual([
      {
        __MODERN_CHUNK_LOADING_GLOBAL__: JSON.stringify(expected),
      },
    ]);
    expect(definePluginApply).toHaveBeenCalledWith(compiler);
  });

  test('an explicit plugin option wins over configured compiler output', () => {
    const { compiler, definitions } = createCompiler(
      '__REMOTE_INVENTORY_CHUNKS__',
    );
    const plugin = new LoadablePlugin({
      filename: 'loadable-stats.json',
      outputAsset: false,
      chunkLoadingGlobal: '__EXPLICIT_CHUNKS__',
    });

    plugin.apply(compiler as never);

    expect(compiler.options.output.chunkLoadingGlobal).toBe(
      '__EXPLICIT_CHUNKS__',
    );
    expect(definitions).toEqual([
      {
        __MODERN_CHUNK_LOADING_GLOBAL__: JSON.stringify('__EXPLICIT_CHUNKS__'),
      },
    ]);
  });

  test('compiled hydration uses the configured per-app chunk loading global', async () => {
    const chunkLoadingGlobal = '__REMOTE_INVENTORY_CHUNKS__';
    const originalWindow = Reflect.get(globalThis, 'window');
    Reflect.set(globalThis, 'window', {
      _SSR_DATA: {
        mode: 'string',
        renderLevel: 2,
      },
    });

    try {
      const { bundle, compiledModule } =
        await compileHydrationBundle(chunkLoadingGlobal);
      const hydratedRoot = { kind: 'compiled-hydration' };

      await expect(
        compiledModule.hydrateRoot(
          null,
          { routes: [] },
          async () => ({ kind: 'rendered' }),
          async () => hydratedRoot,
        ),
      ).resolves.toBe(hydratedRoot);

      expect(Reflect.get(globalThis, '__LOADABLE_READY_OPTIONS__')).toEqual({
        chunkLoadingGlobal,
      });
      expect(bundle).toContain(chunkLoadingGlobal);
      expect(bundle).not.toContain('process.env.MODERN_CHUNK_LOADING_GLOBAL');
      expect(bundle).not.toContain('__MODERN_CHUNK_LOADING_GLOBAL__');
    } finally {
      Reflect.deleteProperty(globalThis, '__LOADABLE_READY_OPTIONS__');
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Reflect.set(globalThis, 'window', originalWindow);
      }
    }
  });
});
