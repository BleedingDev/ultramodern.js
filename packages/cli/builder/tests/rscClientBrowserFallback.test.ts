import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { expect, it } from '@rstest/core';
import { rscClientBrowserFallbackPlugin } from '../src/shared/rsc/rscClientBrowserFallback';

const require = createRequire(import.meta.url);

it.each([
  {
    aliasShape: 'none',
    optionalRuntime: 'absent',
    installPoisonRuntime: false,
  },
  {
    aliasShape: 'none',
    optionalRuntime: 'resolvable',
    installPoisonRuntime: true,
  },
  {
    aliasShape: 'object',
    optionalRuntime: 'hidden behind a broad object alias',
    installPoisonRuntime: true,
  },
  {
    aliasShape: 'array',
    optionalRuntime: 'hidden behind a broad array alias',
    installPoisonRuntime: true,
  },
])('links the disabled RSC client contract when the optional runtime is $optionalRuntime', async ({
  aliasShape,
  installPoisonRuntime,
}) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-rsc-disabled-build-'),
  );
  const sourcePath = path.join(workspaceRoot, 'index.js');
  const neighborPath = path.join(workspaceRoot, 'neighbor.js');
  const outputPath = path.join(workspaceRoot, 'dist');

  try {
    if (installPoisonRuntime) {
      const packageRoot = path.join(
        workspaceRoot,
        'node_modules/react-server-dom-rspack',
      );
      fs.mkdirSync(packageRoot, { recursive: true });
      fs.writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({
          name: 'react-server-dom-rspack',
          exports: {
            './client.browser': './client.browser.js',
          },
        }),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(packageRoot, 'client.browser.js'),
        `
          const poison = () => {
            throw new Error(
              'Resolved the optional RSC runtime while RSC was disabled.',
            );
          };
          exports.createFromFetch = poison;
          exports.createFromReadableStream = poison;
          exports.createServerReference = poison;
          exports.createTemporaryReferenceSet = poison;
          exports.encodeReply = poison;
          exports.setServerCallback = poison;
        `,
        'utf-8',
      );
    }
    fs.writeFileSync(
      neighborPath,
      "export const neighborMarker = 'preserved';\n",
      'utf-8',
    );
    fs.writeFileSync(
      sourcePath,
      `
        import { neighborMarker } from '@fixture/rsc-neighbor';
        import {
          createFromFetch,
          createFromReadableStream,
          createServerReference,
          createTemporaryReferenceSet,
          encodeReply,
          setServerCallback,
        } from 'react-server-dom-rspack/client.browser';

        export function invokeDisabledRscRuntime() {
          if (neighborMarker !== 'preserved') {
            throw new Error('An unrelated resolver alias was not preserved.');
          }
          for (const invoke of [
            () => createFromFetch(),
            () => createFromReadableStream(),
            () => createServerReference(),
            () => createTemporaryReferenceSet(),
            () => encodeReply(),
            () => setServerCallback(),
          ]) {
            try {
              invoke();
            } catch (error) {
              if (
                error instanceof Error &&
                error.message ===
                  'React Server Components are disabled for this build.'
              ) {
                continue;
              }
              throw error;
            }
            throw new Error('A disabled RSC client export did not fail closed.');
          }
          return true;
        }
      `,
      'utf-8',
    );

    const poisonPackageRoot = path.join(
      workspaceRoot,
      'node_modules/react-server-dom-rspack',
    );
    const poisonAliasPlugin = {
      name: 'test:poison-rsc-alias',
      setup(
        api: Parameters<
          ReturnType<typeof rscClientBrowserFallbackPlugin>['setup']
        >[0],
      ) {
        api.modifyRspackConfig(config => {
          config.resolve ??= {};
          if (aliasShape === 'object') {
            config.resolve.alias = {
              '@fixture/rsc-neighbor$': neighborPath,
              'react-server-dom-rspack': poisonPackageRoot,
            };
          } else if (aliasShape === 'array') {
            config.resolve.alias = [
              {
                alias: poisonPackageRoot,
                name: 'react-server-dom-rspack',
              },
              {
                alias: path.join(workspaceRoot, 'missing-neighbor.js'),
                name: '@fixture/rsc-neighbor',
                onlyModule: true,
              },
              {
                alias: neighborPath,
                name: '@fixture/rsc-neighbor',
                onlyModule: true,
              },
            ];
          } else {
            config.resolve.alias = {
              '@fixture/rsc-neighbor$': neighborPath,
            };
          }
        });
      },
    };

    const rsbuild = await createRsbuild({
      cwd: workspaceRoot,
      rsbuildConfig: {
        plugins: [poisonAliasPlugin, rscClientBrowserFallbackPlugin()],
        source: {
          entry: { index: sourcePath },
        },
        output: {
          distPath: {
            root: outputPath,
            js: '',
          },
          filename: {
            js: '[name].js',
          },
          target: 'node',
        },
        performance: {
          chunkSplit: {
            strategy: 'all-in-one',
          },
        },
        tools: {
          htmlPlugin: false,
        },
      },
    });

    await expect(rsbuild.build()).resolves.toBeDefined();
    const bundle = require(path.join(outputPath, 'index.js')) as {
      invokeDisabledRscRuntime: () => boolean;
    };
    expect(bundle.invokeDisabledRscRuntime()).toBe(true);
  } finally {
    fs.rmSync(workspaceRoot, { force: true, recursive: true });
  }
});
