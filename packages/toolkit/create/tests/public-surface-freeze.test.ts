import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernVertical,
} from '../src/ultramodern-workspace';

/**
 * W2 characterization freeze of the public v1 surface of `@modern-js/create`.
 *
 * This suite deliberately locks CURRENT behavior so later schema-version work
 * (W3+) cannot silently break the published entry points, symbol set, or
 * result-object shape. It does NOT re-assert values already covered by
 * workspace-manifest / vertical-dry-run / codesmith-adapter / workspace-*
 * tests; it freezes structure (which subpaths load, which symbols exist, which
 * result fields are present) and the volatile build-marker semantics.
 */

const packageRoot = path.resolve(__dirname, '..');
const requireCjs = createRequire(__filename);

function readPackageJson(): any {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'),
  );
}

function resolveFromRoot(specifier: string): string {
  return path.resolve(packageRoot, specifier);
}

// ---------------------------------------------------------------------------
// 1. Public entry-point freeze
// ---------------------------------------------------------------------------

test('package.json declares the frozen v1 export subpaths', () => {
  const pkg = readPackageJson();
  assert.deepEqual(
    Object.keys(pkg.exports).sort(),
    ['.', './ultramodern-workspace', './ultramodern-workspace/codesmith'],
    'the v1 public export subpath set must not change without a deliberate freeze update',
  );
  // publishConfig.exports mirrors the same public subpaths that consumers see.
  assert.deepEqual(Object.keys(pkg.publishConfig.exports).sort(), [
    '.',
    './ultramodern-workspace',
    './ultramodern-workspace/codesmith',
  ]);
});

test('every declared export condition resolves to an existing built artifact', () => {
  const pkg = readPackageJson();
  for (const [subpath, conditions] of Object.entries<any>(pkg.exports)) {
    assert.equal(
      typeof conditions.types,
      'string',
      `${subpath} must declare a types condition`,
    );
    assert.ok(
      fs.existsSync(resolveFromRoot(conditions.types)),
      `${subpath} types artifact missing: ${conditions.types}`,
    );
    assert.ok(
      fs.existsSync(resolveFromRoot(conditions.node.import)),
      `${subpath} ESM artifact missing: ${conditions.node.import}`,
    );
    assert.ok(
      fs.existsSync(resolveFromRoot(conditions.node.require)),
      `${subpath} CJS artifact missing: ${conditions.node.require}`,
    );
    assert.ok(
      fs.existsSync(resolveFromRoot(conditions.default)),
      `${subpath} default artifact missing: ${conditions.default}`,
    );
  }
});

test('typesVersions maps each public subpath to its declaration entry', () => {
  const pkg = readPackageJson();
  const map = pkg.typesVersions['*'];
  assert.deepEqual(map['.'], ['./dist/types/index.d.ts']);
  assert.deepEqual(map['ultramodern-workspace'], [
    './dist/types/ultramodern-workspace/public-api.d.ts',
  ]);
  assert.deepEqual(map['ultramodern-workspace/codesmith'], [
    './dist/types/ultramodern-workspace/codesmith.d.ts',
  ]);
});

test('ultramodern-workspace subpath loads (ESM + CJS) with its frozen symbol set', async () => {
  const pkg = readPackageJson();
  const conditions = pkg.exports['./ultramodern-workspace'];

  const esm = await import(
    pathToFileURL(resolveFromRoot(conditions.node.import)).href
  );
  const cjs = requireCjs(resolveFromRoot(conditions.node.require));

  for (const namespace of [esm, cjs]) {
    for (const symbol of [
      'generateUltramodernWorkspace',
      'addUltramodernVertical',
      'planUltramodernVertical',
      'normalizeUltramodernBridgeConfig',
    ]) {
      assert.equal(
        typeof namespace[symbol],
        'function',
        `ultramodern-workspace public subpath must export ${symbol}`,
      );
    }
  }
});

test('ultramodern-workspace/codesmith subpath loads (ESM + CJS) as a default adapter function', async () => {
  const pkg = readPackageJson();
  const conditions = pkg.exports['./ultramodern-workspace/codesmith'];

  const esm = await import(
    pathToFileURL(resolveFromRoot(conditions.node.import)).href
  );
  const cjs = requireCjs(resolveFromRoot(conditions.node.require));

  assert.equal(
    typeof esm.default,
    'function',
    'CodeSmith adapter ESM build must expose a default adapter function',
  );
  // The CJS interop shape is part of the public contract: `require(subpath)`
  // must be directly callable as the adapter (CodeSmith `require`s it).
  const cjsAdapter = typeof cjs === 'function' ? cjs : cjs.default;
  assert.equal(
    typeof cjsAdapter,
    'function',
    'CodeSmith adapter CJS build must be callable as the adapter function',
  );
});

// ---------------------------------------------------------------------------
// 1b. Typed generation-result shape freeze
//
// The result/plan types in src/ultramodern-workspace/types.ts (~145-193, 241-253)
// are the public automation contract. Runtime types are erased, so we freeze the
// shape by asserting every declared (non-optional) field is actually present on
// a real generated result. Adding fields is allowed; removing/renaming one must
// fail here.
// ---------------------------------------------------------------------------

const GENERATION_RESULT_FIELDS = [
  'operation',
  'workspaceRoot',
  'packageScope',
  'packageSource',
  'createdApps',
  'createdPaths',
  'rewrittenPaths',
  'assignedPorts',
  'moduleFederationNames',
  'apiPrefixes',
  'generatedContractPath',
  'warnings',
] as const;

const GENERATED_APP_DESCRIPTOR_FIELDS = [
  'id',
  'directory',
  'packageName',
  'packageSuffix',
  'displayName',
  'kind',
  'portEnv',
  'port',
  'moduleFederationName',
] as const;

const VERTICAL_PLAN_EXTRA_FIELDS = [
  'dryRun',
  'selectedPort',
  'moduleFederationRemote',
  'jsonMutations',
  'shellDependencyChanges',
  'generatedContractChanges',
] as const;

function assertHasAllFields(
  object: Record<string, unknown>,
  fields: readonly string[],
  label: string,
) {
  for (const field of fields) {
    assert.ok(
      Object.hasOwn(object, field),
      `${label} result is missing frozen public field "${field}"`,
    );
  }
}

test('generation-result and plan objects carry every frozen public field', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-surface-freeze-'));
  const workspaceDir = path.join(tempRoot, 'surface-freeze-workspace');

  try {
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'surface-freeze-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'workspace',
      },
    });

    assertHasAllFields(
      workspaceResult as unknown as Record<string, unknown>,
      GENERATION_RESULT_FIELDS,
      'workspace generation',
    );
    for (const app of workspaceResult.createdApps) {
      assertHasAllFields(
        app as unknown as Record<string, unknown>,
        GENERATED_APP_DESCRIPTOR_FIELDS,
        'workspace app descriptor',
      );
    }

    const plan = planUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assertHasAllFields(
      plan as unknown as Record<string, unknown>,
      GENERATION_RESULT_FIELDS,
      'vertical plan (base)',
    );
    assertHasAllFields(
      plan as unknown as Record<string, unknown>,
      VERTICAL_PLAN_EXTRA_FIELDS,
      'vertical plan (extra)',
    );
    assertHasAllFields(
      plan.moduleFederationRemote as unknown as Record<string, unknown>,
      ['id', 'name', 'manifestUrl'],
      'plan moduleFederationRemote',
    );

    const verticalResult = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assertHasAllFields(
      verticalResult as unknown as Record<string, unknown>,
      GENERATION_RESULT_FIELDS,
      'vertical generation',
    );
    // The vertical descriptor exercises the optional descriptor fields, which
    // are part of the frozen shape for full-stack verticals.
    const catalogApp = verticalResult.createdApps[0];
    assertHasAllFields(
      catalogApp as unknown as Record<string, unknown>,
      [...GENERATED_APP_DESCRIPTOR_FIELDS, 'exposes', 'apiPrefix'],
      'vertical app descriptor',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Volatile build-marker characterization
//
// createBuildMarker (src/ultramodern-workspace/delivery-unit.ts) is seeded once
// per module load from `Date.now()` + `crypto.randomUUID()`. This test CODIFIES
// that CURRENT behavior so Phase 1's "schema-only migration PRESERVES existing
// build markers (rotation only on declared new build)" requirement has a
// baseline: markers are STABLE within one process and DIFFER across processes.
// If a future change makes markers deterministic (or per-call random), this
// freeze must be updated deliberately.
// ---------------------------------------------------------------------------

const builtDeliveryUnitCjs = path.join(
  packageRoot,
  'dist/cjs/ultramodern-workspace/delivery-unit.cjs',
);

test('build markers are stable within a single process for identical input', () => {
  assert.ok(
    fs.existsSync(builtDeliveryUnitCjs),
    `built delivery-unit artifact missing: ${builtDeliveryUnitCjs}`,
  );
  const { createBuildMarker } = requireCjs(builtDeliveryUnitCjs);
  const app = { id: 'shell-super-app', packageSuffix: 'shell-super-app' };
  const first = createBuildMarker('freeze-scope', app);
  const second = createBuildMarker('freeze-scope', app);
  assert.equal(
    first,
    second,
    'within one process the module-load seed is fixed, so identical input must produce identical markers',
  );
  assert.match(
    first,
    /^[0-9a-f]{16}$/u,
    'build marker is a 16-char lowercase hex slice',
  );

  // Different input in the same process still diverges.
  const other = createBuildMarker('freeze-scope', {
    id: 'catalog',
    packageSuffix: 'catalog',
  });
  assert.notEqual(first, other);
});

function markerFromChildProcess(): string {
  const script = `const { createBuildMarker } = require(${JSON.stringify(
    builtDeliveryUnitCjs,
  )}); process.stdout.write(createBuildMarker('freeze-scope', { id: 'shell-super-app', packageSuffix: 'shell-super-app' }));`;
  const child = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout.trim(), /^[0-9a-f]{16}$/u, child.stderr);
  return child.stdout.trim();
}

test('build markers are deterministic across processes (identity hash)', () => {
  const first = markerFromChildProcess();
  const second = markerFromChildProcess();
  assert.equal(
    first,
    second,
    'the build marker is a stable identity hash of the delivery unit; the CLI stamps it in one process and the generated validator recomputes it in another (pnpm check), so it MUST agree across processes',
  );
});

// ---------------------------------------------------------------------------
// 3. CLI vertical-flag freeze
//
// Intentionally NOT re-tested here. The CLI vertical/dry-run flag surface is
// already frozen by:
//   - tests/vertical-dry-run.test.ts (CLI --vertical --dry-run, --dry-run gating)
//   - tests/integration/create-ultramodern-workspace/tests/index.test.ts
//     (--vertical creation, removed --microvertical flag rejection)
// Duplicating those would violate the "no duplicate coverage" constraint.
// ---------------------------------------------------------------------------
