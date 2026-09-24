import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applyCloudflareWorkerMfRuntimeBoundary,
  applyCloudflareWorkerRspackConfig,
} from '@modern-js/app-tools-extensions/cloudflare-builder';
import {
  assertCloudflareOutput,
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} from '@modern-js/app-tools-extensions/cloudflare-output-verifier';
import { createRsbuild } from '@rsbuild/core';

const tempDirectories: string[] = [];

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
};

const withDispatcher = (source: string) =>
  [
    source,
    'const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
    'module.exports = { __modern_create_effect_bff_dispatcher };',
  ].join('\n');

const buildRsbuildWorker = async ({
  directory,
  outputDirectory,
}: {
  directory: string;
  outputDirectory: string;
}) => {
  const entryNames = { bff: '__modern_bff_effect', route: 'main' };
  const sourceDirectory = path.join(directory, 'rspack-worker-source');
  const workerDirectory = path.join(outputDirectory, 'worker');
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.rm(workerDirectory, { force: true, recursive: true });
  const sources: Record<string, string> = {
    'entry.js': [
      "import { injectDataFetchFunctionPlugin } from '@module-federation/modern-js-v3/ssr-inject-data-fetch-function-plugin';",
      "import { loadFirst } from './barrel.js';",
      'export { loadFirst };',
      'export const mfRuntimePlugin = injectDataFetchFunctionPlugin({});',
      'export const __modern_create_effect_bff_dispatcher = async () => ({ dispatch: async () => new Response("ok"), dispose: async () => {} });',
      "export const loadSecond = () => import('./second.js');",
    ].join('\n'),
    'barrel.js': [
      "export { loadFirst } from './safe.js';",
      "export { poison } from './unused-poison.js';",
    ].join('\n'),
    'safe.js': "export const loadFirst = () => import('./first.js');",
    'unused-poison.js':
      "throw new Error('unused worker barrel export was evaluated');\nexport const poison = true;",
    'package.json': JSON.stringify({ sideEffects: false }),
    'main.js': "export const loadShared = () => import('./first.js');",
    'first.js': [
      'globalThis.__modernWorkerSharedEvaluations = (globalThis.__modernWorkerSharedEvaluations ?? 0) + 1;',
      'export const token = {};',
      'export const evaluations = globalThis.__modernWorkerSharedEvaluations;',
      'export const value = "first";',
    ].join('\n'),
    'second.js': 'export const value = "second";',
  };
  await Promise.all(
    Object.entries(sources).map(([name, source]) =>
      fs.writeFile(path.join(sourceDirectory, name), `${source}\n`),
    ),
  );

  const rsbuild = await createRsbuild({
    cwd: sourceDirectory,
    rsbuildConfig: {
      environments: {
        workerSSR: {
          output: {
            cleanDistPath: false,
            distPath: { js: 'worker', root: outputDirectory },
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
              chain.optimization.minimize(true);
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

  await rsbuild.build();

  return (await fs.readdir(workerDirectory))
    .filter(entry => entry.endsWith('.js'))
    .sort();
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
    security: {
      enabled: true,
      headers: {
        referrerPolicy: 'strict-origin-when-cross-origin',
        contentTypeOptions: 'nosniff',
        permissionsPolicy: 'camera=()',
      },
      contentSecurityPolicy: {
        mode: 'report-only',
        directives: { 'default-src': ["'self'"] },
      },
      noindex: { workersDev: true, localhost: true, previewHostnames: [] },
      cors: {
        assets: true,
        allowedOrigins: [],
        allowedMethods: ['GET'],
        allowedHeaders: ['*'],
      },
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
    name: 'fixture-worker',
    main: 'server/index.mjs',
    compatibility_date: '2026-06-02',
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    assets: {
      binding: 'ASSETS',
      directory: './public',
      html_handling: 'auto-trailing-slash',
      run_worker_first: true,
    },
    ...wrangler,
  });

  return { directory, outputDirectory };
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('Cloudflare output verifier', () => {
  it('accepts framework-owned Cloudflare output contract', async () => {
    const { outputDirectory } = await createOutputFixture();

    await expect(
      assertCloudflareOutput({ outputDirectory }),
    ).resolves.toBeUndefined();
    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it('preserves custom security policy while rejecting missing output security and deployment identity', async () => {
    const { outputDirectory } = await createOutputFixture();
    const manifestPath = path.join(
      outputDirectory,
      'server/modern-worker-manifest.json',
    );
    const wranglerPath = path.join(outputDirectory, 'wrangler.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    manifest.security.contentSecurityPolicy = {
      mode: 'enforce',
      directives: {
        'default-src': ["'none'"],
        'connect-src': ['https://api.example'],
      },
    };
    await writeJson(manifestPath, manifest);
    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });

    manifest.security = {
      enabled: false,
      cors: manifest.security.cors,
    };
    await writeJson(manifestPath, manifest);
    await expect(
      verifyCloudflareOutput({ outputDirectory, importWorker: false }),
    ).resolves.toEqual({ ok: true, issues: [] });

    delete manifest.security;
    await writeJson(manifestPath, manifest);
    const wrangler = JSON.parse(await fs.readFile(wranglerPath, 'utf-8'));
    delete wrangler.name;
    wrangler.compatibility_date = 'invalid';
    await writeJson(wranglerPath, wrangler);
    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });
    expect(result.issues.map(issue => issue.message)).toEqual(
      expect.arrayContaining([
        'Cloudflare output manifest security.enabled must be a boolean.',
        'wrangler.json name must be a non-empty worker name.',
        'wrangler.json compatibility_date must use YYYY-MM-DD.',
      ]),
    );
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

  it('fails closed when the stamped delivery-unit build marker drifts from the topology record', async () => {
    const topologyRecord = {
      unitId: 'acme/checkout',
      buildMarker: '0123456789abcdef',
      sourceRevision: 'workspace',
    };
    const stamp = { ...topologyRecord, buildMarker: 'deadbeefdeadbeef' };
    const { outputDirectory } = await createOutputFixture({
      deliveryUnit: {
        ...stamp,
        surfaces: {
          ui: { ...stamp, surface: 'ui' },
          api: { ...stamp, surface: 'api' },
        },
      },
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

  it.each([
    {
      name: 'a route worker bundle the manifest promises is missing',
      fixture: { routeWorker: 'worker/routes/page.js' },
      code: 'missing-worker-bundle',
      message:
        'Cloudflare route worker manifest points to a missing worker bundle.',
    },
    {
      name: 'a manifest worker reference escaping worker/',
      fixture: { bffWorkerSource: false as const, routeWorker: '../out.js' },
      code: 'invalid-manifest',
      message:
        'Cloudflare output manifest worker bundle references must stay under worker/.',
    },
    {
      name: 'an emitted bundle importing outside worker/',
      fixture: { bffWorkerSource: "import '../server/index.mjs';\n" },
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare worker bundles must not resolve outside the staged worker directory.',
    },
    {
      name: 'an Effect BFF bundle missing its dispatcher export',
      fixture: { bffWorkerSource: 'module.exports = {};\n' },
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare Effect BFF worker bundle must expose its manifest dispatcherExport.',
    },
    {
      name: 'an import no worker dependency provides',
      fixture: {
        bffWorkerSource: withDispatcher(
          "require('@modern-js/bff-effect/effect-edge');",
        ),
      },
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare worker bundle import "@modern-js/bff-effect/effect-edge" is not provided by worker/package.json dependencies.',
    },
  ])('fails closed on $name', async ({ fixture, code, message }) => {
    const { outputDirectory } = await createOutputFixture(fixture);

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code, message }),
    );
  });

  it.each([
    {
      name: 'accepts a supported Worker node builtin',
      source: "require('node:async_hooks');",
      expectedOk: true,
    },
    {
      name: 'accepts https in the supported nodejs_compat mode',
      source: "require('node:https');",
      expectedOk: true,
    },
    {
      name: 'accepts a declared bare dependency',
      source: "require('@acme/worker-runtime');",
      dependencies: { '@acme/worker-runtime': '1.0.0' },
      expectedOk: true,
    },
    {
      name: 'rejects unsupported node builtins',
      source: "require('node:not_a_worker_builtin');",
      expectedOk: false,
    },
    {
      name: 'rejects ambient loader aliases',
      source: "const load = require; load('node:child_process');",
      expectedOk: false,
    },
    {
      name: 'rejects ambient require calls with a bound specifier',
      source: "const target = '@evil/worker-runtime'; require(target);",
      expectedOk: false,
    },
    {
      name: 'rejects dynamic imports that resemble the chunk loader',
      source:
        "const runtime = { u: () => '../server/index.mjs' }; import('./' + runtime.u());",
      expectedOk: false,
    },
    {
      name: 'ignores loader mentions in comments and strings',
      source:
        "// require('node:child_process')\nconst text = \"import('node:child_process')\";",
      expectedOk: true,
    },
  ])('enforces worker import grammar: $name', async ({
    source,
    dependencies,
    expectedOk,
  }) => {
    const { outputDirectory } = await createOutputFixture({
      bffWorkerSource: withDispatcher(source),
    });
    await writeJson(path.join(outputDirectory, 'worker/package.json'), {
      dependencies,
      type: 'commonjs',
    });

    const result = await verifyCloudflareOutput({
      outputDirectory,
      importWorker: false,
    });

    expect(result.ok).toBe(expectedOk);
    if (!expectedOk) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'invalid-worker-bundle' }),
      );
    }
  });

  it('eagerly lowers local imports across real Rspack worker entries', async () => {
    const { directory, outputDirectory } = await createOutputFixture({
      routeWorker: 'worker/main.js',
    });
    const assets = await buildRsbuildWorker({ directory, outputDirectory });

    expect(assets).toEqual([
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
      pathToFileURL(path.join(outputDirectory, 'worker/__modern_bff_effect.js'))
        .href
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
    expect((globalThis as any).__modernWorkerSharedEvaluations).toBe(1);
    const dispatcher = await worker.__modern_create_effect_bff_dispatcher();
    await expect(dispatcher.dispatch()).resolves.toBeInstanceOf(Response);
  });

  it('reports generated output leaks and post-build mutation patterns', async () => {
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
    // Listed by the walk but gone before the read, like a sibling build's
    // transient tsgo config.
    await fs.symlink(
      path.join(directory, 'deleted.json'),
      path.join(directory, 'scripts/.tsgo.1.0.resolved.json'),
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
});
