import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rsbuild/core';

const routerEntryPath = path.resolve(
  __dirname,
  './fixtures/rsc-build-entry.ts',
);
const rscRouterPath = path.resolve(
  __dirname,
  '../../src/router/runtime/rsc-router.tsx',
);

const compileRouterPlugin = async (enableRsc: boolean) => {
  const outputPath = await mkdtemp(
    path.join(tmpdir(), 'modern-router-rsc-boundary-'),
  );

  try {
    const compiler = rspack({
      context: path.dirname(routerEntryPath),
      entry: routerEntryPath,
      externals: [
        ({ request }, callback) => {
          if (
            request !== undefined &&
            !request.startsWith('.') &&
            !path.isAbsolute(request)
          ) {
            callback(null, `commonjs ${request}`);
            return;
          }
          callback();
        },
      ],
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
        concatenateModules: false,
        minimize: false,
        usedExports: true,
      },
      output: {
        filename: 'router.js',
        library: {
          type: 'commonjs2',
        },
        path: outputPath,
      },
      plugins: [
        new rspack.DefinePlugin({
          __MODERN_ENABLE_RSC__: JSON.stringify(enableRsc),
        }),
      ],
      resolve: {
        extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
      },
      target: 'web',
    });

    const stats = await new Promise<ReturnType<typeof compiler.getStats>>(
      (resolve, reject) => {
        compiler.run((runError, compilationStats) => {
          compiler.close(closeError => {
            const error = runError ?? closeError;
            if (error !== null && error !== undefined) {
              reject(error);
              return;
            }
            if (
              compilationStats === undefined ||
              compilationStats.hasErrors()
            ) {
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
            resolve(compilationStats);
          });
        });
      },
    );
    const rscRouterModule = [...stats.compilation.modules].find(
      module =>
        module instanceof rspack.NormalModule &&
        module.resource === rscRouterPath,
    );

    return (
      rscRouterModule !== undefined &&
      [...stats.compilation.chunkGraph.getModuleChunksIterable(rscRouterModule)]
        .length > 0
    );
  } finally {
    await rm(outputPath, { force: true, recursive: true });
  }
};

describe('React Router RSC build boundary', () => {
  it.each([
    { enableRsc: false, expectedInBundle: false, mode: 'non-RSC' },
    { enableRsc: true, expectedInBundle: true, mode: 'RSC' },
  ])('keeps the RSC router module out of the $mode browser bundle when appropriate', async ({
    enableRsc,
    expectedInBundle,
  }) => {
    await expect(compileRouterPlugin(enableRsc)).resolves.toBe(
      expectedInBundle,
    );
  });
});
