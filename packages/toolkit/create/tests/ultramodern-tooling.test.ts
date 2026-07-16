import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../src/ultramodern-tooling/config';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  createFederatedComponentsRegistry,
  createRemoteExposeFragmentPage,
} from '../src/ultramodern-workspace/demo-components';
import {
  createAppModernConfig,
  createBackendModuleFederationConfig,
  createRemoteModuleFederationConfig,
} from '../src/ultramodern-workspace/module-federation';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
} from '../src/ultramodern-workspace/package-json';
import {
  renderMinimumReleaseAgeExclude,
  ULTRAMODERN_WORKSPACE_POLICY,
} from '../src/ultramodern-workspace/policy';
import {
  DRIZZLE_ORM_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  OXFMT_VERSION,
  PNPM_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TYPESCRIPT_COMPILER_API_VERSION,
  TYPESCRIPT_VERSION,
} from '../src/ultramodern-workspace/versions';

const retiredContractPath = '.modernjs/ultramodern-generated-contract.json';
const retiredPackageSourcePath = '.modernjs/ultramodern-package-source.json';

function readJson(workspaceDir: string, relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function readText(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function scaffoldWorkspace(name: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tooling-'));
  const workspaceDir = path.join(tempRoot, name);
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: name,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  return { tempRoot, workspaceDir };
}

function exists(workspaceDir: string, relativePath: string) {
  return fs.existsSync(path.join(workspaceDir, relativePath));
}

function assertNoDanglingScriptReferences(workspaceDir: string) {
  const rootPackage = readJson(workspaceDir, 'package.json');
  const scripts = rootPackage.scripts ?? {};
  const referencePattern = /(?:\.\/|(?:\.\.\/)+)?scripts\/[\w.-]+\.m[jt]s/gu;
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') {
      continue;
    }
    for (const reference of value.match(referencePattern) ?? []) {
      const relative = reference.replace(/^(?:\.\/|(?:\.\.\/)+)/u, '');
      assert.equal(
        exists(workspaceDir, relative),
        true,
        `script "${name}" references missing file ${reference}`,
      );
    }
  }
}

test('generated tool wrapper scripts emit oxfmt-clean single-quoted source', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-wrapper-quotes',
  );

  try {
    const wrapper = readText(workspaceDir, 'scripts/assert-mf-types.mts');
    assert.match(wrapper, /\['ultramodern', 'mf-types', \.\.\.\[\], /u);
    assert.doesNotMatch(
      wrapper,
      /"ultramodern"|"mf-types"/u,
      'wrappers must not emit double-quoted string literals',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate preserves consumer-owned check segments and rewrites migrated script refs', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-check-merge');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const before = readJson(workspaceDir, 'package.json');
    before.scripts['content:validate'] = 'node ./scripts/content-validate.mjs';
    before.scripts.check = `${before.scripts.check} && pnpm content:validate && pnpm design-system:check`;
    before.scripts['design-system:check'] = 'echo design-system';
    before.scripts['ultramodern:assert-mf-types'] =
      'node ./scripts/assert-mf-types.mjs';
    writeJson(workspaceDir, 'package.json', before);
    fs.writeFileSync(
      path.join(workspaceDir, 'scripts/content-validate.mjs'),
      'export {};\n',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const after = readJson(workspaceDir, 'package.json');
    assert.match(after.scripts.check, /pnpm node:proof/u);
    assert.ok(
      after.scripts.check.endsWith('&& pnpm performance:readiness'),
      after.scripts.check,
    );
    assert.match(after.scripts.check, /pnpm content:validate/u);
    assert.match(after.scripts.check, /pnpm design-system:check/u);
    assert.equal(
      after.scripts['content:validate'],
      'node ./scripts/content-validate.mjs',
    );
    assert.equal(after.scripts['design-system:check'], 'echo design-system');
    assert.equal(
      after.scripts['ultramodern:assert-mf-types'],
      'node ./scripts/assert-mf-types.mts',
    );
    assertNoDanglingScriptReferences(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate keeps version fields consistent across the compact config', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-version-sync');

  try {
    const before = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(before.generator.version, '3.2.1');
    before.workspace.node.version = '26.3.0';
    before.workspace.node.engineRange = '>=24';
    before.workspace.packageManager.version = '11.9.0';
    writeJson(workspaceDir, '.modernjs/ultramodern.json', before);

    const rootPackageBefore = readJson(workspaceDir, 'package.json');
    rootPackageBefore.packageManager = 'pnpm@11.9.0';
    rootPackageBefore.engines = {
      node: '>=24',
      pnpm: '>=10',
    };
    writeJson(workspaceDir, 'package.json', rootPackageBefore);

    fs.writeFileSync(
      path.join(workspaceDir, '.mise.toml'),
      '[tools]\nnode = "26.3.0"\npnpm = "11.9.0"\n',
      'utf-8',
    );
    const workflowPath = path.join(
      workspaceDir,
      '.github/workflows/ultramodern-workspace-gates.yml',
    );
    fs.writeFileSync(
      workflowPath,
      fs
        .readFileSync(workflowPath, 'utf-8')
        .replace(/^(\s*)node-version\s*:\s*.*$/mu, "$1node-version: '26.3.0'"),
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const after = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(after.packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(
      after.generator.version,
      'workspace:*',
      'generator.version must track the migrated package source',
    );
    assert.equal(after.workspace.node.version, NODE_VERSION);
    assert.equal(after.workspace.node.engineRange, '>=26');
    assert.equal(after.workspace.packageManager.name, 'pnpm');
    assert.equal(after.workspace.packageManager.version, PNPM_VERSION);

    const rootPackageAfter = readJson(workspaceDir, 'package.json');
    assert.equal(rootPackageAfter.packageManager, `pnpm@${PNPM_VERSION}`);
    assert.equal(rootPackageAfter.engines.node, '>=26');
    assert.equal(rootPackageAfter.engines.pnpm, '>=11');
    assert.match(
      readText(workspaceDir, '.mise.toml'),
      new RegExp(`node = "${NODE_VERSION}"`, 'u'),
    );
    assert.match(
      readText(workspaceDir, '.mise.toml'),
      new RegExp(`pnpm = "${PNPM_VERSION}"`, 'u'),
    );
    assert.match(
      readText(
        workspaceDir,
        '.github/workflows/ultramodern-workspace-gates.yml',
      ),
      new RegExp(`node-version: '${NODE_VERSION}'`, 'u'),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('fresh shell-only workspace omits backend-federation and Zerops runtime surfaces', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-shell-only-fresh',
  );

  try {
    const rootPackage = readJson(workspaceDir, 'package.json');

    assert.doesNotMatch(rootPackage.scripts.check, /node:proof/u);
    assert.doesNotMatch(
      rootPackage.scripts.check,
      /node:backend-federation:generate/u,
    );
    assert.equal(rootPackage.scripts['node:proof'], undefined);
    assert.equal(
      rootPackage.scripts['node:backend-federation:generate'],
      undefined,
    );
    assert.equal(rootPackage.scripts['zerops:materialize'], undefined);
    assert.equal(rootPackage.scripts['cloudflare:ssr-proof'], undefined);
    assert.equal(
      exists(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/materialize-zerops-runtime.mjs'),
      false,
    );
    assert.equal(exists(workspaceDir, 'scripts/proof-workerd-ssr.mts'), false);
    assertNoDanglingScriptReferences(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate does not inject backend-federation gates into a shell-only workspace', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-shell-only');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const rootPackage = readJson(workspaceDir, 'package.json');
    assert.doesNotMatch(rootPackage.scripts.check, /node:proof/u);
    assert.doesNotMatch(
      rootPackage.scripts.check,
      /node:backend-federation:generate/u,
    );
    assert.ok(
      rootPackage.scripts.check.endsWith('&& pnpm performance:readiness'),
    );
    assert.equal(rootPackage.scripts['node:proof'], undefined);
    assert.equal(
      rootPackage.scripts['node:backend-federation:generate'],
      undefined,
    );
    assert.equal(rootPackage.scripts['zerops:materialize'], undefined);
    assert.equal(rootPackage.scripts['cloudflare:ssr-proof'], undefined);
    assert.equal(
      exists(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      false,
    );
    assert.equal(
      exists(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
      false,
    );
    assertNoDanglingScriptReferences(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate reconciles backend federation config files with API metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-api-cleanup');

  try {
    for (const name of ['catalog', 'checkout']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name,
        modernVersion: '3.2.1',
      });
    }

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const catalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    delete catalog.api;
    writeJson(workspaceDir, '.modernjs/ultramodern.json', compactConfig);

    const referenceTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const referenceCatalog = referenceTopology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    delete referenceCatalog.api;
    writeJson(
      workspaceDir,
      'topology/reference-topology.json',
      referenceTopology,
    );

    for (const app of ['catalog', 'checkout']) {
      fs.writeFileSync(
        path.join(
          workspaceDir,
          'verticals',
          app,
          'backend-federation.config.ts',
        ),
        'stale\n',
      );
    }

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    assert.equal(
      exists(workspaceDir, 'verticals/catalog/backend-federation.config.ts'),
      false,
    );

    const checkout = workspaceAppsFromToolingConfig(
      readUltramodernConfig(workspaceDir),
    ).find(app => app.id === 'checkout');
    assert.ok(checkout);
    assert.ok(checkout.api);
    assert.equal(
      readText(workspaceDir, 'verticals/checkout/backend-federation.config.ts'),
      createBackendModuleFederationConfig(checkout),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate materializes every validator-required wrapper and rewires legacy scripts', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-legacy-scripts',
  );

  try {
    const legacyRenames = [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ];
    for (const name of legacyRenames) {
      fs.renameSync(
        path.join(workspaceDir, `scripts/${name}.mts`),
        path.join(workspaceDir, `scripts/${name}.mjs`),
      );
    }
    const before = readJson(workspaceDir, 'package.json');
    before.scripts['skills:install'] =
      'node ./scripts/bootstrap-agent-skills.mjs';
    before.scripts['skills:check'] =
      'node ./scripts/bootstrap-agent-skills.mjs --check';
    before.scripts.postinstall =
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall";
    before.scripts['agents:refs:install'] =
      'node ./scripts/setup-agent-reference-repos.mjs';
    before.scripts['i18n:boundaries'] =
      'node ./scripts/check-ultramodern-i18n-boundaries.mjs';
    writeJson(workspaceDir, 'package.json', before);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    for (const name of legacyRenames) {
      assert.equal(exists(workspaceDir, `scripts/${name}.mts`), true, name);
      assert.equal(exists(workspaceDir, `scripts/${name}.mjs`), false, name);
    }
    const after = readJson(workspaceDir, 'package.json');
    assert.equal(
      after.scripts['skills:install'],
      'node ./scripts/bootstrap-agent-skills.mts',
    );
    assert.equal(
      after.scripts['skills:check'],
      'node ./scripts/bootstrap-agent-skills.mts --check',
    );
    assert.equal(
      after.scripts.postinstall,
      "node ./scripts/bootstrap-agent-skills.mts --postinstall && oxfmt . '!repos/**'",
    );
    assert.equal(
      after.scripts['agents:refs:install'],
      'node ./scripts/setup-agent-reference-repos.mts',
    );
    assert.equal(
      after.scripts['i18n:boundaries'],
      'node ./scripts/check-ultramodern-i18n-boundaries.mts',
    );
    assertNoDanglingScriptReferences(workspaceDir);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function assertTargetIsolatedModernConfig(source: string, label: string) {
  assert.match(
    source,
    /const buildTarget = cloudflareDeployEnabled \? 'cloudflare' : 'web';/,
    `${label} must derive mutable build paths from the active target`,
  );
  assert.match(
    source,
    /const buildOutputRoot = cloudflareDeployEnabled \? 'dist-cloudflare' : 'dist';/,
    `${label} must isolate normal and Cloudflare output roots`,
  );
  assert.match(
    source,
    /const buildTempDirectory = `node_modules\/\.modern-js-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must isolate normal and Cloudflare Modern temp directories`,
  );
  assert.match(
    source,
    /const buildCacheDirectory = `node_modules\/\.cache\/rspack-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must isolate Rspack cache directories by target`,
  );
  assert.match(
    source,
    /root: buildOutputRoot,/,
    `${label} must pass the per-target output root to the builder`,
  );
  assert.match(
    source,
    /tempDir: buildTempDirectory,/,
    `${label} must pass the per-target Modern temp directory to the builder`,
  );
  assert.match(
    source,
    /cacheDigest: \[appId, buildTarget\],/,
    `${label} must include the target in the Rspack cache digest`,
  );
}

test('Cloudflare output verifier wrapper uses explicit options contract', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../src/ultramodern-tooling/commands/cloudflare-output-verify.ts',
    ),
    'utf-8',
  );

  assert.match(
    source,
    /verifyCloudflareOutput\(\{\s+outputDirectory: target\.outputDirectory,/u,
  );
  assert.doesNotMatch(
    source,
    /verifyCloudflareOutput\(target\.outputDirectory/u,
  );
  assert.match(
    source,
    /verifyCloudflareOutputMutationPolicy\(\{\s+scanRoots,\s+excludePaths\s+\}\)/u,
  );
  assert.doesNotMatch(
    source,
    /verifyCloudflareOutputMutationPolicy\(scanRoots/u,
  );
});

test('routes-generate command drives the plugin-tanstack headless export', () => {
  const registrySource = fs.readFileSync(
    path.join(__dirname, '../src/ultramodern-tooling/commands.ts'),
    'utf-8',
  );
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../src/ultramodern-tooling/commands/routes-generate.ts',
    ),
    'utf-8',
  );

  assert.match(
    registrySource,
    /case GENERATED_TOOLING_COMMANDS\.routesGenerate\.command:/u,
  );
  assert.match(
    source,
    /generateTanstackRouteArtifacts\(\{ appDirectory: target\.appDirectory \}\)/u,
  );
  assert.match(source, /appRequire\.resolve\('@modern-js\/plugin-tanstack'\)/u);
  // The failure path must surface the full stack and cause chain, not just
  // error.message — the real route-generate crash is an opaque node error
  // thrown deep inside app-tools/plugin.
  assert.match(
    source,
    /current instanceof Error \? current\.cause : undefined/u,
  );
  assert.match(source, /current\.stack/u);
});

test('backend federation proof skips runtime loading when no backend apps exist', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-proof-empty');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-proof'],
        workspaceDir,
      ),
      0,
    );

    const report = readJson(
      workspaceDir,
      '.codex/reports/node-backend-federation-proof/proof.json',
    );
    assert.equal(report.status, 'skipped');
    assert.deepEqual(report.results, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend federation generator reads migrated app-level metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-backend-mf');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const catalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    ) as Record<string, any>;
    assert.equal(catalog.api.backendFederation, undefined);
    assert.equal(catalog.backendFederation.runtimeFramework, 'effect');

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-generate', '--app', 'catalog'],
        workspaceDir,
      ),
      0,
    );

    const manifest = readJson(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );
    assert.equal(manifest.version, '0.1.0');
    assert.match(manifest.buildVersion, /^[a-f0-9]{16}$/u);
    assert.equal(
      manifest.metaData.buildInfo.buildName,
      '@tooling-backend-mf/catalog',
    );
    assert.equal(
      manifest.metaData.buildInfo.buildVersion,
      manifest.buildVersion,
    );
    assert.equal(manifest.backendFederation.runtimeFramework, 'effect');
    assert.equal(
      manifest.backendFederation.contractVersion,
      'microvertical-server-effect-v1',
    );
    assert.equal(
      manifest.backendFederation.nodeAdapterVersion,
      'backend-mf-effect-v1',
    );
    assert.equal(manifest.backendFederation.expose, './effect-api');
    assert.deepEqual(
      manifest.exposes.map((expose: { name: string }) => expose.name),
      ['./effect-api'],
    );
    assert.equal(
      manifest.backendFederation.versionBoundary.packageName,
      '@tooling-backend-mf/catalog',
    );
    assert.equal(manifest.backendFederation.versionBoundary.version, '0.1.0');
    assert.equal(
      manifest.backendFederation.versionBoundary.buildVersion,
      manifest.buildVersion,
    );
    if (manifest.backendFederation.deliveryUnit) {
      assert.equal(
        manifest.backendFederation.deliveryUnit.kind,
        'microvertical-delivery-unit',
      );
      assert.equal(
        manifest.backendFederation.deliveryUnit.buildMarker,
        manifest.buildVersion,
      );
      assert.equal(
        manifest.backendFederation.versionBoundary.deliveryUnit.unitId,
        manifest.backendFederation.deliveryUnit.unitId,
      );
      assert.equal(
        manifest.backendFederation.versionBoundary.deliveryUnit.buildMarker,
        manifest.buildVersion,
      );
    }
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'verticals/catalog/dist/backendRemoteEntry.mjs',
        ),
      ),
      true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('backend federation proof rejects drifted delivery-unit stamps in the manifest', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'tooling-backend-mf-drift',
  );

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-generate', '--app', 'catalog'],
        workspaceDir,
      ),
      0,
    );

    const manifestPath = path.join(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );
    const manifest = readJson(
      workspaceDir,
      'verticals/catalog/dist/backend-mf-manifest.json',
    );

    if (!manifest.backendFederation?.deliveryUnit) {
      // No delivery-unit stamp was generated for this workspace shape;
      // there is nothing to drift, so the negative case does not apply.
      return;
    }

    manifest.backendFederation.deliveryUnit.buildMarker = 'deadbeefdeadbeef';
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['backend-federation-proof'],
        workspaceDir,
      ),
      1,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern tooling config reads compact config and rejects retired metadata', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-config');

  try {
    const compact = readUltramodernConfig(workspaceDir);
    assert.equal(compact.source, 'compact');
    assert.equal(compact.workspace.packageScope, 'tooling-config');
    assert.equal(compact.packageSource?.strategy, 'workspace');
    assert.equal(compact.packageSource?.modernPackageVersion, 'workspace:*');
    assert.deepEqual(
      compact.topology.apps.map(app => app.id),
      ['shell-super-app'],
    );
    assert.equal(compact.topology.apps[0].moduleFederation?.role, 'host');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, retiredContractPath)),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, retiredPackageSourcePath)),
      false,
    );

    const retiredMetadataWorkspaceDir = path.join(
      tempRoot,
      'retired-metadata-tooling-config',
    );
    fs.mkdirSync(path.join(retiredMetadataWorkspaceDir, '.modernjs'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(retiredMetadataWorkspaceDir, retiredPackageSourcePath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          strategy: 'install',
          modernPackages: {
            specifier: '3.2.0-ultramodern.108',
            registry: 'https://registry.npmjs.org/',
            aliases: {
              '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(retiredMetadataWorkspaceDir, retiredContractPath),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profile: 'cloudflare-ssr-mf-effect-v1',
          apps: [
            {
              id: 'shell-super-app',
              kind: 'shell',
              path: 'apps/shell-super-app',
              package: '@legacy-tooling-config/shell-super-app',
              styling: { tailwind: true },
              moduleFederation: {
                name: 'shellSuperApp',
                verticalRefs: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    assert.throws(
      () => readUltramodernConfig(retiredMetadataWorkspaceDir),
      /Legacy UltraModern metadata detected/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate-strict-effect updates package cohort and direct API metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-migrate');

  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const catalogEnglishLocale = readJson(
      workspaceDir,
      'verticals/catalog/locales/en/catalog.json',
    );
    catalogEnglishLocale.catalog.migrationPreserved = 'Preserved catalog copy';
    writeJson(
      workspaceDir,
      'verticals/catalog/locales/en/catalog.json',
      catalogEnglishLocale,
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/src/modern.runtime.ts'),
      `import catalogResource from '../../../verticals/catalog/locales/en/catalog.json';

export default catalogResource;
`,
      'utf-8',
    );
    const catalogFragmentPagePath = path.join(
      workspaceDir,
      'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
    );
    fs.writeFileSync(
      catalogFragmentPagePath,
      fs
        .readFileSync(catalogFragmentPagePath, 'utf-8')
        .replace(
          '@modern-js/runtime/module-federation/distributed-ssr',
          '@modern-js/runtime/module-federation',
        ),
      'utf-8',
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    topology.description = 'Stale generated workspace description.';
    topology.sharedPackages[0].description =
      'Stale generated shared package description.';
    topology.shell.moduleFederation.remotes[0].alias = 'catalog';
    topology.shell.moduleFederation.remotes[0].manifestEnv =
      'VERTICAL_CATALOG_MF_MANIFEST';
    const catalog = topology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    catalog.deliveryUnit.buildMarker = 'stale-reference-marker';
    catalog.backendFederation.deliveryUnit.buildMarker =
      'stale-reference-marker';
    catalog.api = {
      ...catalog.api,
      effect: {
        stem: 'catalog',
        prefix: '/catalog-api',
        consumedBy: ['shell-super-app', 'catalog'],
      },
      bff: {
        prefix: '/catalog-api',
        strictEffectApproach: false,
      },
      contract: {
        export: './shared/effect/api',
        path: 'verticals/catalog/shared/effect/api.ts',
      },
      client: {
        export: './effect/client',
        path: 'verticals/catalog/src/effect/catalog-client.ts',
      },
      serverEntry: 'verticals/catalog/api/effect/index.ts',
    };
    delete catalog.api.runtime;
    catalog.api.backendFederation = {
      entry: 'verticals/catalog/api/backend-federation.ts',
    };
    catalog.backendFederation.entry =
      'verticals/catalog/api/backend-federation.ts';
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);

    const compactConfigBefore = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const compactCatalog = compactConfigBefore.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    compactCatalog.deliveryUnit.buildMarker = 'stale-compact-marker';
    compactCatalog.backendFederation.deliveryUnit.buildMarker =
      'stale-compact-marker';
    delete compactConfigBefore.tooling.wrappers.backendFederationProof;
    delete compactConfigBefore.backendFederation.apps[0].deliveryUnit;
    delete compactCatalog.api.runtime;
    compactCatalog.api.backendFederation = {
      entry: 'verticals/catalog/api/backend-federation.ts',
    };
    compactCatalog.backendFederation.entry =
      'verticals/catalog/api/backend-federation.ts';
    writeJson(workspaceDir, '.modernjs/ultramodern.json', compactConfigBefore);

    const ownershipBefore = readJson(workspaceDir, 'topology/ownership.json');
    const catalogOwner = ownershipBefore.owners.find(
      (owner: Record<string, unknown>) => owner.id === 'catalog',
    );
    catalogOwner.ownership.team = 'catalog-domain-team';
    catalogOwner.ownership.pagerDuty = 'pd-catalog-domain';
    writeJson(workspaceDir, 'topology/ownership.json', ownershipBefore);

    const rootPackageBefore = readJson(workspaceDir, 'package.json');
    delete rootPackageBefore.devDependencies['@typescript/native'];
    rootPackageBefore.devDependencies.typescript = '6.0.0';
    rootPackageBefore.devDependencies['drizzle-orm'] = DRIZZLE_ORM_VERSION;
    rootPackageBefore.devDependencies.oxfmt = '0.55.0';
    rootPackageBefore.scripts['cloudflare:build'] =
      `${rootPackageBefore.scripts['cloudflare:build']} && pnpm cloudflare-output:verify`;
    rootPackageBefore.scripts['node:proof'] =
      'node ./scripts/proof-node-backend-federation.mts';
    rootPackageBefore.scripts['cloudflare-output:verify'] =
      'node ./scripts/verify-cloudflare-output.mts';
    rootPackageBefore.scripts['node:backend-federation:generate'] =
      'node ./scripts/generate-node-backend-federation.mts';
    writeJson(workspaceDir, 'package.json', rootPackageBefore);

    for (const relativePath of [
      'scripts/generate-node-backend-federation.mts',
      'scripts/proof-node-backend-federation.mts',
      'scripts/verify-cloudflare-output.mts',
      'apps/shell-super-app/src/ultramodern-build.ts',
      'apps/shell-super-app/shared/ultramodern-build.json',
      'apps/shell-super-app/shared/ultramodern-build.ts',
      'verticals/catalog/api/backend-federation.ts',
      'verticals/catalog/src/ultramodern-build.ts',
      'verticals/catalog/shared/ultramodern-build.json',
      'verticals/catalog/shared/ultramodern-build.ts',
    ]) {
      fs.writeFileSync(path.join(workspaceDir, relativePath), 'stale\n');
    }
    fs.rmSync(
      path.join(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
      { force: true },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
      ),
      { force: true },
    );

    for (const packageFile of [
      'apps/shell-super-app/package.json',
      'verticals/catalog/package.json',
    ]) {
      const appId = packageFile.includes('shell-super-app')
        ? 'shell-super-app'
        : 'catalog';
      const packageJson = readJson(workspaceDir, packageFile);
      if (appId === 'catalog') {
        packageJson.scripts.build = packageJson.scripts.build.replace(
          'modern build',
          'modern build && node ../../scripts/generate-node-backend-federation.mts --app catalog',
        );
        packageJson.scripts['cloudflare:build'] = packageJson.scripts[
          'cloudflare:build'
        ].replace(
          'MODERNJS_DEPLOY=cloudflare modern build',
          'MODERNJS_DEPLOY=cloudflare modern build && node ../../scripts/generate-node-backend-federation.mts --app catalog --target dist-cloudflare',
        );
      }
      packageJson.scripts['cloudflare:build'] = packageJson.scripts[
        'cloudflare:build'
      ].replace(
        'MODERNJS_DEPLOY=cloudflare modern deploy --skip-build',
        'MODERNJS_DEPLOY=cloudflare modern deploy',
      );
      packageJson.scripts['cloudflare:build'] =
        `${packageJson.scripts['cloudflare:build']} && node ../../scripts/verify-cloudflare-output.mts --app ${appId}`;
      packageJson.scripts['cloudflare:deploy'] =
        `${packageJson.scripts['cloudflare:deploy']} --skip-build`;
      writeJson(workspaceDir, packageFile, packageJson);
    }

    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    const pnpmPolicy = yaml.load(
      fs.readFileSync(pnpmWorkspaceFile, 'utf-8'),
    ) as Record<string, any>;
    pnpmPolicy.peerDependencyRules.allowedVersions['@effect/vitest>effect'] =
      '4.0.0-beta.89';
    pnpmPolicy.overrides['@effect/vitest'] = '4.0.0-beta.89';
    pnpmPolicy.overrides.effect = '4.0.0-beta.89';
    delete pnpmPolicy.overrides['@effect/opentelemetry'];
    delete pnpmPolicy.patchedDependencies[`effect@${EFFECT_VERSION}`];
    pnpmPolicy.patchedDependencies['effect@4.0.0-beta.94'] =
      'patches/effect-schema-error-type-id.patch';
    delete pnpmPolicy.patchedDependencies[
      `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
    ];
    delete pnpmPolicy.patchedDependencies[`drizzle-orm@${DRIZZLE_ORM_VERSION}`];
    pnpmPolicy.minimumReleaseAgeExclude = [
      ...pnpmPolicy.minimumReleaseAgeExclude,
      '@bleedingdev/modern-js-*',
      '@module-federation/*',
      '@typescript/typescript6@6.0.2',
      'i18next@26.3.1',
    ];
    pnpmPolicy.trustPolicyExclude = [
      'effect@4.0.0-beta.94',
      '@effect/opentelemetry@4.0.0-beta.94',
    ];
    fs.writeFileSync(
      pnpmWorkspaceFile,
      yaml.dump(pnpmPolicy, {
        lineWidth: -1,
        noCompatMode: true,
        noRefs: true,
        quotingType: "'",
      }),
      'utf-8',
    );
    fs.rmSync(
      path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      {
        force: true,
      },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
      ),
      {
        force: true,
      },
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'patches/drizzle-orm-ts7-strict-declarations.patch',
      ),
      {
        force: true,
      },
    );

    const baseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    baseTsConfig.compilerOptions.skipLibCheck = true;
    writeJson(workspaceDir, 'tsconfig.base.json', baseTsConfig);

    const gitignorePath = path.join(workspaceDir, '.gitignore');
    fs.writeFileSync(
      gitignorePath,
      fs
        .readFileSync(gitignorePath, 'utf-8')
        .replace(/^\.mf\/\n/mu, '')
        .replace(/^\*\*\/\.mf\/\n/mu, '')
        .replace(/^dist-cloudflare\/\n/mu, ''),
      'utf-8',
    );

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      writeJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`, {
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          composite: true,
          incremental: true,
          tsBuildInfoFile: `../../node_modules/.cache/tsgo/${sharedPackageDir.replace(/[^a-zA-Z0-9._-]+/gu, '__')}.tsbuildinfo`,
        },
        include: ['src'],
      });
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const appTsConfig = readJson(workspaceDir, `${appDir}/tsconfig.json`);
      appTsConfig.include = [
        ...appTsConfig.include,
        'modern.config.ts',
        'module-federation.config.ts',
      ];
      writeJson(workspaceDir, `${appDir}/tsconfig.json`, appTsConfig);

      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      mfTypesTsConfig.extends = './tsconfig.json';
      writeJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
        mfTypesTsConfig,
      );

      fs.writeFileSync(
        path.join(workspaceDir, appDir, 'src/modern-app-env.d.ts'),
        `/// <reference types='@modern-js/app-tools/types' />

declare global {
  const ULTRAMODERN_SITE_URL: string;
}

declare module '*.svg' {}

declare module '*.css' {}
`,
        'utf-8',
      );
    }

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(
      compactConfig.packageSource.modernPackageVersion,
      'workspace:*',
    );
    assert.equal(compactConfig.packageSource.aliasScope, undefined);
    assert.equal(compactConfig.packageSource.aliasPackageNamePrefix, undefined);
    const migratedIdentityCatalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    const migratedIdentityTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const migratedTopologyIdentityCatalog =
      migratedIdentityTopology.verticals.find(
        (app: Record<string, unknown>) => app.id === 'catalog',
      );
    assert.equal(
      migratedIdentityTopology.description,
      'Generated UltraModern SuperApp shell that can grow by adding full-stack verticals.',
    );
    assert.equal(
      migratedIdentityTopology.sharedPackages[0].description,
      'Generated route, ownership, and topology contracts.',
    );
    assert.equal(
      migratedIdentityTopology.shell.moduleFederation.remotes[0].alias,
      undefined,
    );
    assert.equal(
      migratedIdentityTopology.shell.moduleFederation.remotes[0].manifestEnv,
      undefined,
    );
    const migratedOwnership = readJson(workspaceDir, 'topology/ownership.json');
    const migratedCatalogOwner = migratedOwnership.owners.find(
      (owner: Record<string, unknown>) => owner.id === 'catalog',
    );
    assert.equal(migratedCatalogOwner.ownership.team, 'catalog-domain-team');
    assert.equal(migratedCatalogOwner.ownership.pagerDuty, 'pd-catalog-domain');
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'scripts/validate-ultramodern-workspace.mts'),
        'utf-8',
      ),
      /catalog-domain-team/,
    );
    const migratedShellRuntime = fs.readFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/src/modern.runtime.ts'),
      'utf-8',
    );
    assert.doesNotMatch(migratedShellRuntime, /verticals\/catalog\/locales/);
    assert.match(migratedShellRuntime, /flattenLocaleResource/);
    const migratedShellLocale = readJson(
      workspaceDir,
      'apps/shell-super-app/locales/en/shell.json',
    );
    assert.equal(
      migratedShellLocale.catalog.migrationPreserved,
      'Preserved catalog copy',
    );
    assert.match(
      fs.readFileSync(catalogFragmentPagePath, 'utf-8'),
      /@modern-js\/runtime\/module-federation\/distributed-ssr/,
    );
    const migratedBuildArtifact = readJson(
      workspaceDir,
      'verticals/catalog/shared/ultramodern-build.json',
    );
    assert.equal(
      migratedIdentityCatalog.deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );
    assert.equal(
      migratedTopologyIdentityCatalog.deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );
    assert.equal(
      compactConfig.tooling.wrappers.backendFederationProof,
      'scripts/proof-node-backend-federation.mts',
    );
    assert.equal(
      compactConfig.backendFederation.apps[0].deliveryUnit.buildMarker,
      migratedBuildArtifact.deliveryUnit.buildMarker,
    );

    const rootPackage = readJson(workspaceDir, 'package.json');
    assert.equal(
      rootPackage.devDependencies['@modern-js/create'],
      'workspace:*',
    );
    assert.equal(
      rootPackage.devDependencies.typescript,
      TYPESCRIPT_COMPILER_API_VERSION,
    );
    assert.equal(
      rootPackage.devDependencies['@typescript/native'],
      `npm:typescript@${TYPESCRIPT_VERSION}`,
    );
    assert.equal(rootPackage.devDependencies.oxfmt, OXFMT_VERSION);
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.match(
      rootPackage.scripts['cloudflare:build'],
      /cloudflare-output:verify/u,
    );
    assert.doesNotMatch(
      JSON.stringify(rootPackage.scripts),
      /ULTRAMODERN_ZEPHYR/u,
    );
    assert.equal(
      rootPackage.scripts['node:proof'],
      'pnpm node:backend-federation:generate && node ./scripts/proof-node-backend-federation.mts',
    );
    assert.equal(
      rootPackage.scripts['cloudflare-output:verify'],
      'node ./scripts/verify-cloudflare-output.mts',
    );
    assert.equal(
      rootPackage.scripts['node:backend-federation:generate'],
      'node ./scripts/generate-node-backend-federation.mts',
    );
    assert.equal(
      rootPackage.scripts['zerops:materialize'],
      'node ./scripts/materialize-zerops-runtime.mjs',
    );
    assert.equal(
      rootPackage.scripts['cloudflare:ssr-proof'],
      'node ./scripts/proof-workerd-ssr.mts',
    );
    assert.match(
      rootPackage.scripts['cloudflare:build'],
      /&& pnpm cloudflare:ssr-proof$/u,
    );
    for (const relativePath of [
      'scripts/generate-node-backend-federation.mts',
      'scripts/proof-node-backend-federation.mts',
      'scripts/verify-cloudflare-output.mts',
      'scripts/materialize-zerops-runtime.mjs',
      'scripts/proof-workerd-ssr.mts',
      'verticals/catalog/api/backend-federation.ts',
      'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
    ]) {
      assert.equal(fs.existsSync(path.join(workspaceDir, relativePath)), true);
    }
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'scripts/proof-workerd-ssr.mts'),
        'utf-8',
      ),
      /modules: createWorkerModules\(app\.outputRoot, main\)/u,
    );
    assert.throws(() =>
      fs.readFileSync(
        path.join(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
        'utf-8',
      ),
    );
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
        'utf-8',
      ),
      /backend-federation-proof/,
    );
    const zeropsMaterializer = readText(
      workspaceDir,
      'scripts/materialize-zerops-runtime.mjs',
    );
    assert.match(zeropsMaterializer, /MODERNJS_DEPLOY: 'node'/u);
    assert.match(zeropsMaterializer, /'deploy',\s*'--skip-build'/u);
    assert.match(zeropsMaterializer, /normalizeRuntimePackageDependencies/u);
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'verticals/catalog/api/backend-federation.ts'),
        'utf-8',
      ),
      /backendFederationContract/,
    );
    assert.equal(
      readJson(
        workspaceDir,
        'apps/shell-super-app/shared/ultramodern-build.json',
      ).deliveryUnit.appId,
      'shell-super-app',
    );
    assert.equal(
      readJson(workspaceDir, 'verticals/catalog/shared/ultramodern-build.json')
        .deliveryUnit.packageName,
      '@tooling-migrate/catalog',
    );
    assert.match(
      readText(workspaceDir, 'verticals/catalog/shared/ultramodern-build.ts'),
      /ultramodernBuildArtifact\.deliveryUnit/,
    );
    assert.match(
      readText(workspaceDir, 'verticals/catalog/src/ultramodern-build.ts'),
      /from '\.\.\/shared\/ultramodern-build'/,
    );
    const migratedTopologyCatalog = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    ).verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    assert.equal(migratedTopologyCatalog.backendFederation.entry, undefined);
    assert.equal(migratedTopologyCatalog.api.backendFederation, undefined);
    const migratedCompactCatalog = compactConfig.topology.apps.find(
      (app: Record<string, unknown>) => app.id === 'catalog',
    );
    assert.equal(migratedCompactCatalog.backendFederation.entry, undefined);
    assert.equal(migratedCompactCatalog.api.backendFederation, undefined);
    assert.equal(migratedCompactCatalog.api.runtime, 'effect');
    const shellModernConfig = readText(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    assert.match(shellModernConfig, /services:\s*\[/);
    assert.match(shellModernConfig, /VERTICAL_CATALOG_WORKER_BINDING/);
    assert.match(shellModernConfig, /VERTICAL_CATALOG_WORKER_NAME/);

    const pnpmWorkspace = fs.readFileSync(pnpmWorkspaceFile, 'utf-8');
    const migratedPnpmPolicy = yaml.load(pnpmWorkspace) as Record<string, any>;
    assert.equal(
      migratedPnpmPolicy.peerDependencyRules.allowedVersions[
        '@effect/vitest>effect'
      ],
      EFFECT_VERSION,
    );
    assert.equal(
      migratedPnpmPolicy.overrides['@effect/vitest'],
      EFFECT_VITEST_VERSION,
    );
    assert.equal(migratedPnpmPolicy.overrides.effect, EFFECT_VERSION);
    assert.equal(
      migratedPnpmPolicy.overrides['@effect/opentelemetry'],
      EFFECT_VERSION,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `@module-federation/modern-js-v3@${MODULE_FEDERATION_VERSION}`
      ],
      `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `@module-federation/bridge-react@${MODULE_FEDERATION_VERSION}`
      ],
      `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[`effect@${EFFECT_VERSION}`],
      'patches/effect-schema-error-type-id.patch',
    );
    assert.equal(
      migratedPnpmPolicy.patchedDependencies[
        `drizzle-orm@${DRIZZLE_ORM_VERSION}`
      ],
      'patches/drizzle-orm-ts7-strict-declarations.patch',
    );
    assert.deepEqual(
      migratedPnpmPolicy.minimumReleaseAgeExclude,
      renderMinimumReleaseAgeExclude({
        packageSource: {
          strategy: 'workspace',
          modernPackageVersion: 'workspace:*',
        },
      }),
    );
    assert.equal(
      migratedPnpmPolicy.minimumReleaseAgeExclude.some((selector: string) =>
        selector.startsWith('@bleedingdev/modern-js-'),
      ),
      false,
    );
    assert.equal(
      migratedPnpmPolicy.minimumReleaseAgeExclude.some((selector: string) =>
        selector.includes('*'),
      ),
      false,
    );
    assert.deepEqual(
      migratedPnpmPolicy.trustPolicyExclude,
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.trustPolicyExclude,
    );
    assert.ok(
      fs.existsSync(
        path.join(workspaceDir, 'patches/effect-schema-error-type-id.patch'),
      ),
      'migrate-strict-effect must restore the generated Effect declaration patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`,
        ),
      ),
      'migrate-strict-effect must restore the generated TanStack Router patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
        ),
      ),
      'migrate-strict-effect must restore the generated Module Federation React bridge patch',
    );
    assert.ok(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      'migrate-strict-effect must restore the generated Drizzle declaration patch',
    );

    const migratedBaseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    assert.equal(
      migratedBaseTsConfig.compilerOptions.skipLibCheck,
      undefined,
      'migrate-strict-effect must remove generated skipLibCheck',
    );
    const migratedGitignore = fs.readFileSync(gitignorePath, 'utf-8');
    assert.match(
      migratedGitignore,
      /^\.mf\/$/mu,
      'migrate-strict-effect must ignore root Module Federation diagnostics',
    );
    assert.match(
      migratedGitignore,
      /^\*\*\/\.mf\/$/mu,
      'migrate-strict-effect must ignore per-app Module Federation diagnostics',
    );
    assert.match(
      migratedGitignore,
      /^dist-cloudflare\/$/mu,
      'migrate-strict-effect must ignore Cloudflare build output',
    );

    const shellTsConfig = readJson(
      workspaceDir,
      'apps/shell-super-app/tsconfig.json',
    );
    assert.deepEqual(shellTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
    ]);

    const catalogTsConfig = readJson(
      workspaceDir,
      'verticals/catalog/tsconfig.json',
    );
    assert.deepEqual(catalogTsConfig.include, [
      'src',
      'locales/**/*.json',
      'package.json',
      'shared',
      'api',
    ]);

    for (const sharedPackageDir of [
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ]) {
      assert.deepEqual(
        readJson(workspaceDir, `${sharedPackageDir}/tsconfig.json`),
        createSharedPackageTsConfig(sharedPackageDir),
      );
    }

    for (const appDir of ['apps/shell-super-app', 'verticals/catalog']) {
      const mfTypesTsConfig = readJson(
        workspaceDir,
        `${appDir}/tsconfig.mf-types.json`,
      );
      assert.equal(mfTypesTsConfig.extends, '../../tsconfig.base.json');

      const appEnv = fs.readFileSync(
        path.join(workspaceDir, appDir, 'src/modern-app-env.d.ts'),
        'utf-8',
      );
      assert.match(
        appEnv,
        /^\/\/\/ <reference types="@modern-js\/app-tools\/types" \/>/u,
      );
      assert.doesNotMatch(appEnv, /declare module '\*\.svg'/u);
      assert.doesNotMatch(appEnv, /declare module '\*\.css'/u);
    }

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    assert.equal(
      shellPackage.dependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    assert.match(
      shellPackage.scripts['cloudflare:build'],
      /MODERNJS_DEPLOY=cloudflare modern deploy --skip-build/u,
    );
    assert.doesNotMatch(
      shellPackage.scripts['cloudflare:build'],
      /--target dist && MODERNJS_DEPLOY=cloudflare modern deploy/u,
    );
    assert.doesNotMatch(
      shellPackage.scripts['cloudflare:build'],
      /verify-cloudflare-output/u,
    );
    assert.equal(
      shellPackage.scripts['cloudflare:deploy'],
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    );
    assertTargetIsolatedModernConfig(
      readText(workspaceDir, 'apps/shell-super-app/modern.config.ts'),
      'shell modern.config.ts',
    );

    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    assert.match(
      catalogPackage.scripts['cloudflare:build'],
      /MODERNJS_DEPLOY=cloudflare modern deploy --skip-build/u,
    );
    assert.doesNotMatch(
      catalogPackage.scripts['cloudflare:build'],
      /--target dist && MODERNJS_DEPLOY=cloudflare modern deploy/u,
    );
    assert.doesNotMatch(
      catalogPackage.scripts.build,
      /generate-node-backend-federation/u,
    );
    assert.doesNotMatch(
      catalogPackage.scripts['cloudflare:build'],
      /generate-node-backend-federation/u,
    );
    assert.doesNotMatch(
      catalogPackage.scripts['cloudflare:build'],
      /verify-cloudflare-output/u,
    );
    assert.equal(
      catalogPackage.scripts['cloudflare:deploy'],
      'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    );
    assertTargetIsolatedModernConfig(
      readText(workspaceDir, 'verticals/catalog/modern.config.ts'),
      'catalog modern.config.ts',
    );

    const migratedTopology = readJson(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const migratedCatalog = migratedTopology.verticals.find(
      (vertical: Record<string, unknown>) => vertical.id === 'catalog',
    );
    assert.equal(migratedCatalog.api.effect, undefined);
    assert.equal(migratedCatalog.api.runtime, 'effect');
    assert.equal(migratedCatalog.api.bff.strictEffectApproach, true);
    assert.equal(
      migratedCatalog.api.serverEntry,
      'verticals/catalog/api/index.ts',
    );
    assert.equal(migratedCatalog.api.contract.export, './api');
    assert.equal(
      migratedCatalog.api.contract.path,
      'verticals/catalog/shared/api.ts',
    );
    assert.equal(migratedCatalog.api.client.export, './api/client');
    assert.equal(
      migratedCatalog.api.client.path,
      'verticals/catalog/src/api/catalog-client.ts',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate-strict-effect removes unused Drizzle declaration patches', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-no-drizzle');

  try {
    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    fs.writeFileSync(
      pnpmWorkspaceFile,
      fs
        .readFileSync(pnpmWorkspaceFile, 'utf-8')
        .replace(
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch\n`,
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch\n  'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations.patch\n`,
        ),
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const pnpmWorkspace = fs.readFileSync(pnpmWorkspaceFile, 'utf-8');
    assert.doesNotMatch(
      pnpmWorkspace,
      new RegExp(
        `'drizzle-orm@${DRIZZLE_ORM_VERSION}': patches/drizzle-orm-ts7-strict-declarations\\.patch`,
        'u',
      ),
      'migrate-strict-effect must remove stale Drizzle patches when drizzle-orm is not installed',
    );
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'patches/drizzle-orm-ts7-strict-declarations.patch',
        ),
      ),
      false,
      'migrate-strict-effect must remove the generated Drizzle patch file when it is unused',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern mf-types validates real Module Federation config files', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-mf');

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'apps/shell-super-app'],
        workspaceDir,
      ),
      0,
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      1,
      'remote exposes must require a non-empty DTS archive',
    );

    const archivePath = path.join(
      workspaceDir,
      'verticals/catalog/dist/@mf-types.zip',
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, 'zip');

    assert.equal(
      await runUltramodernToolingCli(
        ['mf-types', 'verticals/catalog'],
        workspaceDir,
      ),
      0,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('compact UltraModern config maps component exposes to concrete DTS source files', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-exposes',
    },
    features: {
      tailwind: true,
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            name: 'shellSuperApp',
            exposes: [],
            verticalRefs: ['catalog'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          domain: 'catalog',
          moduleFederation: {
            role: 'remote',
            name: 'verticalCatalog',
            exposes: ['./ProductGrid', './Route', './Widget', './Custom'],
            exposePaths: {
              './Custom': './src/features/custom-surface.tsx',
            },
          },
          api: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog'],
          },
        },
      ],
    },
  });

  const catalog = apps.find(app => app.id === 'catalog');

  assert.deepEqual(catalog?.exposes, {
    './Custom': './src/features/custom-surface.tsx',
    './ProductGrid': './src/components/product-grid.tsx',
    './Route': './src/federation-entry.tsx',
    './Widget': './src/components/catalog-widget.tsx',
  });
  assert.deepEqual(
    (createAppMfTypesTsConfig(catalog!) as Record<string, unknown>).include,
    [
      'src/federation-entry.tsx',
      'src/components/product-grid.tsx',
      'src/components/catalog-widget.tsx',
      'src/features/custom-surface.tsx',
      'src/modern-app-env.d.ts',
    ],
    'custom expose order must keep the route entry first for MF DTS validation',
  );
});

test('multi-expose nested hosts emit distributed SSR service and fragment contracts', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: { packageScope: 'tractor-store' },
    features: { tailwind: true },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            name: 'shellSuperApp',
            exposes: [],
            verticalRefs: ['explore', 'decide', 'checkout'],
          },
        },
        {
          id: 'explore',
          kind: 'vertical',
          path: 'verticals/explore',
          domain: 'explore',
          moduleFederation: {
            role: 'remote',
            name: 'verticalExplore',
            exposes: ['./Header', './Recommendations', './Route'],
          },
        },
        {
          id: 'decide',
          kind: 'vertical',
          path: 'verticals/decide',
          domain: 'decide',
          moduleFederation: {
            role: 'remote',
            name: 'verticalDecide',
            exposes: ['./ProductPage', './Route'],
            verticalRefs: ['explore', 'checkout'],
          },
        },
        {
          id: 'checkout',
          kind: 'vertical',
          path: 'verticals/checkout',
          domain: 'checkout',
          moduleFederation: {
            role: 'remote',
            name: 'verticalCheckout',
            exposes: ['./AddToCart', './MiniCart', './Route'],
          },
        },
      ],
    },
  });
  const shell = apps.find(app => app.id === 'shell-super-app')!;
  const decide = apps.find(app => app.id === 'decide')!;
  const checkout = apps.find(app => app.id === 'checkout')!;
  const remotes = apps.filter(app => app.kind === 'vertical');
  const shellModernConfig = createAppModernConfig(
    'tractor-store',
    shell,
    remotes,
  );
  const decideModernConfig = createAppModernConfig(
    'tractor-store',
    decide,
    remotes,
  );

  for (const contract of [
    ["boundaryId: 'verticalExplore'", "expose: './Header'"],
    ["boundaryId: 'verticalExplore'", "expose: './Recommendations'"],
    ["boundaryId: 'verticalDecide'", "expose: './ProductPage'"],
    ["boundaryId: 'verticalCheckout'", "expose: './AddToCart'"],
    ["boundaryId: 'verticalCheckout'", "expose: './MiniCart'"],
  ]) {
    for (const marker of contract) {
      assert.match(shellModernConfig, new RegExp(marker.replace('.', '\\.')));
    }
  }
  assert.doesNotMatch(shellModernConfig, /expose: '\.\/Route'/u);
  assert.match(decideModernConfig, /VERTICAL_EXPLORE_WORKER/u);
  assert.match(decideModernConfig, /VERTICAL_CHECKOUT_WORKER/u);
  assert.match(decideModernConfig, /expose: '\.\/Recommendations'/u);
  assert.match(decideModernConfig, /expose: '\.\/AddToCart'/u);
  assert.doesNotMatch(decideModernConfig, /VERTICAL_DECIDE_WORKER/u);

  const addToCartFragment = createRemoteExposeFragmentPage(
    checkout,
    './AddToCart',
  );
  assert.match(
    addToCartFragment,
    /useDistributedSsrFragmentProps<ComponentProps<typeof AddToCart>>/u,
  );
  assert.match(
    addToCartFragment,
    /data-modern-distributed-ssr-marker="start"/u,
  );
  assert.match(addToCartFragment, /data-modern-distributed-ssr-marker="end"/u);
  assert.match(addToCartFragment, /<AddToCart \{\.\.\.props\} \/>/u);

  const browserRegistry = createFederatedComponentsRegistry(
    'tractor-store',
    decide,
    remotes,
  );
  const workerRegistry = createFederatedComponentsRegistry(
    'tractor-store',
    decide,
    remotes,
    true,
  );
  assert.match(browserRegistry, /import\('explore\/Recommendations'\)/u);
  assert.match(browserRegistry, /import\('checkout\/AddToCart'\)/u);
  assert.match(
    browserRegistry,
    /type AddToCartProps = RemoteComponentProps<typeof AddToCartComponent>/u,
  );
  assert.match(
    browserRegistry,
    /createLazyComponent<\s*RemoteComponentModule<AddToCartProps>,\s*'default'\s*>/u,
  );
  assert.match(
    browserRegistry,
    /interface RemoteComponentModule<Props extends object> \{\s*default: FunctionComponent<Props>;/u,
  );
  assert.match(
    browserRegistry,
    /Component extends ComponentType<infer Props>[\s\S]*Record<string, never>/u,
  );
  assert.ok(
    browserRegistry.indexOf('AddToCart:') <
      browserRegistry.indexOf('Recommendations:'),
    'browser registry component keys must be sorted',
  );
  assert.match(workerRegistry, /fragmentProps=\{props\}/u);
  assert.match(workerRegistry, /remote="checkout"/u);
  assert.ok(
    workerRegistry.indexOf('AddToCart:') <
      workerRegistry.indexOf('Recommendations:'),
    'worker registry component keys must be sorted',
  );
  assert.doesNotMatch(workerRegistry, /@module-federation|import\('checkout/u);

  const decideModuleFederationConfig = createRemoteModuleFederationConfig(
    'tractor-store',
    decide,
    remotes,
  );
  assert.equal(
    decideModuleFederationConfig.match(
      /from '@modern-js\/app-tools\/config';/gu,
    )?.length,
    1,
    'nested remotes must consolidate app-tools config imports',
  );
  assert.match(
    decideModuleFederationConfig,
    /import \{ getBuildConfigEnvironment, resolveEffectTsgoCompiler \} from '@modern-js\/app-tools\/config';/u,
  );
});

test('generated app tsconfig uses sibling-relative vertical references', () => {
  const apps = workspaceAppsFromToolingConfig({
    schemaVersion: 1,
    source: 'compact',
    sourcePath: '.modernjs/ultramodern.json',
    workspace: {
      packageScope: 'tooling-references',
    },
    features: {
      tailwind: true,
    },
    topology: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          moduleFederation: {
            role: 'host',
            verticalRefs: ['catalog', 'checkout'],
          },
        },
        {
          id: 'catalog',
          kind: 'vertical',
          path: 'verticals/catalog',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
          },
          api: {
            stem: 'catalog',
            prefix: '/catalog-api',
            consumedBy: ['shell-super-app', 'catalog', 'checkout'],
          },
        },
        {
          id: 'checkout',
          kind: 'vertical',
          path: 'verticals/checkout',
          moduleFederation: {
            role: 'remote',
            exposes: ['./Route'],
            verticalRefs: ['catalog'],
          },
          api: {
            stem: 'checkout',
            prefix: '/checkout-api',
            consumedBy: ['shell-super-app', 'checkout'],
          },
        },
      ],
    },
  });
  const checkout = apps.find(app => app.id === 'checkout');
  assert.deepEqual(
    (
      createAppTsConfig(
        checkout!,
        apps.filter(app => app.kind !== 'shell'),
      ) as Record<string, unknown>
    ).references,
    [
      { path: '../../packages/shared-contracts' },
      { path: '../../packages/shared-design-tokens' },
      { path: '../catalog' },
    ],
  );
});

function hashWorkspaceTree(root: string): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute);
        tree[relative] = fs.readFileSync(absolute).toString('base64');
      }
    }
  };
  walk(root);
  return tree;
}

function captureStdout<T>(run: () => T): { result: T; output: string } {
  const original = process.stdout.write.bind(process.stdout);
  let output = '';
  (process.stdout as NodeJS.WriteStream).write = ((chunk: unknown) => {
    output += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = run();
    return { result, output };
  } finally {
    process.stdout.write = original;
  }
}

test('UltraModern migrate synthesizes the compact config from legacy 3.2 metadata', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-legacy-trio');

  try {
    fs.rmSync(path.join(workspaceDir, '.modernjs/ultramodern.json'));

    writeJson(workspaceDir, retiredContractPath, {
      schemaVersion: 1,
      profile: 'cloudflare-ssr-mf-effect-v1',
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          path: 'apps/shell-super-app',
          package: '@tooling-legacy-trio/shell-super-app',
          styling: { tailwind: true },
          moduleFederation: {
            name: 'shellSuperApp',
            role: 'host',
            verticalRefs: [],
          },
          i18n: { namespace: 'shell' },
        },
      ],
    });
    writeJson(workspaceDir, retiredPackageSourcePath, {
      schemaVersion: 1,
      strategy: 'workspace',
      modernPackages: {
        specifier: 'workspace:*',
      },
    });
    writeJson(workspaceDir, 'topology/local-overlays/development.json', {
      ports: { 'shell-super-app': 8080 },
    });

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.modernjs/ultramodern.json')),
      true,
    );

    const config = readUltramodernConfig(workspaceDir);
    assert.equal(config.source, 'compact');
    assert.equal(config.packageSource?.aliasScope, undefined);
    assert.equal(config.packageSource?.aliasPackageNamePrefix, undefined);
    assert.equal(config.packageSource?.modernPackageVersion, 'workspace:*');

    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(compactConfig.packageSource.aliasScope, undefined);
    assert.equal(compactConfig.packageSource.aliasPackageNamePrefix, undefined);
    assert.equal(compactConfig.topology.apps[0].moduleFederation.role, 'host');
    assert.equal(compactConfig.topology.apps[0].port, 8080);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate --dry-run leaves the workspace byte-identical', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-dry-run');

  try {
    const before = hashWorkspaceTree(workspaceDir);

    const { result, output } = captureStdout(() =>
      runUltramodernToolingCli(
        ['migrate-strict-effect', '--dry-run'],
        workspaceDir,
      ),
    );
    assert.equal(await result, 0);

    const after = hashWorkspaceTree(workspaceDir);
    assert.deepEqual(after, before);
    assert.match(output, /\[dry-run\] would write/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate keeps generated gitignore rules idempotent', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-gitignore');

  try {
    for (let run = 0; run < 2; run += 1) {
      assert.equal(
        await runUltramodernToolingCli(
          ['migrate-strict-effect', '--skip-install'],
          workspaceDir,
        ),
        0,
      );
    }

    const gitignore = readText(workspaceDir, '.gitignore');
    for (const rule of [
      '.output/',
      '**/.output/',
      '.modern-js/',
      '**/.modern-js/',
    ]) {
      const occurrences = gitignore
        .split(/\r?\n/u)
        .filter(line => line === rule).length;
      assert.equal(occurrences, 1, `${rule} must appear exactly once`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate rejects duplicate pnpm mappings without writes', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-yaml-dedupe');

  try {
    const pnpmWorkspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
    const unquotedLine = `  effect@${EFFECT_VERSION}: patches/effect-schema-error-type-id.patch`;
    fs.writeFileSync(
      pnpmWorkspaceFile,
      fs
        .readFileSync(pnpmWorkspaceFile, 'utf-8')
        .replace(
          `  'effect@${EFFECT_VERSION}': patches/effect-schema-error-type-id.patch`,
          `${unquotedLine}\n${unquotedLine}`,
        ),
      'utf-8',
    );
    const duplicatePolicy = fs.readFileSync(pnpmWorkspaceFile, 'utf-8');
    const rootPackageBefore = readText(workspaceDir, 'package.json');

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      1,
    );

    assert.equal(fs.readFileSync(pnpmWorkspaceFile, 'utf-8'), duplicatePolicy);
    assert.equal(readText(workspaceDir, 'package.json'), rootPackageBefore);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UltraModern migrate syncs oxfmt ignorePatterns and tolerates unparseable configs', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace('tooling-oxfmt');

  try {
    const oxfmtPath = path.join(workspaceDir, 'oxfmt.config.ts');
    fs.writeFileSync(
      oxfmtPath,
      `import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: [
    '.modernjs',
    '**/modern-tanstack/**',
  ],
  singleQuote: true,
});
`,
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const patched = fs.readFileSync(oxfmtPath, 'utf-8');
    for (const pattern of [
      '.modernjs',
      '.output',
      '**/modern-tanstack/**',
      '**/routeTree.gen.*',
    ]) {
      const occurrences = patched
        .split(/\r?\n/u)
        .filter(line => line.includes(`'${pattern}'`)).length;
      assert.equal(occurrences, 1, `${pattern} must appear exactly once`);
    }

    const afterFirst = patched;
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(oxfmtPath, 'utf-8'),
      afterFirst,
      'oxfmt ignorePatterns sync must be idempotent',
    );

    const unparseable = `import { defineConfig } from 'oxfmt';
import extra from './extra-ignores';

export default defineConfig({
  ignorePatterns: [...extra],
  singleQuote: true,
});
`;
    fs.writeFileSync(oxfmtPath, unparseable, 'utf-8');
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.equal(
      fs.readFileSync(oxfmtPath, 'utf-8'),
      unparseable,
      'unparseable ignorePatterns must be left byte-unchanged',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
