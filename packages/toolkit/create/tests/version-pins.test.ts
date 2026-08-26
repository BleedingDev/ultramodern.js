import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { ULTRAMODERN_WORKSPACE_MODERN_PACKAGES } from '../src/ultramodern-package-source';
import { RELEASE_COHORT_PROJECTION_PATH } from '../src/ultramodern-release-cohort';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { createPackageRoot } from '../src/ultramodern-workspace/fs-io';
import {
  renderMinimumReleaseAgeExclude,
  ULTRAMODERN_WORKSPACE_POLICY,
} from '../src/ultramodern-workspace/policy';
import {
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_NODE_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  PNPM_VERSION,
  TANSTACK_HISTORY_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
} from '../src/ultramodern-workspace/versions';

const pluginBffPackagePath = path.resolve(
  __dirname,
  '../../../cli/plugin-bff/package.json',
);

test('pins the Module Federation 2.9 cohort exactly', () => {
  assert.equal(MODULE_FEDERATION_VERSION, '2.9.0');
  assert.equal(MODULE_FEDERATION_NODE_VERSION, '2.7.50');

  const pluginBffPackage = JSON.parse(
    fs.readFileSync(pluginBffPackagePath, 'utf-8'),
  );
  assert.equal(
    pluginBffPackage.dependencies['@module-federation/runtime'],
    MODULE_FEDERATION_VERSION,
    '@modern-js/plugin-bff must use the generated Module Federation runtime cohort',
  );
});

test('generated workspace renders the pins from versions.ts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-version-pins-'));
  const workspaceDir = path.join(tempRoot, 'pins-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'pins-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'workspace',
        modernPackageVersion: 'workspace:*',
      },
    });

    const readGenerated = (relativePath: string) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');

    const pnpmWorkspace = readGenerated('pnpm-workspace.yaml');
    const pnpmPolicy = yaml.load(pnpmWorkspace) as Record<string, any>;
    const packageSource = {
      strategy: 'workspace' as const,
      modernPackageVersion: 'workspace:*',
    };
    assert.deepEqual(pnpmPolicy.overrides, {
      '@effect/opentelemetry': EFFECT_VERSION,
      '@effect/vitest': EFFECT_VITEST_VERSION,
      '@tanstack/history': TANSTACK_HISTORY_VERSION,
      '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
      '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
      effect: EFFECT_VERSION,
      'node-fetch': NODE_FETCH_VERSION,
    });
    assert.deepEqual(pnpmPolicy.patchedDependencies, {
      [`@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`]: `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
      [`@module-federation/dts-plugin@${MODULE_FEDERATION_VERSION}`]: `patches/@module-federation__dts-plugin@${MODULE_FEDERATION_VERSION}.patch`,
      [`@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`]: `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
      [`@module-federation/runtime-core@${MODULE_FEDERATION_VERSION}`]: `patches/@module-federation__runtime-core@${MODULE_FEDERATION_VERSION}.patch`,
      [`@tanstack/router-core@${TANSTACK_ROUTER_CORE_VERSION}`]: `patches/@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`,
    });
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__dts-plugin@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation DTS patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation Modern.js patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation React bridge patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__runtime-core@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'generated Module Federation runtime-core patch file must match MODULE_FEDERATION_VERSION',
    );
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      ),
      false,
      'generated workspaces must not carry the retired Effect declaration patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      'generated Drizzle declaration patch file must be present',
    );
    assert.deepEqual(
      pnpmPolicy.minimumReleaseAgeExclude,
      renderMinimumReleaseAgeExclude({ packageSource }),
      'generated release-age exclusions must equal canonical policy',
    );
    assert.deepEqual(
      pnpmPolicy.trustPolicyExclude,
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.trustPolicyExclude,
    );
    assert.ok(
      !pnpmPolicy.minimumReleaseAgeExclude.some(selector =>
        selector.startsWith('@bleedingdev/modern-js-'),
      ),
      'local workspace generation must not add first-party registry exemptions',
    );
    for (const selector of pnpmPolicy.minimumReleaseAgeExclude) {
      const separator = selector.lastIndexOf('@');
      assert.ok(separator > 0, `${selector} must include an exact version`);
      assert.match(
        selector.slice(separator + 1),
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
        `${selector} must not use a range, tag, bare name, or glob`,
      );
    }
    for (const relativePath of ['AGENTS.md', 'README.md']) {
      const rendered = readGenerated(relativePath);
      assert.ok(
        rendered.includes(`pnpm \`${PNPM_VERSION}\``),
        `${relativePath} must render PNPM_VERSION from versions.ts`,
      );
    }

    const rootPackage = JSON.parse(readGenerated('package.json'));
    assert.equal(rootPackage.packageManager, `pnpm@${PNPM_VERSION}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local source generation rejects an explicit install request', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-install-source-'));
  const workspaceDir = path.join(tempRoot, 'install-workspace');

  try {
    assert.throws(
      () =>
        generateUltramodernWorkspace({
          targetDir: workspaceDir,
          packageName: 'install-workspace',
          modernVersion: '3.2.1',
          packageSource: {
            strategy: 'install',
            modernPackageVersion: '3.2.1',
          },
        }),
      /local @modern-js\/create source checkout cannot satisfy an explicit install/u,
    );
    assert.equal(fs.existsSync(workspaceDir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('a stale source projection cannot authorize local generation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-source-cohort-'));
  const workspaceDir = path.join(tempRoot, 'source-workspace');
  const projectionPath = path.join(
    createPackageRoot,
    'template-workspace',
    RELEASE_COHORT_PROJECTION_PATH,
  );
  const projectionDirectory = path.dirname(projectionPath);
  const projectionDirectoryExists = fs.existsSync(projectionDirectory);
  const originalProjection = fs.existsSync(projectionPath)
    ? fs.readFileSync(projectionPath)
    : undefined;

  try {
    const aliases = Object.fromEntries(
      ULTRAMODERN_WORKSPACE_MODERN_PACKAGES.map(sourceName => [
        sourceName,
        `@bleedingdev/modern-js-${sourceName.slice(sourceName.lastIndexOf('/') + 1)}`,
      ]),
    );
    fs.mkdirSync(projectionDirectory, { recursive: true });
    fs.writeFileSync(
      projectionPath,
      `${JSON.stringify(
        {
          aliases,
          packages: ULTRAMODERN_WORKSPACE_MODERN_PACKAGES.map(sourceName => ({
            sourceName,
            targetName: aliases[sourceName],
            version: '0.0.0-stale',
          })),
          release: { tag: 'stale', version: '0.0.0-stale' },
          schema: 'bleedingdev.ultramodern.release-cohort',
          schemaVersion: 1,
          source: { commit: 'a'.repeat(40), repository: 'example/source' },
        },
        null,
        2,
      )}\n`,
    );

    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'source-workspace',
      modernVersion: '3.2.1',
    });

    const compact = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, '.modernjs/ultramodern.json'),
        'utf8',
      ),
    );
    assert.equal(compact.packageSource.strategy, 'workspace');
    assert.equal(compact.packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, RELEASE_COHORT_PROJECTION_PATH)),
      false,
    );
    const pnpmPolicy = yaml.load(
      fs.readFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'utf8'),
    ) as Record<string, any>;
    assert.equal(
      pnpmPolicy.minimumReleaseAgeExclude.some((selector: string) =>
        selector.startsWith('@bleedingdev/modern-js-'),
      ),
      false,
    );
  } finally {
    if (originalProjection) {
      fs.writeFileSync(projectionPath, originalProjection);
    } else {
      fs.rmSync(projectionPath, { force: true });
      if (!projectionDirectoryExists) {
        fs.rmdirSync(projectionDirectory);
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// FORK: guards a fork-only manifest shape. Upstream plugin-bff declares no
// `effect` dependency and no `peerDependencies` block, so this test only fails
// when a sync merge reverts the fork side of
// packages/cli/plugin-bff/package.json.
test('plugin-bff declares the same Effect cohort generated workspaces pin', () => {
  const pluginBffPackage = JSON.parse(
    fs.readFileSync(pluginBffPackagePath, 'utf-8'),
  );

  assert.equal(
    pluginBffPackage.dependencies.effect,
    undefined,
    '@modern-js/plugin-bff must declare Effect as a peer so consumers keep a single Effect identity',
  );
  assert.equal(
    pluginBffPackage.peerDependencies.effect,
    EFFECT_VERSION,
    '@modern-js/plugin-bff must not force a different Effect version than generated pnpm overrides',
  );
  assert.equal(
    pluginBffPackage.devDependencies.effect,
    EFFECT_VERSION,
    '@modern-js/plugin-bff must install the Effect cohort locally (autoInstallPeers is disabled)',
  );
  // `@effect/opentelemetry` declares a REQUIRED `effect` peer of its own, so it
  // must move with `effect` into the optional-peer lane. Leaving it in
  // `dependencies` would re-impose that peer on every hono-only consumer
  // transitively and make the optional `effect` peer a fiction.
  assert.equal(
    pluginBffPackage.dependencies['@effect/opentelemetry'],
    undefined,
    '@modern-js/plugin-bff must declare @effect/opentelemetry as a peer, not a dependency',
  );
  assert.equal(
    pluginBffPackage.peerDependencies['@effect/opentelemetry'],
    EFFECT_VERSION,
    '@modern-js/plugin-bff must keep @effect/opentelemetry on the generated Effect cohort',
  );
  assert.equal(
    pluginBffPackage.peerDependenciesMeta['@effect/opentelemetry'].optional,
    true,
    '@modern-js/plugin-bff must keep the @effect/opentelemetry peer optional',
  );
  assert.equal(
    pluginBffPackage.devDependencies['@effect/opentelemetry'],
    EFFECT_VERSION,
    '@modern-js/plugin-bff must install @effect/opentelemetry locally (autoInstallPeers is disabled)',
  );
  assert.equal(
    [
      ...Object.values(pluginBffPackage.dependencies ?? {}),
      ...Object.values(pluginBffPackage.devDependencies ?? {}),
      ...Object.values(pluginBffPackage.peerDependencies ?? {}),
    ].includes('4.0.0-beta.91'),
    false,
  );
});
