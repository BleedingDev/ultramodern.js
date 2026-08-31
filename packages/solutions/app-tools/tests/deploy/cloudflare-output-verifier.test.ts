import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRsbuild } from '@rsbuild/core';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../app-tools-extensions',
);

import {
  applyCloudflareWorkerMfRuntimeBoundary,
  applyCloudflareWorkerRspackConfig,
  getCloudflareWorkerRspackConfig,
} from '@modern-js/app-tools-extensions/cloudflare-builder';
import { createCloudflareOutputPlan } from '@modern-js/app-tools-extensions/cloudflare-output-plan';
import {
  assertCloudflareOutput,
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} from '@modern-js/app-tools-extensions/cloudflare-output-verifier';

const tempDirectories: string[] = [];

const listJavaScriptFiles = async (
  directory: string,
  relativeDirectory = '',
): Promise<string[]> => {
  const entries = await fs.readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(entry => {
      const relativePath = path.join(relativeDirectory, entry.name);
      return entry.isDirectory()
        ? listJavaScriptFiles(directory, relativePath)
        : Promise.resolve(entry.name.endsWith('.js') ? [relativePath] : []);
    }),
  );
  return files.flat();
};

const buildRsbuildWorker = async ({
  directory,
  entryNames = {
    bff: '__modern_bff_effect',
    route: 'main',
  },
  explicitLazy = false,
  minimize,
  outputDirectory,
}: {
  directory: string;
  entryNames?: { bff: string; route: string };
  explicitLazy?: boolean;
  minimize: boolean;
  outputDirectory: string;
}) => {
  const sourceDirectory = path.join(directory, 'rspack-worker-source');
  const workerDirectory = path.join(outputDirectory, 'worker');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.rm(workerDirectory, { force: true, recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(sourceDirectory, 'entry.js'),
      [
        "import { injectDataFetchFunctionPlugin } from '@module-federation/modern-js-v3/ssr-inject-data-fetch-function-plugin';",
        "import { mfSSRDevPlugin } from '@module-federation/modern-js-v3/ssr-dev-plugin';",
        "import { loadFirst } from './barrel.js';",
        'export { loadFirst };',
        'export const mfRuntimePlugin = injectDataFetchFunctionPlugin({});',
        'export const mfDevRuntimePlugin = mfSSRDevPlugin({});',
        'export const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        explicitLazy
          ? "export const loadSecond = () => import(/* webpackMode: 'lazy' */ './second.js');"
          : "export const loadSecond = () => import('./second.js');",
      ].join('\n'),
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'barrel.js'),
      [
        "export { loadFirst } from './safe.js';",
        "export { poison } from './unused-poison.js';",
      ].join('\n'),
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'safe.js'),
      "export const loadFirst = () => import('./first.js');\n",
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'unused-poison.js'),
      [
        "throw new Error('unused worker barrel export was evaluated');",
        'export const poison = true;',
      ].join('\n'),
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'package.json'),
      `${JSON.stringify({ sideEffects: false })}\n`,
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'main.js'),
      "export const loadShared = () => import('./first.js');\n",
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'first.js'),
      [
        'globalThis.__modernWorkerSharedEvaluations = (globalThis.__modernWorkerSharedEvaluations ?? 0) + 1;',
        'export const token = {};',
        'export const evaluations = globalThis.__modernWorkerSharedEvaluations;',
        'export const value = "first";',
      ].join('\n'),
    ),
    fs.writeFile(
      path.join(sourceDirectory, 'second.js'),
      'export const value = "second";\n',
    ),
  ]);

  const rsbuild = await createRsbuild({
    cwd: sourceDirectory,
    rsbuildConfig: {
      environments: {
        workerSSR: {
          output: {
            cleanDistPath: false,
            distPath: {
              js: 'worker',
              root: outputDirectory,
            },
            filename: { js: '[name].js' },
            module: true,
            target: 'web',
          },
          source: {
            entry: {
              [entryNames.bff]: './entry.js',
              [entryNames.route]: './main.js',
            },
          },
          tools: {
            bundlerChain(chain) {
              applyCloudflareWorkerRspackConfig(chain, [
                entryNames.bff,
                entryNames.route,
              ]);
              applyCloudflareWorkerMfRuntimeBoundary(chain);
              chain.optimization.minimize(minimize);
              chain.output
                .module(true)
                .library({ type: 'module' })
                .chunkFormat('module')
                .chunkLoading('import');
            },
            htmlPlugin: false,
          },
        },
      },
      mode: 'production',
    },
  });

  const [config] = await rsbuild.initConfigs();
  const expectedWorkerConfig = getCloudflareWorkerRspackConfig([
    entryNames.bff,
    entryNames.route,
  ]);
  expect(config.module?.parser?.javascript).toMatchObject({
    dynamicImportMode: 'eager',
  });
  expect(config.optimization?.splitChunks).toMatchObject({
    chunks: 'all',
    minSize: 0,
    name: expectedWorkerConfig.optimization.splitChunks.name,
  });
  await rsbuild.build();

  return (await listJavaScriptFiles(workerDirectory)).sort();
};

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
};

const createOutputFixture = async ({
  bffWorkerSource = 'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} }); module.exports = { __modern_create_effect_bff_dispatcher };\n',
  routeWorker,
  wrangler,
  deliveryUnit,
}: {
  bffWorkerSource?: string | false;
  routeWorker?: string;
  wrangler?: Record<string, unknown>;
  deliveryUnit?: unknown;
} = {}) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-output-verifier-'),
  );
  tempDirectories.push(directory);
  const outputDirectory = path.join(directory, '.output');

  await fs.mkdir(path.join(outputDirectory, 'server'), { recursive: true });
  await fs.mkdir(path.join(outputDirectory, 'public/static'), {
    recursive: true,
  });
  if (bffWorkerSource !== false) {
    await fs.mkdir(path.join(outputDirectory, 'worker'), { recursive: true });
    await fs.writeFile(
      path.join(outputDirectory, 'worker/__modern_bff_effect.js'),
      bffWorkerSource,
    );
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      type: 'commonjs',
    });
  }
  await fs.writeFile(
    path.join(outputDirectory, 'public/static/app.js'),
    'app();',
  );
  await writeJson(path.join(outputDirectory, 'package.json'), {
    type: 'module',
  });
  const workerManifest = {
    version: 1,
    runtime: {
      type: 'cloudflare-module-worker',
      entry: 'server/index.mjs',
      fetchExport: true,
      nodeListen: false,
    },
    workerBundles: {
      directory: 'worker',
      format: 'commonjs',
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    },
    assets: {
      directory: './public',
      binding: 'ASSETS',
      runWorkerFirst: true,
    },
    routeSpec: {
      file: 'server/route.json',
      routes: routeWorker
        ? [
            {
              urlPath: '/route-worker',
              entryName: 'main',
              worker: routeWorker,
              workerExists: false,
            },
          ]
        : [],
    },
    ...(bffWorkerSource === false
      ? {}
      : {
          bff: {
            dispatcherExport: '__modern_create_effect_bff_dispatcher',
            runtimeFramework: 'effect',
            prefix: '/api',
            worker: 'worker/__modern_bff_effect.js',
          },
        }),
    ...(deliveryUnit === undefined ? {} : { deliveryUnit }),
  };
  await writeJson(
    path.join(outputDirectory, 'server/modern-worker-manifest.json'),
    workerManifest,
  );
  await fs.writeFile(
    path.join(outputDirectory, 'server/index.mjs'),
    `export const modernWorkerManifest = ${JSON.stringify(workerManifest)};\nexport default { fetch: async () => new Response("ok") };\n`,
  );
  await writeJson(path.join(outputDirectory, 'wrangler.json'), {
    main: 'server/index.mjs',
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    assets: {
      binding: 'ASSETS',
      directory: './public',
      html_handling: 'auto-trailing-slash',
      run_worker_first: true,
    },
    ...wrangler,
  });

  return {
    directory,
    outputDirectory,
  };
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('Cloudflare output verifier', () => {
  it('centralizes framework-owned Cloudflare output paths and package metadata', () => {
    const plan = createCloudflareOutputPlan('/app/.output');

    expect(plan.requiredFiles).toEqual([
      'server/index.mjs',
      'server/modern-worker-manifest.json',
      'wrangler.json',
      'package.json',
    ]);
    expect(plan.paths).toMatchObject({
      workerEntry: path.join('/app/.output', 'server/index.mjs'),
      workerManifest: path.join(
        '/app/.output',
        'server/modern-worker-manifest.json',
      ),
      wranglerConfig: path.join('/app/.output', 'wrangler.json'),
      outputPackage: path.join('/app/.output', 'package.json'),
      workerPackage: path.join('/app/.output', 'worker/package.json'),
      publicAssets: path.join('/app/.output', 'public'),
      workerBundle: path.join('/app/.output', 'worker'),
    });
    expect(plan.packages).toEqual({
      output: { type: 'module' },
      worker: { type: 'commonjs' },
    });
    expect(plan.wrangler.assets).toEqual({
      binding: 'ASSETS',
      directory: './public',
      run_worker_first: true,
    });
  });

  it('exports the Cloudflare output verifier package subpath', async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(packageRoot, 'package.json'), 'utf-8'),
    );

    expect(packageJson.exports['./cloudflare-output-verifier']).toEqual({
      types: './dist/types/cloudflare-output-verifier/index.d.ts',
      'modern:source': './src/cloudflare-output-verifier/index.ts',
      import: './dist/esm-node/cloudflare-output-verifier/index.mjs',
      require: './dist/cjs/cloudflare-output-verifier/index.js',
    });
  });

  it('accepts framework-owned Cloudflare output contract', async () => {
    const { outputDirectory } = await createOutputFixture();

    await expect(
      assertCloudflareOutput({ outputDirectory }),
    ).resolves.toBeUndefined();
    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({
      ok: true,
      issues: [],
    });
  });

  it('rejects a worker whose runtime manifest differs from its verified manifest artifact', async () => {
    const { outputDirectory } = await createOutputFixture();
    const manifestPath = path.join(
      outputDirectory,
      'server/modern-worker-manifest.json',
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.runtime.entry = 'server/drifted.mjs';
    await writeJson(manifestPath, manifest);

    const result = await verifyCloudflareOutput({ outputDirectory });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      code: 'worker-import-failed',
      message:
        'Cloudflare server entry runtime manifest must exactly match modern-worker-manifest.json.',
      path: path.join(outputDirectory, 'server/index.mjs'),
    });
  });

  it('accepts Cloudflare output without referenced worker bundles', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: false,
    });

    await expect(verifyCloudflareOutput({ outputDirectory })).resolves.toEqual({
      ok: true,
      issues: [],
    });
  });

  it('rejects Cloudflare worker manifest with malformed routeSpec routes', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: false,
    });
    const manifestPath = path.join(
      outputDirectory,
      'server/modern-worker-manifest.json',
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.routeSpec.routes = { worker: 'worker/route.js' };
    await writeJson(manifestPath, manifest);

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid-manifest',
          message: 'Cloudflare output manifest routeSpec.routes must be array.',
          path: manifestPath,
        },
      ],
    });
  });

  it('rejects Effect BFF manifests without the reserved dispatcher export', async () => {
    const { outputDirectory } = await createOutputFixture();
    const manifestPath = path.join(
      outputDirectory,
      'server/modern-worker-manifest.json',
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    delete manifest.bff.dispatcherExport;
    await writeJson(manifestPath, manifest);

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid-manifest',
          message:
            'Cloudflare Effect BFF manifest dispatcherExport must be __modern_create_effect_bff_dispatcher.',
          path: manifestPath,
        },
      ],
    });
  });

  const createDeliveryUnitStamp = (
    identity: {
      unitId: string;
      buildMarker: string;
      sourceRevision: string;
    },
    surfaceOverrides: {
      ui?: Record<string, unknown>;
      api?: Record<string, unknown>;
    } = {},
  ) => ({
    ...identity,
    surfaces: {
      ui: { ...identity, surface: 'ui', ...surfaceOverrides.ui },
      api: { ...identity, surface: 'api', ...surfaceOverrides.api },
    },
  });

  const topologyRecord = {
    unitId: 'acme/checkout',
    buildMarker: '0123456789abcdef',
    sourceRevision: 'workspace',
  };

  it('accepts a Cloudflare worker manifest whose delivery-unit stamp matches the topology record', async () => {
    const { outputDirectory } = await createOutputFixture({
      deliveryUnit: createDeliveryUnitStamp(topologyRecord),
    });

    await expect(
      verifyCloudflareOutput({
        outputDirectory,
        importWorker: false,
        deliveryUnit: topologyRecord,
      }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('fails closed when the stamped delivery-unit build marker drifts from the topology record', async () => {
    const { outputDirectory } = await createOutputFixture({
      deliveryUnit: createDeliveryUnitStamp({
        ...topologyRecord,
        buildMarker: 'deadbeefdeadbeef',
      }),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
      deliveryUnit: topologyRecord,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'delivery-unit-drift',
        message:
          'Cloudflare worker manifest deliveryUnit.buildMarker must match the topology delivery-unit record (expected 0123456789abcdef, received deadbeefdeadbeef).',
      }),
    );
  });

  it('fails closed when the topology declares a delivery unit but the manifest carries no stamp', async () => {
    const { outputDirectory } = await createOutputFixture();

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
      deliveryUnit: topologyRecord,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-delivery-unit',
        message:
          'Cloudflare worker manifest is missing the delivery-unit identity declared by the workspace topology (expected unitId acme/checkout, buildMarker 0123456789abcdef).',
      }),
    );
  });

  it('fails closed when UI and API surface markers do not derive from one delivery-unit record', async () => {
    const { outputDirectory } = await createOutputFixture({
      deliveryUnit: createDeliveryUnitStamp(topologyRecord, {
        api: { buildMarker: 'deadbeefdeadbeef' },
      }),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
      deliveryUnit: topologyRecord,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'delivery-unit-drift',
        message:
          'Cloudflare worker manifest api surface deliveryUnit.buildMarker must derive from one delivery-unit record (expected 0123456789abcdef, received deadbeefdeadbeef).',
      }),
    );
  });

  it('leaves legacy Cloudflare output without a delivery-unit declaration unchanged', async () => {
    const { outputDirectory } = await createOutputFixture();

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('reports invalid Wrangler static asset invariants', async () => {
    const { outputDirectory } = await createOutputFixture({
      wrangler: {
        main: 'custom-entry.mjs',
        compatibility_flags: ['nodejs_compat'],
        assets: {
          binding: 'CUSTOM_ASSETS',
          directory: './static-assets',
          run_worker_first: false,
        },
      },
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain(
      'invalid-wrangler',
    );
    expect(result.issues.map(issue => issue.message)).toEqual(
      expect.arrayContaining([
        'wrangler.json main must be server/index.mjs.',
        'wrangler.json assets.binding must be ASSETS.',
        'wrangler.json assets.directory must be ./public.',
        'wrangler.json assets.run_worker_first must be true.',
        'wrangler.json compatibility_flags must include global_fetch_strictly_public.',
      ]),
    );
  });

  it('reports missing Effect BFF worker bundles', async () => {
    const { outputDirectory } = await createOutputFixture();
    await fs.rm(path.join(outputDirectory, 'worker/__modern_bff_effect.js'));

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-worker-bundle',
      }),
    );
  });

  it('requires worker package metadata when worker bundles are referenced', async () => {
    const { outputDirectory } = await createOutputFixture();
    await fs.rm(path.join(outputDirectory, 'worker/package.json'));

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-file',
        message:
          'Cloudflare output is missing worker/package.json for referenced worker bundles.',
      }),
    );
  });

  it('reports missing route worker bundles', async () => {
    const { outputDirectory } = await createOutputFixture({
      routeWorker: 'worker/routes/page.js',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-worker-bundle',
        message:
          'Cloudflare route worker manifest points to a missing worker bundle.',
      }),
    );
  });

  it('rejects manifest worker bundle references outside worker output', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: false,
      routeWorker: '../outside-worker.js',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-manifest',
        message:
          'Cloudflare output manifest worker bundle references must stay under worker/.',
      }),
    );
  });

  it('rejects emitted worker bundles that resolve outside worker output', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: "import '../server/index.mjs';\n",
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not resolve outside the staged worker directory.',
      }),
    );
  });

  it('rejects Effect BFF worker bundles without their declared dispatcher export', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: 'module.exports = {};\n',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare Effect BFF worker bundle must expose its manifest dispatcherExport.',
      }),
    );
  });

  it('rejects comment-only mentions of the declared dispatcher export', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource:
        '// module.exports = { __modern_create_effect_bff_dispatcher };\nmodule.exports = {};\n',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare Effect BFF worker bundle must expose its manifest dispatcherExport.',
      }),
    );
  });

  it('rejects unresolved bare imports from manifest-declared worker bundles', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('@modern-js/plugin-bff/effect-edge');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundle import "@modern-js/plugin-bff/effect-edge" is not provided by worker/package.json dependencies.',
      }),
    );
  });

  it('allows supported Cloudflare Worker node: builtins', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('node:async_hooks');",
        "require('node:util');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('rejects unsupported node: builtins even when package metadata declares them', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('node:child_process');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies: {
        'node:child_process': '1.0.0',
      },
      type: 'commonjs',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundle import "node:child_process" is not a supported Worker node: builtin.',
      }),
    );
  });

  it('allows bare imports only when worker package metadata provides them', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('@acme/worker-runtime');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies: {
        '@acme/worker-runtime': '1.0.0',
      },
      type: 'commonjs',
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('ignores import-like text in worker comments and strings', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "// require('@modern-js/plugin-bff/effect-edge');",
        `const documentation = "import '@modern-js/plugin-bff/effect-edge';";`,
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response(documentation), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('distinguishes locally bound require calls from module imports', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const invoke = require => require('i');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response(invoke(value => value)), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('rejects passing the ambient CommonJS loader through a local binding', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "(require => require('@evil/worker-runtime'))(require);",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects ambient require calls that are not static module edges', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('@evil/worker-runtime', 1);",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects ambient require calls whose specifier is a bound variable', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const effect = '@evil/worker-runtime';",
        'require(effect);',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies: { effect: '4.0.0' },
      type: 'commonjs',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects dynamic imports whose specifier is not a string literal', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const effect = '@evil/worker-runtime';",
        'void import(effect);',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not contain non-static dynamic module imports.',
      }),
    );
  });

  it('rejects the react-router browser lazy-route-loader dynamic import shape', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const route = { module: '@evil/worker-runtime' };",
        'void (async () => {',
        '  await import(/* @vite-ignore */ /* webpackIgnore: true */ route.module);',
        '})();',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not contain non-static dynamic module imports.',
      }),
    );
  });

  it('eagerly lowers local imports across real Rspack worker entries', async () => {
    for (const minimize of [false, true]) {
      const { directory, outputDirectory } = await createOutputFixture({
        routeWorker: 'worker/main.js',
      });
      const assets = await buildRsbuildWorker({
        directory,
        minimize,
        outputDirectory,
      });
      expect(assets.sort()).toEqual([
        '__modern_bff_effect.js',
        '__modern_worker_runtime.js',
        '__modern_worker_shared.js',
        'main.js',
      ]);
      await writeJson(path.join(outputDirectory, 'worker/package.json'), {
        type: 'commonjs',
      });
      await expect(
        verifyCloudflareOutput({ outputDirectory, importWorker: false }),
      ).resolves.toEqual({ ok: true, issues: [] });

      await writeJson(path.join(outputDirectory, 'worker/package.json'), {
        type: 'module',
      });
      const worker = await import(
        pathToFileURL(
          path.join(outputDirectory, 'worker/__modern_bff_effect.js'),
        ).href
      );
      (globalThis as any).__modernWorkerSharedEvaluations = 0;
      const first = await worker.loadFirst();
      expect(first).toMatchObject({ value: 'first', evaluations: 1 });
      await expect(worker.loadSecond()).resolves.toMatchObject({
        value: 'second',
      });
      const mainWorker = await import(
        pathToFileURL(path.join(outputDirectory, 'worker/main.js')).href
      );
      const shared = await mainWorker.loadShared();
      expect(shared).toBe(first);
      expect(shared.token).toBe(first.token);
      expect((globalThis as any).__modernWorkerSharedEvaluations).toBe(1);
      const dispatcher = await worker.__modern_create_effect_bff_dispatcher();
      await expect(dispatcher.dispatch()).resolves.toBeInstanceOf(Response);
      await expect(dispatcher.dispose()).resolves.toBeUndefined();
      expect(worker.mfRuntimePlugin).toMatchObject({
        name: '@module-federation/inject-data-fetch-function-plugin',
        setup: expect.any(Function),
      });
      expect(worker.mfDevRuntimePlugin).toMatchObject({
        name: '@module-federation/modern-js-v3',
        setup: expect.any(Function),
      });
    }
  });

  it('reserves collision-free runtime and shared chunk names', async () => {
    const { directory, outputDirectory } = await createOutputFixture();
    const assets = await buildRsbuildWorker({
      directory,
      entryNames: {
        bff: '__MODERN_WORKER_RUNTIME',
        route: '__MODERN_WORKER_SHARED',
      },
      minimize: true,
      outputDirectory,
    });

    expect(assets).toHaveLength(4);
    await expect(
      fs.readdir(path.join(outputDirectory, 'worker')),
    ).resolves.toEqual(
      expect.arrayContaining([
        '__MODERN_WORKER_RUNTIME.js',
        '__MODERN_WORKER_SHARED.js',
        '__modern_worker_runtime_.js',
        '__modern_worker_shared_.js',
      ]),
    );
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      type: 'module',
    });
    const bffEntry = await import(
      pathToFileURL(
        path.join(outputDirectory, 'worker/__MODERN_WORKER_RUNTIME.js'),
      ).href
    );
    const routeEntry = await import(
      pathToFileURL(
        path.join(outputDirectory, 'worker/__MODERN_WORKER_SHARED.js'),
      ).href
    );
    expect(typeof bffEntry.loadFirst).toBe('function');
    expect(typeof routeEntry.loadShared).toBe('function');
  });

  it('rejects noncanonical worker entry output paths before compilation', () => {
    for (const entryName of [
      './__modern_worker_runtime',
      'dir/../__modern_worker_runtime',
      String.raw`dir\__modern_worker_runtime`,
      'C:/__modern_worker_runtime',
      'C:__modern_worker_runtime',
    ]) {
      expect(() =>
        getCloudflareWorkerRspackConfig([entryName, 'main']),
      ).toThrow(
        `Cloudflare worker entry name "${entryName}" must be a canonical relative output path without dot segments or backslashes.`,
      );
    }
  });

  it('rejects an explicit lazy override that leaves a runtime-selected worker chunk', async () => {
    const { directory, outputDirectory } = await createOutputFixture({
      routeWorker: 'worker/main.js',
    });
    const assets = await buildRsbuildWorker({
      directory,
      explicitLazy: true,
      minimize: true,
      outputDirectory,
    });
    expect(assets.length).toBeGreaterThan(4);

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not contain non-static dynamic module imports.',
      }),
    );
  });

  it('rejects a relative dynamic import that only resembles the Rspack chunk loader', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const runtime = { u: () => '../server/index.mjs' };",
        "void import('./' + runtime.u());",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not contain non-static dynamic module imports.',
      }),
    );
  });

  it('validates static ambient module.require calls as module edges', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "module.require('node:child_process');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundle import "node:child_process" is not a supported Worker node: builtin.',
      }),
    );
  });

  it('rejects non-static ambient module.require calls', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const target = '@evil/worker-runtime';",
        'module.require(target);',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects destructuring the ambient module loader into a local binding', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        'const { require: load } = module;',
        "load('node:child_process');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects optional calls to the ambient module loader', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "module?.require('node:child_process');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('rejects computed ambient module loader aliases', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const exports = 'require';",
        "module[exports]('node:child_process');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
      }),
    );
  });

  it('accepts quoted ambient module properties with static imports', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "module['require']('@acme/worker-runtime');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        "module['exports'] = { __modern_create_effect_bff_dispatcher };",
      ].join('\n'),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies: {
        '@acme/worker-runtime': '1.0.0',
      },
      type: 'commonjs',
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('rejects empty static module specifiers', async () => {
    for (const moduleLoad of [
      "require('');",
      "module.require('');",
      "import('');",
    ]) {
      const { outputDirectory } = await createOutputFixture({
        bffWorkerSource: [
          moduleLoad,
          'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
          'module.exports = { __modern_create_effect_bff_dispatcher };',
        ].join('\n'),
      });
      await writeJson(path.join(outputDirectory, 'worker/package.json'), {
        dependencies: { '': '1.0.0' },
        type: 'commonjs',
      });

      const result = await verifyCloudflareOutput({
        outputDirectory,
        importWorker: false,
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'invalid-worker-bundle',
          message:
            'Cloudflare worker bundle module specifiers must not be empty.',
        }),
      );
    }
  });

  it('accepts ambient require availability checks and a static dependency edge', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "const available = typeof require === 'function';",
        "require('@acme/worker-runtime');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response(String(available)), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies: { '@acme/worker-runtime': '1.0.0' },
      type: 'commonjs',
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('allows ambient loader names as destructuring property keys', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        'let local;',
        'const value = { require: 1, module: 2 };',
        '({ require: local } = value);',
        '({ module: local } = value);',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response(String(local)), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('rejects writes to ambient CommonJS loader bindings', async () => {
    for (const loaderWrite of [
      'require = loader;',
      '({ x: require } = value);',
      'module = fakeModule;',
    ]) {
      const { outputDirectory } = await createOutputFixture({
        bffWorkerSource: [
          loaderWrite,
          'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
          'module.exports = { __modern_create_effect_bff_dispatcher };',
        ].join('\n'),
      });

      const result = await verifyCloudflareOutput({
        outputDirectory,
        importWorker: false,
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'invalid-worker-bundle',
          message:
            'Cloudflare worker bundles must use exactly one string-literal specifier in ambient CommonJS loader calls and must not pass or alias the loader.',
        }),
      );
    }
  });

  it('allows require methods on locally bound module objects', async () => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        'const moduleLoader = module => module.require("i");',
        'const value = moduleLoader({ require: input => input });',
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response(value), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });

    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('rejects relative worker imports that escape through a symlink', async () => {
    const { directory, outputDirectory } = await createOutputFixture({
      bffWorkerSource: [
        "require('./escaped.js');",
        'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
        'module.exports = { __modern_create_effect_bff_dispatcher };',
      ].join('\n'),
    });
    const outsideModule = path.join(directory, 'outside-worker-module.js');
    await fs.writeFile(outsideModule, 'module.exports = {};\n');
    await fs.symlink(
      outsideModule,
      path.join(outputDirectory, 'worker/escaped.js'),
    );

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-worker-bundle',
        message:
          'Cloudflare worker bundles must not resolve outside the staged worker directory.',
      }),
    );
  });

  it('does not treat documentation mentions as generated-output mutation attempts', async () => {
    const { directory, outputDirectory } = await createOutputFixture();
    await fs.writeFile(
      path.join(directory, 'README.md'),
      "Do not rewrite '.output/server/index.mjs' or use source.replaceAll(';entityKind;', ';') in app scripts.\n",
    );
    await fs.mkdir(path.join(directory, '.modernjs'), { recursive: true });
    await fs.writeFile(
      path.join(directory, '.modernjs/ultramodern.json'),
      JSON.stringify({
        outputContract: {
          workerEntry: '.output/server/index.mjs',
          effectBffBundle: '.output/worker/__modern_bff_effect.js',
        },
      }),
    );
    await fs.mkdir(path.join(directory, 'topology'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'topology/reference-topology.json'),
      JSON.stringify({
        cloudflare: { workerEntry: '.output/server/index.mjs' },
      }),
    );
    await fs.mkdir(
      path.join(directory, 'repos/ultramodern.js/packages/app-tools'),
      { recursive: true },
    );
    await fs.writeFile(
      path.join(
        directory,
        'repos/ultramodern.js/packages/app-tools/cloudflare-entry.mjs',
      ),
      'if (handler.length > 1) handler(request, env);\n',
    );

    await expect(
      verifyCloudflareOutputMutationPolicy({
        scanRoots: [directory],
      }),
    ).resolves.toEqual({
      ok: true,
      issues: [],
    });
  });

  it('reports generated output leaks and Drizzle post-build mutation patterns', async () => {
    const { directory, outputDirectory } = await createOutputFixture({
      bffWorkerSource: 'const entityKind = true; entityKind; ;entityKind;\n',
    });
    await fs.mkdir(path.join(outputDirectory, 'public/worker'), {
      recursive: true,
    });
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'scripts/patch-output.mjs'),
      "server = '.output/server/index.mjs'; bundle = '.output/worker/__modern_bff_effect.js'; source.replaceAll(';entityKind;', ';');\n",
    );

    const outputResult = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });
    const policyResult = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
    });

    expect(outputResult.ok).toBe(false);
    expect(outputResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'public-output-leak' }),
        expect.objectContaining({ code: 'invalid-worker-bundle' }),
      ]),
    );
    expect(policyResult.ok).toBe(false);
    expect(policyResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'forbidden-mutation-pattern' }),
      ]),
    );
  });

  it('reports generated output mutations hidden behind constructed paths', async () => {
    const { directory } = await createOutputFixture();
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'scripts/patch-output.mjs'),
      [
        "server = path.join('.output', 'server', 'index.mjs');",
        "bundle = path.join('.output', 'worker', '__modern_bff_effect.js');",
      ].join('\n'),
    );

    const result = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Generated Cloudflare server worker output must not be rewritten by app scripts.',
        }),
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Generated Cloudflare BFF worker bundles must not be rewritten by app scripts.',
        }),
      ]),
    );
  });

  it('reports generated output mutations hidden behind resolved paths', async () => {
    const { directory } = await createOutputFixture();
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'scripts/patch-output.mjs'),
      [
        "server = path.resolve('.output', 'server', 'index.mjs');",
        "bundle = path.resolve('.output', 'worker', '__modern_bff_effect.js');",
      ].join('\n'),
    );

    const result = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Generated Cloudflare server worker output must not be rewritten by app scripts.',
        }),
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Generated Cloudflare BFF worker bundles must not be rewritten by app scripts.',
        }),
      ]),
    );
  });

  it('reports Effect BFF runtime-shape probing mutation patterns', async () => {
    const { directory } = await createOutputFixture();
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'scripts/probe-effect-runtime.mjs'),
      "if (typeof runtime.dispatchEffectBffRequest === 'function') runtime.dispatchEffectBffRequest(request); if (handler.length > 1) handler(request, env);\n",
    );

    const result = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Effect BFF Cloudflare dispatch must not depend on duck-typed runtime helper probing in app scripts.',
        }),
        expect.objectContaining({
          code: 'forbidden-mutation-pattern',
          message:
            'Effect BFF Cloudflare dispatch must not branch on handler.length in app scripts.',
        }),
      ]),
    );
  });

  it('exempts framework proof artifacts named in excludePaths while still scanning app scripts', async () => {
    const { directory } = await createOutputFixture();
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    const proofArtifact = path.join(
      directory,
      'scripts/validate-ultramodern-workspace.mts',
    );
    await fs.writeFile(
      proofArtifact,
      "const contract = { ssrBundle: '.output/worker/index.js', workerEntry: '.output/server/index.mjs' };\n",
    );
    await fs.writeFile(
      path.join(directory, 'scripts/patch-output.mjs'),
      "fs.writeFileSync('.output/worker/index.js', source.replaceAll(';entityKind;', ';'));\n",
    );

    const scannedResult = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
    });
    expect(scannedResult.ok).toBe(false);
    expect(
      scannedResult.issues.some(issue => issue.path === proofArtifact),
    ).toBe(true);

    const excludedResult = await verifyCloudflareOutputMutationPolicy({
      scanRoots: [path.join(directory, 'scripts')],
      excludePaths: [proofArtifact],
    });
    expect(excludedResult.ok).toBe(false);
    expect(
      excludedResult.issues.some(issue => issue.path === proofArtifact),
    ).toBe(false);
    expect(excludedResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'forbidden-mutation-pattern' }),
      ]),
    );
  });
});
