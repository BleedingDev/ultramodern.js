import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { expect, it } from '@rstest/core';
import { rscDisabledRuntimePlugin } from '../src/shared/rsc/rscDisabledRuntime';

const require = createRequire(import.meta.url);
const runtimeSubpaths = [
  'client.browser',
  'client.edge',
  'client.node',
  'server.edge',
  'server.node',
] as const;
const runtimeExports = {
  'client.browser': [
    'createFromFetch',
    'createFromReadableStream',
    'createServerReference',
    'createTemporaryReferenceSet',
    'encodeReply',
    'registerServerReference',
    'setFindSourceMapURLCallback',
    'setServerCallback',
  ],
  'client.edge': [
    'createFromFetch',
    'createFromReadableStream',
    'createServerReference',
    'createTemporaryReferenceSet',
    'encodeReply',
    'registerServerReference',
  ],
  'client.node': [
    'createFromFetch',
    'createFromNodeStream',
    'createFromReadableStream',
    'createServerReference',
    'createTemporaryReferenceSet',
    'encodeReply',
    'registerServerReference',
  ],
  'server.edge': [
    'createServerEntry',
    'createTemporaryReferenceSet',
    'decodeAction',
    'decodeFormState',
    'decodeReply',
    'decodeReplyFromAsyncIterable',
    'decryptServerActionBoundArgs',
    'encryptServerActionBoundArgs',
    'ensureServerActions',
    'loadServerAction',
    'registerClientReference',
    'registerServerReference',
    'renderToReadableStream',
    'setServerActionBoundArgsEncryption',
  ],
  'server.node': [
    'createServerEntry',
    'createTemporaryReferenceSet',
    'decodeAction',
    'decodeFormState',
    'decodeReply',
    'decodeReplyFromAsyncIterable',
    'decodeReplyFromBusboy',
    'decryptServerActionBoundArgs',
    'encryptServerActionBoundArgs',
    'ensureServerActions',
    'loadServerAction',
    'registerClientReference',
    'registerServerReference',
    'renderToPipeableStream',
    'renderToReadableStream',
    'setServerActionBoundArgsEncryption',
  ],
} as const;
const allRuntimeExports = [...new Set(Object.values(runtimeExports).flat())];

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
    aliasShape: 'plugin-object',
    optionalRuntime: 'hidden behind a late broad object alias',
    installPoisonRuntime: true,
  },
  {
    aliasShape: 'plugin-array',
    optionalRuntime: 'hidden behind a late broad array alias',
    installPoisonRuntime: true,
  },
  {
    aliasShape: 'tools-object',
    optionalRuntime: 'restored by a tools.rspack object alias',
    installPoisonRuntime: true,
  },
  {
    aliasShape: 'tools-array',
    optionalRuntime: 'restored by a tools.rspack array alias',
    installPoisonRuntime: true,
  },
])('links every disabled RSC runtime contract when the optional runtime is $optionalRuntime', async ({
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
          exports: Object.fromEntries(
            runtimeSubpaths.map(subpath => [`./${subpath}`, `./${subpath}.js`]),
          ),
        }),
        'utf-8',
      );
      for (const subpath of runtimeSubpaths) {
        fs.writeFileSync(
          path.join(packageRoot, `${subpath}.js`),
          `
            const poison = () => {
              throw new Error(
                'Resolved the optional RSC runtime while RSC was disabled.',
              );
            };
            for (const name of ${JSON.stringify(allRuntimeExports)}) {
              exports[name] = poison;
            }
          `,
          'utf-8',
        );
      }
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
        import * as clientBrowser from 'react-server-dom-rspack/client.browser';
        import * as clientEdge from 'react-server-dom-rspack/client.edge';
        import * as clientNode from 'react-server-dom-rspack/client.node';
        import * as serverEdge from 'react-server-dom-rspack/server.edge';
        import * as serverNode from 'react-server-dom-rspack/server.node';

        const contracts = [
          [clientBrowser, ${JSON.stringify(runtimeExports['client.browser'])}],
          [clientEdge, ${JSON.stringify(runtimeExports['client.edge'])}],
          [clientNode, ${JSON.stringify(runtimeExports['client.node'])}],
          [serverEdge, ${JSON.stringify(runtimeExports['server.edge'])}],
          [serverNode, ${JSON.stringify(runtimeExports['server.node'])}],
        ];

        export function invokeDisabledRscRuntime() {
          if (neighborMarker !== 'preserved') {
            throw new Error('An unrelated resolver alias was not preserved.');
          }
          for (const [runtime, exportNames] of contracts) {
            const actualExportNames = Object.keys(runtime).sort();
            const expectedExportNames = [...exportNames].sort();
            if (
              JSON.stringify(actualExportNames) !==
              JSON.stringify(expectedExportNames)
            ) {
              throw new Error(
                'Disabled RSC export surface mismatch: ' +
                  JSON.stringify({ actualExportNames, expectedExportNames }),
              );
            }
            for (const exportName of exportNames) {
              const invoke = runtime[exportName];
              if (typeof invoke !== 'function') {
                throw new Error('Missing disabled RSC export: ' + exportName);
              }
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
              throw new Error('A disabled RSC export did not fail closed.');
            }
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
          ReturnType<typeof rscDisabledRuntimePlugin>['setup']
        >[0],
      ) {
        api.modifyRspackConfig(config => {
          config.resolve ??= {};
          if (aliasShape === 'plugin-object') {
            config.resolve.alias = {
              '@fixture/rsc-neighbor$': neighborPath,
              'react-server-dom-rspack': poisonPackageRoot,
            };
          } else if (aliasShape === 'plugin-array') {
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
        plugins: [poisonAliasPlugin, rscDisabledRuntimePlugin()],
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
          rspack(config) {
            if (aliasShape === 'tools-object') {
              config.resolve ??= {};
              config.resolve.alias = {
                '@fixture/rsc-neighbor$': neighborPath,
                'react-server-dom-rspack': poisonPackageRoot,
              };
            } else if (aliasShape === 'tools-array') {
              config.resolve ??= {};
              config.resolve.alias = [
                {
                  alias: poisonPackageRoot,
                  name: 'react-server-dom-rspack',
                },
                {
                  alias: neighborPath,
                  name: '@fixture/rsc-neighbor',
                  onlyModule: true,
                },
              ];
            }
            return config;
          },
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
