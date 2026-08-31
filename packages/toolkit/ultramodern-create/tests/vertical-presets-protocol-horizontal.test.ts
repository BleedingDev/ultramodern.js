import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AddUltramodernVerticalOptions,
  UltramodernGenerationResult,
} from '../src/ultramodern-workspace';
import {
  addUltramodernVertical,
  planUltramodernVertical,
} from '../src/ultramodern-workspace';
import ultramodernCodeSmithAdapter from '../src/ultramodern-workspace/codesmith';
import { createWorkspace } from './helpers/workspace-kit';

const MODERN_VERSION = '3.2.1';

function withWorkspace(
  fn: (workspaceDir: string) => void,
  prefix = 'um-preset-',
) {
  const { tempRoot, workspaceDir } = createWorkspace('preset-workspace', {
    tempPrefix: prefix,
  });
  try {
    fn(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function add(
  workspaceDir: string,
  name: string,
  extra: Partial<AddUltramodernVerticalOptions> = {},
): UltramodernGenerationResult {
  return addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name,
    modernVersion: MODERN_VERSION,
    ...extra,
  });
}

function assertWorkspaceValid(workspaceDir: string) {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    { cwd: workspaceDir, encoding: 'utf-8' },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

/** Paths (relative to workspace root) created for a vertical named `name`. */
function verticalPaths(result: UltramodernGenerationResult, name: string) {
  const prefix = `verticals/${name}/`;
  return new Set(
    result.createdPaths
      .filter(p => p.startsWith(prefix))
      .map(p => p.slice(prefix.length)),
  );
}

/* -------------------------------------------------------------------------- */
/* G2a — presets                                                              */
/* -------------------------------------------------------------------------- */

test('G2a: full-stack preset is byte-identical (path set) to the legacy default', () => {
  let legacy: string[] = [];
  let explicit: string[] = [];
  withWorkspace(dir => {
    legacy = add(dir, 'catalog').createdPaths;
  });
  withWorkspace(dir => {
    explicit = add(dir, 'catalog', { preset: 'full-stack' }).createdPaths;
  });
  assert.deepEqual(explicit, legacy);
  // The default full-stack unit ships both UI and API surfaces.
  const files = new Set(legacy.map(p => p.replace('verticals/catalog/', '')));
  assert.ok(files.has('src/routes/layout.tsx'));
  assert.ok(files.has('src/federation-entry.tsx'));
  assert.ok(files.has('api/index.ts'));
  assert.ok(files.has('module-federation.config.ts'));
});

test('G2a: api-only omits every UI artifact and keeps API + backend federation', () => {
  withWorkspace(dir => {
    const result = add(dir, 'catalog', { preset: 'api-only' });
    const files = verticalPaths(result, 'catalog');

    // Forbidden UI artifacts are ABSENT.
    for (const forbidden of [
      'src/routes/layout.tsx',
      'src/routes/[lang]/page.tsx',
      'src/routes/index.css',
      'src/federation-entry.tsx',
      'src/components/catalog-widget.tsx',
      'module-federation.config.ts',
      'tailwind.config.ts',
    ]) {
      assert.ok(!files.has(forbidden), `api-only must not emit ${forbidden}`);
    }

    // API + BFF + backend-federation surfaces are PRESENT.
    for (const required of [
      'shared/api.ts',
      'api/index.ts',
      'api/backend-federation.ts',
      'api/effect-api.ts',
      'backend-federation.config.ts',
    ]) {
      assert.ok(files.has(required), `api-only must emit ${required}`);
    }

    // Headless delivery-unit record: only an api surface, no component surfaces.
    const unit = (result.deliveryUnits ?? []).find(u =>
      u.unitId.endsWith('/catalog'),
    );
    assert.ok(unit, 'api-only unit carries a canonical descriptor');
    assert.deepEqual(unit?.surfaces.map(s => s.kind).sort(), ['api']);
    assert.equal(unit?.kind, 'microvertical');

    const topology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    assert.deepEqual(topology.shell.verticalRefs, []);
    assert.deepEqual(topology.shell.moduleFederation.remotes, []);

    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/local-overlays/development.json'),
        'utf-8',
      ),
    );
    assert.equal(overlay.manifests.catalog, undefined);
    assert.equal(
      overlay.apis.catalog,
      `http://localhost:${result.assignedPorts.catalog}/catalog-api`,
    );

    const shellPackage = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'apps/shell-super-app/package.json'),
        'utf-8',
      ),
    );
    assert.equal(shellPackage['zephyr:dependencies'].catalog, undefined);
    assert.equal(
      Object.entries(shellPackage.dependencies).find(([name]) =>
        name.endsWith('/catalog'),
      )?.[1],
      'workspace:*',
    );

    const compact = JSON.parse(
      fs.readFileSync(path.join(dir, '.modernjs/ultramodern.json'), 'utf-8'),
    );
    assert.deepEqual(
      compact.topology.apps.find((app: any) => app.id === 'shell-super-app')
        .moduleFederation.verticalRefs,
      [],
    );
  });
});

test('G2a: ui-only omits every API/backend artifact and keeps routes/components', () => {
  withWorkspace(dir => {
    const result = add(dir, 'catalog', { preset: 'ui-only' });
    const files = verticalPaths(result, 'catalog');

    // Forbidden API/backend artifacts are ABSENT.
    for (const forbidden of [
      'shared/api.ts',
      'api/index.ts',
      'api/backend-federation.ts',
      'api/effect-api.ts',
      'backend-federation.config.ts',
      'src/api/catalog-client.ts',
    ]) {
      assert.ok(!files.has(forbidden), `ui-only must not emit ${forbidden}`);
    }

    // Routes / components / exposes are PRESENT.
    for (const required of [
      'src/routes/layout.tsx',
      'src/federation-entry.tsx',
      'src/components/catalog-widget.tsx',
      'module-federation.config.ts',
    ]) {
      assert.ok(files.has(required), `ui-only must emit ${required}`);
    }

    // No API surface in the descriptor and no api prefix in the result.
    const unit = (result.deliveryUnits ?? []).find(u =>
      u.unitId.endsWith('/catalog'),
    );
    assert.ok(unit && unit.surfaces.every(s => s.kind !== 'api'));
    assert.ok(!('catalog' in result.apiPrefixes));
  });
});

test('G2a: dry-run/add parity for every preset', () => {
  for (const preset of ['full-stack', 'api-only', 'ui-only'] as const) {
    withWorkspace(dir => {
      const plan = planUltramodernVertical({
        workspaceRoot: dir,
        name: 'catalog',
        modernVersion: MODERN_VERSION,
        preset,
      });
      const result = add(dir, 'catalog', { preset });
      assert.deepEqual(
        plan.createdPaths,
        result.createdPaths,
        `plan/run createdPaths must match for ${preset}`,
      );
      assert.deepEqual(plan.rewrittenPaths, result.rewrittenPaths);
      assert.deepEqual(plan.createdApps, result.createdApps);
    });
  }
});

test('extended-v1 topology rehydration preserves discriminators and identity', () => {
  withWorkspace(dir => {
    add(dir, 'catalog', { apiProtocol: 'rpc' });
    add(dir, 'design-system', { horizontalRemote: true });
    add(dir, 'headless', { preset: 'api-only' });
    add(dir, 'presentational', { preset: 'ui-only' });

    const topology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    const compact = JSON.parse(
      fs.readFileSync(path.join(dir, '.modernjs/ultramodern.json'), 'utf-8'),
    );

    const topologyEntry = (id: string) =>
      topology.verticals.find((entry: any) => entry.id === id);
    const compactEntry = (id: string) =>
      compact.topology.apps.find((entry: any) => entry.id === id);

    assert.equal(topologyEntry('catalog').api.protocol, 'rpc');
    assert.equal(compactEntry('catalog').api.protocol, 'rpc');
    assert.equal(
      topologyEntry('design-system').deliveryUnitKind,
      'horizontal-remote',
    );
    assert.equal(
      compactEntry('design-system').deliveryUnitKind,
      'horizontal-remote',
    );

    for (const id of [
      'catalog',
      'design-system',
      'headless',
      'presentational',
    ]) {
      assert.ok(topologyEntry(id).deliveryUnit, `${id} topology identity`);
      assert.ok(compactEntry(id).deliveryUnit, `${id} compact identity`);
    }
    assert.equal(topologyEntry('headless').surfaceProfile, 'api-only');
    assert.equal(topologyEntry('presentational').surfaceProfile, 'ui-only');

    // An explicit REST discriminator is also additive: a later mutation must
    // not collapse it back to the strict-legacy omission.
    topologyEntry('catalog').api.protocol = 'rest';
    compactEntry('catalog').api.protocol = 'rest';
    fs.writeFileSync(
      path.join(dir, 'topology/reference-topology.json'),
      `${JSON.stringify(topology, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(dir, '.modernjs/ultramodern.json'),
      `${JSON.stringify(compact, null, 2)}\n`,
    );
    add(dir, 'rest-preserved');

    const rehydratedTopology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    const rehydratedCompact = JSON.parse(
      fs.readFileSync(path.join(dir, '.modernjs/ultramodern.json'), 'utf-8'),
    );
    assert.equal(
      rehydratedTopology.verticals.find((entry: any) => entry.id === 'catalog')
        .api.protocol,
      'rest',
    );
    assert.equal(
      rehydratedCompact.topology.apps.find(
        (entry: any) => entry.id === 'catalog',
      ).api.protocol,
      'rest',
    );
  });
});

test('G2a: CodeSmith adapter passthrough honours the preset', async () => {
  const { tempRoot, workspaceDir } = createWorkspace('preset-workspace', {
    tempPrefix: 'um-preset-cs-',
  });
  try {
    const result = (await ultramodernCodeSmithAdapter(
      {
        config: {
          mode: 'vertical',
          name: 'catalog',
          workspaceRoot: '.',
          modernVersion: MODERN_VERSION,
          preset: 'api-only',
          packageSourceStrategy: 'workspace',
        },
      },
      { outputPath: workspaceDir },
    )) as UltramodernGenerationResult;

    const files = verticalPaths(result, 'catalog');
    assert.ok(!files.has('src/routes/layout.tsx'));
    assert.ok(files.has('api/index.ts'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* G7 — API protocol SPI                                                       */
/* -------------------------------------------------------------------------- */

test('G7b: rest protocol is byte-identical (path set) to the legacy default', () => {
  let legacy: string[] = [];
  let explicit: string[] = [];
  withWorkspace(dir => {
    legacy = add(dir, 'catalog').createdPaths;
  });
  withWorkspace(dir => {
    explicit = add(dir, 'catalog', { apiProtocol: 'rest' }).createdPaths;
  });
  assert.deepEqual(explicit, legacy);
});

test('G7c: rpc protocol emits an Effect RPC contract/handlers/client', () => {
  withWorkspace(dir => {
    const result = add(dir, 'catalog', { apiProtocol: 'rpc' });
    const files = verticalPaths(result, 'catalog');

    assert.ok(files.has('shared/rpc.ts'), 'rpc emits shared/rpc.ts');
    assert.ok(
      files.has('src/api/catalog-rpc-client.ts'),
      'rpc emits an rpc client',
    );

    assert.ok(!files.has('shared/api.ts'));
    assert.ok(!files.has('src/api/catalog-client.ts'));

    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/local-overlays/development.json'),
        'utf-8',
      ),
    );
    const expectedRpcUrl = `http://localhost:${result.assignedPorts.catalog}/catalog-api/rpc`;
    assert.equal(overlay.apis.catalog, expectedRpcUrl);
    assert.equal(overlay.serverExecution.catalog.apiBaseUrl, expectedRpcUrl);

    // Topology api metadata records the protocol.
    const topology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    const entry = topology.verticals.find((v: any) => v.id === 'catalog');
    assert.equal(entry.api.protocol, 'rpc');
    assert.equal(entry.api.bff.openapi, undefined);
    assert.equal(entry.api.basePath, undefined);

    // Canonical descriptor api surface carries protocol 'rpc'.
    const unit = (result.deliveryUnits ?? []).find(u =>
      u.unitId.endsWith('/catalog'),
    );
    const apiSurface = unit?.surfaces.find(s => s.kind === 'api');
    assert.equal(
      (apiSurface as { protocol?: string } | undefined)?.protocol,
      'rpc',
    );
    assert.equal(
      apiSurface?.locations[0]?.platform === 'http'
        ? apiSurface.locations[0].address
        : undefined,
      '/catalog-api/rpc',
    );
    assertWorkspaceValid(dir);
  });
});

test('G7c: dry-run/add parity for the rpc protocol', () => {
  withWorkspace(dir => {
    const plan = planUltramodernVertical({
      workspaceRoot: dir,
      name: 'catalog',
      modernVersion: MODERN_VERSION,
      apiProtocol: 'rpc',
    });
    const result = add(dir, 'catalog', { apiProtocol: 'rpc' });
    assert.deepEqual(plan.createdPaths, result.createdPaths);
  });
});

test('G7c: api-only Cloudflare proof targets the real RPC worker route', () => {
  withWorkspace(dir => {
    add(dir, 'catalog', { preset: 'api-only', apiProtocol: 'rpc' });

    const proofPath = path.join(dir, 'cloudflare-proof.json');
    const proofResult = spawnSync(
      process.execPath,
      [
        path.resolve(
          __dirname,
          '../templates/workspace-scripts/proof-cloudflare-version.mjs',
        ),
        '--out',
        proofPath,
      ],
      {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: dir },
      },
    );
    assert.equal(
      proofResult.status,
      0,
      `${proofResult.stdout}\n${proofResult.stderr}`,
    );

    const compact = JSON.parse(
      fs.readFileSync(path.join(dir, '.modernjs/ultramodern.json'), 'utf-8'),
    );
    const catalogConfig = compact.topology.apps.find(
      (app: { id: string }) => app.id === 'catalog',
    );
    assert.equal(catalogConfig.backendFederation.versionBoundary.ui, undefined);
    assert.equal(
      catalogConfig.backendFederation.executionSurfaces.cloudflare.ssr,
      undefined,
    );
    assert.equal(
      catalogConfig.backendFederation.executionSurfaces.cloudflare.api
        .effectBffBundle,
      '.output/worker/__modern_bff_effect.js',
    );
    const report = JSON.parse(fs.readFileSync(proofPath, 'utf-8'));
    const catalog = report.proofTargets.find(
      (target: { appId: string }) => target.appId === 'catalog',
    );
    assert.deepEqual(catalog.cloudflare.routes, {
      rpc: '/catalog-api/rpc',
    });
    assert.deepEqual(catalog.cloudflare.jsonSmokeChecks, [
      {
        id: 'catalog-rpc-smoke',
        method: 'POST',
        route: '/catalog-api/rpc',
        body: {
          jsonrpc: '2.0',
          id: 'catalog-cloudflare-proof',
          method: 'list',
          params: { limit: 1 },
        },
        expect: {
          id: 'catalog-cloudflare-proof',
          'result.items.0.id': 'starter-catalog',
        },
      },
    ]);
    assert.equal(
      catalog.deliveryUnit.buildMarker,
      catalogConfig.deliveryUnit.buildMarker,
    );
    assert.deepEqual(Object.keys(catalog.deliveryUnit.surfaces), ['api']);

    const shell = report.proofTargets.find(
      (target: { appId: string }) => target.appId === 'shell-super-app',
    );
    assert.deepEqual(shell.cloudflare.serviceBindings, [
      {
        appId: 'catalog',
        binding: 'VERTICAL_CATALOG_WORKER',
        route: '/catalog-api/rpc',
        service: `${path.basename(dir)}-catalog`,
        interface: 'fetch',
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 'catalog-cloudflare-proof',
          method: 'list',
          params: { limit: 1 },
        },
        expect: {
          id: 'catalog-cloudflare-proof',
          'result.items.0.id': 'starter-catalog',
        },
      },
    ]);
  });
});

test('Cloudflare public proof executes only declared API-only RPC behavior', async () => {
  const proofModule = await import(
    pathToFileURL(
      path.resolve(
        __dirname,
        '../templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
      ),
    ).href
  );
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'catalog-cloudflare-proof',
        result: { items: [{ id: 'starter-catalog' }] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const evidence = await proofModule.validateApp(
      {
        id: 'catalog',
        deploy: {
          cloudflare: {
            routes: { rpc: '/catalog-api/rpc' },
            jsonSmokeChecks: [
              {
                id: 'catalog-rpc-smoke',
                method: 'POST',
                route: '/catalog-api/rpc',
                body: {
                  jsonrpc: '2.0',
                  id: 'catalog-cloudflare-proof',
                  method: 'list',
                  params: { limit: 1 },
                },
                expect: {
                  id: 'catalog-cloudflare-proof',
                  'result.items.0.id': 'starter-catalog',
                },
              },
            ],
          },
        },
      },
      'https://catalog.example',
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://catalog.example/catalog-api/rpc');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      evidence.assertions.every(({ status }: any) => status === 'pass'),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generated api-only RPC entry serves the Cloudflare JSON-RPC probe', () => {
  withWorkspace(dir => {
    add(dir, 'catalog', { preset: 'api-only', apiProtocol: 'rpc' });
    fs.symlinkSync(
      path.resolve(__dirname, '../../../../node_modules/.pnpm/node_modules'),
      path.join(dir, 'node_modules'),
      'dir',
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        path.resolve(__dirname, '../node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '--eval',
        `const loaded = await import('./api/index.ts');
const runtime = loaded.default?.default ?? loaded.default;
const webHandler = runtime.createHandler();
try {
  const response = await webHandler.handler(new Request('https://catalog.example/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'catalog-cloudflare-proof', method: 'list', params: { limit: 1 } }),
  }));
  process.stdout.write('\\n__RESULT__' + JSON.stringify({ status: response.status, body: await response.json() }));
} finally {
  await webHandler.dispose();
}`,
      ],
      {
        cwd: path.join(dir, 'verticals/catalog'),
        encoding: 'utf-8',
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(
      JSON.parse(result.stdout.split('__RESULT__').at(-1) ?? ''),
      {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: 'catalog-cloudflare-proof',
          result: {
            items: [
              {
                id: 'starter-catalog',
                title: 'Wire a real catalog source here',
              },
            ],
          },
        },
      },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* G2H — horizontal remote                                                     */
/* -------------------------------------------------------------------------- */

test('G2H: horizontal remote is a components-only delivery unit with identity', () => {
  withWorkspace(dir => {
    const result = add(dir, 'design-system', { horizontalRemote: true });
    const files = verticalPaths(result, 'design-system');

    // No API surface.
    for (const forbidden of [
      'shared/api.ts',
      'api/index.ts',
      'api/effect-api.ts',
      'backend-federation.config.ts',
    ]) {
      assert.ok(
        !files.has(forbidden),
        `horizontal-remote must not emit ${forbidden}`,
      );
    }
    // Exposes components.
    assert.ok(files.has('src/federation-entry.tsx'));
    assert.ok(files.has('module-federation.config.ts'));

    // v1 topology encoding: kind stays 'vertical', true kind rides alongside.
    const topology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    const entry = topology.verticals.find((v: any) => v.id === 'design-system');
    assert.equal(entry.kind, 'vertical');
    assert.equal(entry.deliveryUnitKind, 'horizontal-remote');

    // Canonical schemaVersion-2 descriptor carries the true kind + identity.
    const unit = (result.deliveryUnits ?? []).find(u =>
      u.unitId.endsWith('/design-system'),
    );
    assert.equal(unit?.kind, 'horizontal-remote');
    assert.ok(unit && unit.buildMarker.length > 0 && unit.unitId.length > 0);
    assert.ok(unit?.surfaces.every(s => s.kind !== 'api'));
  });
});

test('G2H: dry-run/add parity for a horizontal remote', () => {
  withWorkspace(dir => {
    const plan = planUltramodernVertical({
      workspaceRoot: dir,
      name: 'design-system',
      modernVersion: MODERN_VERSION,
      horizontalRemote: true,
    });
    const result = add(dir, 'design-system', { horizontalRemote: true });
    assert.deepEqual(plan.createdPaths, result.createdPaths);
    assert.ok(!('design-system' in result.apiPrefixes));
  });
});
