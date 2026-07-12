import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

    // The service entry mounts the RPC handler layer via defineEffectBff.
    const serviceEntry = fs.readFileSync(
      path.join(dir, 'verticals/catalog/api/index.ts'),
      'utf-8',
    );
    assert.match(serviceEntry, /RpcGroup|RpcLayer|rpc:/);

    // Topology api metadata records the protocol.
    const topology = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'topology/reference-topology.json'),
        'utf-8',
      ),
    );
    const entry = topology.verticals.find((v: any) => v.id === 'catalog');
    assert.equal(entry.api.protocol, 'rpc');

    // Canonical descriptor api surface carries protocol 'rpc'.
    const unit = (result.deliveryUnits ?? []).find(u =>
      u.unitId.endsWith('/catalog'),
    );
    const apiSurface = unit?.surfaces.find(s => s.kind === 'api');
    assert.equal(
      (apiSurface as { protocol?: string } | undefined)?.protocol,
      'rpc',
    );
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
