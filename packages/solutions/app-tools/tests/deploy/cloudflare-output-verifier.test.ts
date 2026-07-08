import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../',
);

import { createCloudflareOutputPlan } from '../../src/plugins/deploy/platforms/cloudflare-output-plan';
import {
  assertCloudflareOutput,
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} from '../../src/plugins/deploy/platforms/cloudflare-output-verifier/index';

const tempDirectories: string[] = [];

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}`, `${JSON.stringify(value, null, 2)}\n`);
};

const createOutputFixture = async ({
  bffWorkerSource = 'module.exports = { default: { handler: async () => new Response("ok") } };\n',
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
  await fs.writeFile(
    path.join(outputDirectory, 'server/index.mjs'),
    'export default { fetch: async () => new Response("ok") };\n',
  );
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
  await writeJson(
    path.join(outputDirectory, 'server/modern-worker-manifest.json'),
    {
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
              runtimeFramework: 'effect',
              prefix: '/api',
              worker: 'worker/__modern_bff_effect.js',
            },
          }),
      ...(deliveryUnit === undefined ? {} : { deliveryUnit }),
    },
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
      types:
        './dist/types/plugins/deploy/platforms/cloudflare-output-verifier/index.d.ts',
      import:
        './dist/esm-node/plugins/deploy/platforms/cloudflare-output-verifier/index.mjs',
      require:
        './dist/cjs/plugins/deploy/platforms/cloudflare-output-verifier/index.js',
      default:
        './dist/cjs/plugins/deploy/platforms/cloudflare-output-verifier/index.js',
    });
  });

  it('accepts framework-owned Cloudflare output contract', async () => {
    const { outputDirectory } = await createOutputFixture();

    await expect(
      assertCloudflareOutput({ outputDirectory }),
    ).resolves.toBeUndefined();
    await expect(verifyCloudflareOutput({ outputDirectory })).resolves.toEqual({
      ok: true,
      issues: [],
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

    await expect(verifyCloudflareOutput({ outputDirectory })).resolves.toEqual({
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

  it('rejects emitted worker bundles that reference server output paths', async () => {
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
          'Cloudflare worker bundles must not reference framework-owned server output paths.',
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
});
