import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { snapshotWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');
const createBinPath = path.join(packageRoot, 'bin/run.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
  ULTRAMODERN_CREATE_BIN: createBinPath,
};

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function read(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(read(workspaceDir, relativePath));
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

function exists(workspaceDir: string, relativePath: string) {
  return fs.existsSync(path.join(workspaceDir, relativePath));
}

function runGeneratedWorkspaceCheck(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function runGeneratedApiCheck(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/check-ultramodern-api-boundaries.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function runGeneratedCloudflareProof(workspaceDir: string, outPath: string) {
  return spawnSync(
    process.execPath,
    ['scripts/proof-cloudflare-version.mts', '--out', outPath],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function commandOutput(result: ReturnType<typeof runGeneratedWorkspaceCheck>) {
  return `${result.stdout}\n${result.stderr}`;
}

function appById(apps: any[], id: string): any {
  const app = apps.find(candidate => candidate.id === id);
  assert.ok(app, `Expected app ${id}`);
  return app;
}

function assertModuleFederationWarningHygiene(
  modernConfig: string,
  label: string,
) {
  assert.match(
    modernConfig,
    /const moduleFederationDevServerOrigin =\s*envValue\('ULTRAMODERN_MF_DEV_ORIGIN'\) \|\| 'http:\/\/localhost:3020';/,
    `${label} must default MF dev CORS to the local shell origin, with an explicit trusted-origin override`,
  );
  assert.match(
    modernConfig,
    /splitChunks:\s*\{\s*chunks:\s*'async',\s*\},/,
    `${label} must set stream-SSR-compatible splitChunks defaults before MF mutates the bundler chain`,
  );
  assert.match(
    modernConfig,
    /const buildTarget = cloudflareDeployEnabled \? 'cloudflare' : 'web';/,
    `${label} must derive mutable build paths from the active target`,
  );
  assert.match(
    modernConfig,
    /const buildOutputRoot = cloudflareDeployEnabled \? 'dist-cloudflare' : 'dist';/,
    `${label} must isolate normal and Cloudflare output roots`,
  );
  assert.match(
    modernConfig,
    /const buildTempDirectory = `node_modules\/\.modern-js-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must isolate normal and Cloudflare Modern temp directories`,
  );
  assert.match(
    modernConfig,
    /const buildCacheDirectory = `node_modules\/\.cache\/rspack-\$\{appId\}-\$\{buildTarget\}`;/,
    `${label} must provide a per-app/per-target Rspack cache base directory`,
  );
  assert.match(
    modernConfig,
    /root: buildOutputRoot,/,
    `${label} must pass the per-target output root to the builder`,
  );
  assert.match(
    modernConfig,
    /tempDir: buildTempDirectory,/,
    `${label} must pass the per-target Modern temp directory to the builder`,
  );
  assert.match(
    modernConfig,
    /cacheDigest: \[appId, buildTarget\],/,
    `${label} must include the build target in the Rspack cache digest`,
  );
  assert.match(
    modernConfig,
    /cacheDirectory: buildCacheDirectory,/,
    `${label} must pass the per-target Rspack cache base directory to the builder`,
  );
  assert.match(
    modernConfig,
    /devServer:\s*\{\s*headers:\s*\{\s*'Access-Control-Allow-Headers':\s*'Accept, Authorization, Content-Type, X-Requested-With',\s*'Access-Control-Allow-Methods':\s*'GET, HEAD, OPTIONS',\s*'Access-Control-Allow-Origin':\s*moduleFederationDevServerOrigin,\s*\},\s*\},/,
    `${label} must provide explicit devServer headers so MF does not inject wildcard CORS defaults`,
  );
  assert.doesNotMatch(
    modernConfig,
    /'Access-Control-Allow-(?:Headers|Origin)':\s*'\*'/,
    `${label} must not emit wildcard MF dev CORS headers`,
  );
  assert.doesNotMatch(
    modernConfig,
    /devServer:\s*\{\s*headers:\s*\{\s*\}\s*\}/,
    `${label} must not leave devServer.headers empty`,
  );
  assert.doesNotMatch(
    modernConfig,
    /splitChunks:\s*false/,
    `${label} must not disable splitChunks to hide stream SSR warnings`,
  );
}

function assertGeneratedVerticalFiles(workspaceDir: string, id: string) {
  for (const relativePath of [
    `verticals/${id}/api/effect-api.ts`,
    `verticals/${id}/api/index.ts`,
    `verticals/${id}/backend-federation.config.ts`,
    `verticals/${id}/locales/cs/${id}.json`,
    `verticals/${id}/locales/cs/translation.json`,
    `verticals/${id}/locales/en/${id}.json`,
    `verticals/${id}/locales/en/translation.json`,
    `verticals/${id}/shared/api.ts`,
    `verticals/${id}/src/components/${id}-widget.tsx`,
    `verticals/${id}/src/api/${id}-client.ts`,
    `verticals/${id}/src/federation-entry.tsx`,
    `verticals/${id}/src/routes/[lang]/page.tsx`,
    `verticals/${id}/src/routes/ultramodern-route-metadata.ts`,
  ]) {
    assert.equal(exists(workspaceDir, relativePath), true, relativePath);
  }
}

function assertIntegratedVertical(
  workspaceDir: string,
  id: 'catalog' | 'checkout',
  port: number,
) {
  const scope = 'integration-workspace';
  const packageName = `@${scope}/${id}`;
  const mfName = `vertical${id[0].toUpperCase()}${id.slice(1)}`;
  const manifestUrl = `http://localhost:${port}/mf-manifest.json`;
  const backendFederationName = `${mfName}Backend`;
  const backendManifestUrl = `http://localhost:${port}/backend-mf-manifest.json`;
  const backendContainerEntry = `http://localhost:${port}/backendRemoteEntry.mjs`;
  const apiUrl = `http://localhost:${port}/${id}-api`;
  const topology = readJson(workspaceDir, 'topology/reference-topology.json');
  const ownership = readJson(workspaceDir, 'topology/ownership.json');
  const overlay = readJson(
    workspaceDir,
    'topology/local-overlays/development.json',
  );
  const ultramodernConfig = readJson(
    workspaceDir,
    '.modernjs/ultramodern.json',
  );
  const shellPackage = readJson(
    workspaceDir,
    'apps/shell-super-app/package.json',
  );
  const verticalPackage = readJson(
    workspaceDir,
    `verticals/${id}/package.json`,
  );
  const topologyEntry = appById(topology.verticals, id);
  const ownershipEntry = appById(ownership.owners, id);
  const configEntry = appById(ultramodernConfig.topology.apps, id);
  const moduleFederationEntry = appById(
    ultramodernConfig.moduleFederation.apps,
    id,
  );
  const backendFederationEntry = appById(
    ultramodernConfig.backendFederation.apps,
    id,
  );

  assertGeneratedVerticalFiles(workspaceDir, id);
  assert.deepEqual(topologyEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(topologyEntry.moduleFederation.name, mfName);
  assert.equal(topologyEntry.moduleFederation.manifestUrl, manifestUrl);
  assert.equal(topologyEntry.backendFederation.role, 'microvertical-server');
  assert.equal(topologyEntry.backendFederation.name, backendFederationName);
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.ui.manifestEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_MF_MANIFEST`,
  );
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.ui.manifestUrl,
    manifestUrl,
  );
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.api.readiness,
    `/${id}-api/${id}/readiness`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.manifestEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_BACKEND_MF_MANIFEST`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.kind,
    'node-mf-runtime',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.remoteType,
    'module',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.publicUrlEnv,
    `ULTRAMODERN_PUBLIC_URL_${id.replace(/-/g, '_').toUpperCase()}`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .serviceBinding,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .serviceBindingEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER_BINDING`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .dispatchWorkerNameEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER_NAME`,
  );
  assert.equal(topologyEntry.backendFederation.runtimeFramework, 'effect');
  assert.equal(topologyEntry.backendFederation.strictEffectApproach, true);
  assert.equal(
    topologyEntry.backendFederation.exposes['./effect-api'].runtime,
    `verticals/${id}/api/index.ts`,
  );
  assert.equal(
    topologyEntry.backendFederation.exposes['./effect-api'].readiness,
    `/${id}-api/${id}/readiness`,
  );
  assert.equal(
    topologyEntry.backendFederation.compatibility.contractVersion,
    'microvertical-server-effect-v1',
  );
  assert.equal(topologyEntry.backendFederation.manifestUrl, undefined);
  assert.equal(topologyEntry.backendFederation.containerEntry, undefined);
  assert.equal(topologyEntry.package, packageName);
  assert.equal(topologyEntry.path, `verticals/${id}`);
  assert.equal(topologyEntry.api.bff.prefix, `/${id}-api`);
  assert.equal(topologyEntry.api.serverEntry, `verticals/${id}/api/index.ts`);
  assert.equal(ownershipEntry.package, packageName);
  assert.equal(ownershipEntry.path, `verticals/${id}`);
  assert.equal(ownershipEntry.ownership.team, 'super-app-platform');
  assert.equal(overlay.ports[id], port);
  assert.equal(overlay.manifests[id], manifestUrl);
  assert.equal(overlay.serverExecution[id].apiBaseUrl, apiUrl);
  assert.equal(
    overlay.serverExecution[id].node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    overlay.serverExecution[id].node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    overlay.serverExecution[id].cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(
    overlay.serverExecution[id].cloudflare.workerDispatch.serviceBinding,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER`,
  );
  assert.equal(overlay.apis[id], apiUrl);

  assert.equal(configEntry.package, packageName);
  assert.equal(configEntry.path, `verticals/${id}`);
  assert.equal(configEntry.kind, 'vertical');
  assert.equal(configEntry.moduleFederation.ssr, true);
  assert.deepEqual(configEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(configEntry.moduleFederation.name, mfName);
  assert.equal(configEntry.backendFederation.role, 'microvertical-server');
  assert.equal(configEntry.backendFederation.name, backendFederationName);
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.remoteType,
    'module',
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(configEntry.backendFederation.runtimeFramework, 'effect');
  assert.equal(configEntry.backendFederation.strictEffectApproach, true);
  assert.equal(configEntry.api.prefix, `/${id}-api`);
  assert.equal(moduleFederationEntry.role, 'remote');
  assert.equal(moduleFederationEntry.name, mfName);
  assert.deepEqual(moduleFederationEntry.exposes, ['./Route', './Widget']);
  assert.equal(backendFederationEntry.role, 'microvertical-server');
  assert.equal(backendFederationEntry.name, backendFederationName);
  assert.equal(
    backendFederationEntry.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.node.remoteType,
    'module',
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(backendFederationEntry.runtimeFramework, 'effect');
  assert.equal(backendFederationEntry.strictEffectApproach, true);
  assert.equal(
    backendFederationEntry.contractVersion,
    'microvertical-server-effect-v1',
  );

  assert.equal(verticalPackage.name, packageName);
  assert.equal(
    verticalPackage.type,
    undefined,
    'generated MF vertical app packages must stay CJS-compatible',
  );
  assert.equal(
    verticalPackage.exports['./Route'],
    './src/federation-entry.tsx',
  );
  assert.equal(
    verticalPackage.exports['./Widget'],
    `./src/components/${id}-widget.tsx`,
  );
  assert.equal(verticalPackage.exports['./api'], './shared/api.ts');
  const backendFederationConfig = read(
    workspaceDir,
    `verticals/${id}/backend-federation.config.ts`,
  );
  assert.match(
    backendFederationConfig,
    /filename:\s*'backendRemoteEntry\.mjs'/,
  );
  assert.match(backendFederationConfig, /name:\s*'vertical[A-Z][a-z]+Backend'/);
  assert.match(
    backendFederationConfig,
    /'\.\/effect-api':\s*'\.\/api\/effect-api\.ts'/,
  );
  assert.match(backendFederationConfig, /'@module-federation\/runtime':\s*\{/);
  const backendEffectApi = read(
    workspaceDir,
    `verticals/${id}/api/effect-api.ts`,
  );
  assert.match(backendEffectApi, /strictEffectApproach:\s*true/);
  assert.match(
    backendEffectApi,
    /contractVersion:\s*'microvertical-server-effect-v1'/,
  );
  assert.match(
    backendEffectApi,
    /nodeAdapterVersion:\s*'backend-mf-effect-v1'/,
  );
  assert.match(
    backendEffectApi,
    /export \{ default, default as runtime \} from '\.\/index\.ts'/,
  );
  assert.equal(
    verticalPackage.dependencies['@modern-js/plugin-bff'],
    'workspace:*',
  );
  assert.equal(shellPackage.dependencies['react-router'], '7.18.1');
  assert.equal(verticalPackage.dependencies['react-router'], '7.18.1');
  assert.equal(shellPackage.dependencies['react-router-dom'], undefined);
  assert.equal(verticalPackage.dependencies['react-router-dom'], undefined);
  assert.equal(shellPackage.dependencies[packageName], 'workspace:*');
  assert.equal(
    shellPackage['zephyr:dependencies'][id],
    `${packageName}@workspace:*`,
  );
}

test('workspace and MicroVertical integration stays coherent across public API and CLI additions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'integration-workspace');

  try {
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'integration-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    assert.equal(workspaceResult.operation, 'workspace');
    assert.equal(workspaceResult.packageSource.strategy, 'workspace');

    const publicApiResult = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.deepEqual(publicApiResult.assignedPorts, { catalog: 4101 });

    const cliResult = runCli(workspaceDir, ['--vertical-name', 'checkout']);
    assert.equal(cliResult.status, 0, cliResult.stderr);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const rootPackage = readJson(workspaceDir, 'package.json');
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const shellModernConfig = read(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    const catalogModernConfig = read(
      workspaceDir,
      'verticals/catalog/modern.config.ts',
    );
    const checkoutModernConfig = read(
      workspaceDir,
      'verticals/checkout/modern.config.ts',
    );
    const packageSource = ultramodernConfig.packageSource;

    assert.deepEqual(topology.shell.verticalRefs, ['catalog', 'checkout']);
    assert.deepEqual(
      fs.readdirSync(path.join(workspaceDir, '.modernjs')).sort(),
      ['ultramodern.json'],
    );
    assert.match(shellModernConfig, /mode:\s*'string'/);
    assert.match(shellModernConfig, /moduleFederationAppSSR:\s*true/);
    assert.match(shellModernConfig, /services:\s*\[/);
    assert.match(
      shellModernConfig,
      /envValue\('VERTICAL_CATALOG_WORKER_BINDING'\)\s*\?\?\s*'VERTICAL_CATALOG_WORKER'/,
    );
    assert.match(shellModernConfig, /prefix:\s*'\/catalog-api'/);
    assert.match(
      shellModernConfig,
      /envValue\('VERTICAL_CATALOG_WORKER_NAME'\)\s*\?\?\s*'integration-workspace-catalog'/,
    );
    assert.match(
      shellModernConfig,
      /envValue\('VERTICAL_CHECKOUT_WORKER_BINDING'\)\s*\?\?\s*'VERTICAL_CHECKOUT_WORKER'/,
    );
    assert.match(shellModernConfig, /prefix:\s*'\/checkout-api'/);
    assert.match(
      shellModernConfig,
      /envValue\('VERTICAL_CHECKOUT_WORKER_NAME'\)\s*\?\?\s*'integration-workspace-checkout'/,
    );
    assert.doesNotMatch(catalogModernConfig, /services:\s*\[/);
    assert.doesNotMatch(checkoutModernConfig, /services:\s*\[/);
    assertModuleFederationWarningHygiene(
      shellModernConfig,
      'generated shell Modern config',
    );
    assertModuleFederationWarningHygiene(
      catalogModernConfig,
      'generated catalog Modern config',
    );
    assertModuleFederationWarningHygiene(
      checkoutModernConfig,
      'generated checkout Modern config',
    );
    assert.match(
      shellModernConfig,
      /'@modern-js\/plugin-i18n\/runtime':\s*'@modern-js\/plugin-i18n\/runtime\/no-react-i18next'/,
    );
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'shell-super-app')
        .moduleFederation.ssr,
      true,
    );
    assert.deepEqual(
      topology.shell.moduleFederation.remotes.map((remote: any) => remote.id),
      ['catalog', 'checkout'],
    );
    assert.deepEqual(Object.keys(overlay.ports).sort(), [
      'catalog',
      'checkout',
      'shell-super-app',
    ]);
    assert.deepEqual(
      ultramodernConfig.topology.apps.map((app: any) => app.id),
      ['shell-super-app', 'catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(ultramodernConfig.topology.apps, 'shell-super-app')
        .moduleFederation.verticalRefs,
      ['catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(
        ultramodernConfig.topology.apps,
        'shell-super-app',
      ).moduleFederation.remotes.map((remote: any) => remote.id),
      ['catalog', 'checkout'],
    );
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.equal(
      rootPackage.modernjs.packageSource.config,
      './.modernjs/ultramodern.json',
    );
    assert.equal(rootPackage.type, 'module');
    assert.equal(
      shellPackage.type,
      undefined,
      'generated MF shell app package must stay CJS-compatible',
    );
    assert.equal(
      rootPackage.scripts['dev:catalog'],
      'pnpm --filter @integration-workspace/catalog dev',
    );
    assert.equal(
      rootPackage.scripts['dev:checkout'],
      'pnpm --filter @integration-workspace/checkout dev',
    );
    assert.match(rootPackage.scripts.dev, /@integration-workspace\/catalog/);
    assert.match(rootPackage.scripts.dev, /@integration-workspace\/checkout/);
    assert.match(rootPackage.scripts.build, /verticals\/\*/);
    assert.match(rootPackage.scripts.check, /contract:check/);
    assert.match(rootPackage.scripts.check, /node:proof/);
    assert.equal(
      rootPackage.scripts['node:proof'],
      'pnpm node:backend-federation:generate && node ./scripts/proof-node-backend-federation.mts',
    );
    assert.equal(
      rootPackage.scripts['node:backend-federation:generate'],
      'node ./scripts/generate-node-backend-federation.mts',
    );
    assert.equal(
      rootPackage.scripts['zerops:materialize'],
      'node ./scripts/materialize-zerops-runtime.mjs',
    );
    const zeropsYaml = read(workspaceDir, 'zerops.yaml');
    assert.match(zeropsYaml, /zerops:/);
    assert.match(zeropsYaml, /setup: 'shell-super-app'/);
    assert.match(zeropsYaml, /base: 'nodejs@26'/);
    assert.match(
      zeropsYaml,
      /start: cd '\.zerops\/runtime\/shell-super-app' && npm run serve/,
    );
    assert.match(zeropsYaml, /setup: 'catalog'/);
    assert.match(zeropsYaml, /setup: 'checkout'/);
    assert.match(
      zeropsYaml,
      /pnpm run zerops:materialize -- --app 'catalog' --package '@integration-workspace\/catalog' --package-dir 'verticals\/catalog'/,
    );
    assert.match(zeropsYaml, /path: '\/catalog-api\/catalog\/readiness'/);
    assert.match(
      zeropsYaml,
      /pnpm run zerops:materialize -- --app 'checkout' --package '@integration-workspace\/checkout' --package-dir 'verticals\/checkout'/,
    );
    assert.match(zeropsYaml, /path: '\/checkout-api\/checkout\/readiness'/);
    const zeropsMaterializer = read(
      workspaceDir,
      'scripts/materialize-zerops-runtime.mjs',
    );
    assert.match(zeropsMaterializer, /MODERNJS_DEPLOY: 'node'/);
    assert.match(zeropsMaterializer, /'deploy',\s*'--skip-build'/);
    assert.match(zeropsMaterializer, /normalizeRuntimePackageDependencies/);
    assert.match(zeropsMaterializer, /officialPackageName/);
    assert.match(zeropsMaterializer, /installRuntimeDependencies/);
    assert.equal(
      rootPackage.devDependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    assert.throws(() =>
      read(workspaceDir, 'scripts/generate-node-backend-federation.mjs'),
    );
    assert.throws(() =>
      read(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
    );
    assert.match(
      read(workspaceDir, 'scripts/generate-node-backend-federation.mts'),
      /backend-federation-generate/,
    );
    assert.match(
      read(workspaceDir, 'scripts/proof-node-backend-federation.mts'),
      /backend-federation-proof/,
    );
    const shellModernConfigSource = read(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    assert.match(shellModernConfigSource, /services:\s*\[/);
    assert.match(shellModernConfigSource, /VERTICAL_CATALOG_WORKER_BINDING/);
    assert.match(shellModernConfigSource, /VERTICAL_CHECKOUT_WORKER_BINDING/);
    const catalogBackendFederationFacade = read(
      workspaceDir,
      'verticals/catalog/api/backend-federation.ts',
    );
    assert.match(catalogBackendFederationFacade, /backendFederationContract/);
    assert.match(catalogBackendFederationFacade, /node-mf-runtime/);
    assert.match(catalogBackendFederationFacade, /catalogApiContract/);
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(packageSource.aliasScope, undefined);
    assert.equal(packageSource.aliasPackageNamePrefix, undefined);
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );

    assertIntegratedVertical(workspaceDir, 'catalog', 4101);
    assertIntegratedVertical(workspaceDir, 'checkout', 4102);
    assert.match(
      read(workspaceDir, 'apps/shell-super-app/src/api/vertical-clients.ts'),
      /createCheckoutClient/,
    );
    assert.match(
      read(
        workspaceDir,
        'apps/shell-super-app/src/routes/vertical-components.tsx',
      ),
      /checkout\/Widget/,
    );

    const afterTwoVerticals = snapshotWorkspace(workspaceDir);
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'catalog',
          modernVersion: '3.2.1',
        }),
      /Refusing to overwrite existing path: verticals\/catalog/,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), afterTwoVerticals);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated Cloudflare proof records backend server execution metadata offline', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-proof-'));
  const workspaceDir = path.join(tempRoot, 'proof-workspace');
  const proofOut = '.codex/reports/cloudflare-version-proof/test-proof.json';

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'proof-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const shellConfig = appById(
      ultramodernConfig.topology.apps,
      'shell-super-app',
    );
    shellConfig.deploy ??= {};
    shellConfig.deploy.cloudflare ??= {};
    shellConfig.deploy.cloudflare.jsonSmokeChecks = [
      {
        id: 'catalog-domain-smoke',
        route: '/catalog-api/catalog/CL-08-GR',
        expect: {
          name: 'Holland Hamster',
          price: 7750,
          sku: 'CL-08-GR',
        },
      },
      {
        body: {
          quantity: 2,
          sku: 'CL-08-GR',
        },
        expect: {
          'item.lineTotal': 15500,
          'item.quantity': 2,
          'item.sku': 'CL-08-GR',
        },
        id: 'checkout-post-smoke',
        method: 'POST',
        route: '/checkout-api/checkout',
      },
    ];
    writeJson(workspaceDir, '.modernjs/ultramodern.json', ultramodernConfig);

    const proofResult = runGeneratedCloudflareProof(workspaceDir, proofOut);
    assert.equal(proofResult.status, 0, commandOutput(proofResult));

    const proof = readJson(workspaceDir, proofOut);
    assert.equal(proof.status, 'skipped');
    const catalogTarget = proof.proofTargets.find(
      (target: any) => target.appId === 'catalog',
    );
    assert.ok(catalogTarget, 'catalog proof target must be present');
    assert.equal(
      catalogTarget.cloudflare.routes.apiReadiness,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(catalogTarget.backendFederation.role, 'microvertical-server');
    assert.equal(
      catalogTarget.backendFederation.versionBoundary.invariant,
      'web-and-api-same-build',
    );
    assert.equal(
      catalogTarget.backendFederation.versionBoundary.ui.marker,
      catalogTarget.backendFederation.versionBoundary.api.marker,
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.kind,
      'cloudflare-worker-snapshot',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.ssr
        .effectBffBundle,
      '.output/worker/__modern_bff_effect.js',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.zephyr
        .snapshotIdEnv,
      'ZEPHYR_CATALOG_SNAPSHOT_ID',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare
        .workerDispatch.serviceBinding,
      'VERTICAL_CATALOG_WORKER',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare
        .workerDispatch.serviceBindingEnv,
      'VERTICAL_CATALOG_WORKER_BINDING',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.kind,
      'node-mf-runtime',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.adapterVersion,
      'backend-mf-effect-v1',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.runtimePackage,
      '@modern-js/plugin-bff/effect',
    );
    assert.equal(catalogTarget.backendFederation.manifestUrl, undefined);
    assert.equal(catalogTarget.backendFederation.containerEntry, undefined);
    assert.equal(
      catalogTarget.serverExecution.versionBoundary,
      'web-and-api-same-build',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.apiReadiness,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.workerDispatch
        .dispatchNamespaceEnv,
      'VERTICAL_CATALOG_DISPATCH_NAMESPACE',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.zephyr.versionIdEnv,
      'ZEPHYR_CATALOG_VERSION_ID',
    );
    assert.equal(
      catalogTarget.serverExecution.node.manifestUrl,
      'http://localhost:4101/backend-mf-manifest.json',
    );

    const shellTarget = proof.proofTargets.find(
      (target: any) => target.appId === 'shell-super-app',
    );
    assert.ok(shellTarget, 'shell proof target must be present');
    assert.deepEqual(
      shellTarget.cloudflare.serviceBindings.map((binding: any) => ({
        appId: binding.appId,
        binding: binding.binding,
        interface: binding.interface,
        route: binding.route,
        service: binding.service,
      })),
      [
        {
          appId: 'catalog',
          binding: 'VERTICAL_CATALOG_WORKER',
          interface: 'fetch',
          route: '/catalog-api/catalog/readiness',
          service: 'proof-workspace-catalog',
        },
      ],
    );
    assert.deepEqual(shellTarget.cloudflare.jsonSmokeChecks, [
      {
        id: 'catalog-domain-smoke',
        route: '/catalog-api/catalog/CL-08-GR',
        expect: {
          name: 'Holland Hamster',
          price: 7750,
          sku: 'CL-08-GR',
        },
      },
      {
        body: {
          quantity: 2,
          sku: 'CL-08-GR',
        },
        expect: {
          'item.lineTotal': 15500,
          'item.quantity': 2,
          'item.sku': 'CL-08-GR',
        },
        id: 'checkout-post-smoke',
        method: 'POST',
        route: '/checkout-api/checkout',
      },
    ]);
    assert.equal(shellTarget.backendFederation, undefined);
    assert.equal(shellTarget.serverExecution, undefined);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated MicroVertical self-check names corrupted contracts and fix areas', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-self-check-'));

  const scenarios = [
    {
      workspaceName: 'topology-corrupt',
      mutate: (workspaceDir: string) => {
        const topology = readJson(
          workspaceDir,
          'topology/reference-topology.json',
        );
        topology.shell.moduleFederation.remotes[0].manifestUrl =
          'http://localhost:4999/mf-manifest.json';
        writeJson(workspaceDir, 'topology/reference-topology.json', topology);
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/reference-topology\.json shell\.moduleFederation\.remotes\./,
      expectedFixArea:
        /Fix area: restore generated shell Module Federation remotes\./,
    },
    {
      workspaceName: 'overlay-corrupt',
      mutate: (workspaceDir: string) => {
        const overlay = readJson(
          workspaceDir,
          'topology/local-overlays/development.json',
        );
        overlay.apis.catalog = 'http://localhost:4101/not-catalog-api';
        writeJson(
          workspaceDir,
          'topology/local-overlays/development.json',
          overlay,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/local-overlays\/development\.json apis\.catalog\./,
      expectedFixArea: /Fix area: restore generated local API overlay\./,
    },
    {
      workspaceName: 'backend-federation-corrupt',
      mutate: (workspaceDir: string) => {
        const topology = readJson(
          workspaceDir,
          'topology/reference-topology.json',
        );
        appById(topology.verticals, 'catalog').backendFederation.manifestUrl =
          'http://localhost:4101/backend-mf-manifest.json';
        writeJson(workspaceDir, 'topology/reference-topology.json', topology);
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/reference-topology\.json verticals\.catalog\.backendFederation\./,
      expectedFixArea:
        /Fix area: restore generated MicroVertical server execution contract\./,
    },
    {
      workspaceName: 'vertical-file-missing',
      mutate: (workspaceDir: string) => {
        fs.rmSync(path.join(workspaceDir, 'verticals/catalog/shared/api.ts'));
      },
      expectedContract:
        /MicroVertical contract self-check failed: required files for catalog\. Missing verticals\/catalog\/shared\/api\.ts\./,
      expectedFixArea:
        /Fix area: restore the generated MicroVertical files or rerun the MicroVertical generator\./,
    },
    {
      workspaceName: 'shell-ssr-corrupt',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'shell-super-app',
        ).moduleFederation.ssr = false;
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json shell SSR contract\./,
      expectedFixArea:
        /Fix area: restore generated string SSR Module Federation settings\./,
    },
    {
      workspaceName: 'delivery-unit-drift',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'catalog',
        ).deliveryUnit.buildMarker = 'deadbeefdeadbeef';
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json topology\.apps\.catalog\.deliveryUnit\./,
      expectedFixArea:
        /Fix area: regenerate vertical identity from delivery-unit record; do not hand-edit surface markers\./,
    },
    {
      workspaceName: 'vertical-ssr-corrupt',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'catalog',
        ).moduleFederation.ssr = false;
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json apps\.catalog\./,
      expectedFixArea:
        /Fix area: regenerate the generated MicroVertical contract entry\./,
    },
  ] as const;

  try {
    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.workspaceName);
      generateUltramodernWorkspace({
        targetDir: workspaceDir,
        packageName: scenario.workspaceName,
        modernVersion: '3.2.1',
        enableTailwind: true,
        packageSource: { strategy: 'workspace' },
      });
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name: 'catalog',
        modernVersion: '3.2.1',
      });

      const passingResult = runGeneratedWorkspaceCheck(workspaceDir);
      assert.equal(passingResult.status, 0, commandOutput(passingResult));

      scenario.mutate(workspaceDir);
      const failingResult = runGeneratedWorkspaceCheck(workspaceDir);
      const output = commandOutput(failingResult);
      assert.notEqual(failingResult.status, 0, output);
      assert.match(output, scenario.expectedContract);
      assert.match(output, scenario.expectedFixArea);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated API boundary check rejects raw handler drift through Oxlint', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-api-check-'));
  const workspaceDir = path.join(tempRoot, 'api-check-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'api-check-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const passingResult = runGeneratedApiCheck(workspaceDir);
    assert.equal(passingResult.status, 0, commandOutput(passingResult));

    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/index.ts'),
      `
import { createHandler } from '@modern-js/plugin-bff/hono-server';

export const handler = async (request: Request) => {
  const body = await request.json();
  return Response.json(body);
};

export default async function fallback() {
  return new Response('legacy');
}

const runtimeFramework = 'hono';
const strictEffectApproach = false;
`,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/effect-api.ts'),
      `
export const backendFederationContract = {
 role: 'backend-remote',
 strictEffectApproach: false,
};

export const handler = async (request: Request) => Response.json(await request.json());
`,
      'utf-8',
    );

    const failingResult = runGeneratedApiCheck(workspaceDir);
    const output = commandOutput(failingResult);
    assert.notEqual(failingResult.status, 0, output);
    assert.match(output, /must not import Hono server helpers/);
    assert.match(output, /must not hand-build Response objects/);
    assert.match(output, /must not manually parse request bodies/);
    assert.match(output, /must not export raw request handlers/);
    assert.match(output, /must keep strictEffectApproach enabled/);
    assert.match(output, /must describe the MicroVertical server role/);
    assert.match(output, /must preserve strict Effect backend execution/);
    assert.match(
      output,
      /must preserve the MicroVertical server contract version/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated workspace self-check accepts stable formatting but rejects wrong CI Node pins', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-validator-'));
  const workspaceDir = path.join(tempRoot, 'validator-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'validator-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const expectedNodeVersion = ultramodernConfig.workspace.node.version;
    const workflowPath = path.join(
      workspaceDir,
      '.github/workflows/ultramodern-workspace-gates.yml',
    );
    const modernConfigPath = path.join(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );

    fs.writeFileSync(
      workflowPath,
      read(
        workspaceDir,
        '.github/workflows/ultramodern-workspace-gates.yml',
      ).replace(
        `node-version: "${expectedNodeVersion}"`,
        `node-version: '${expectedNodeVersion}'`,
      ),
      'utf-8',
    );

    const sameLineAssetPrefix = read(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    ).replace(
      /const assetPrefix =\n\s+configuredModernAssetPrefix \|\| configuredUltramodernAssetPrefix \|\| defaultAssetPrefix;/u,
      'const assetPrefix = configuredModernAssetPrefix || configuredUltramodernAssetPrefix || defaultAssetPrefix;',
    );
    fs.writeFileSync(modernConfigPath, sameLineAssetPrefix, 'utf-8');

    const passingResult = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passingResult.status, 0, commandOutput(passingResult));

    fs.writeFileSync(
      workflowPath,
      read(
        workspaceDir,
        '.github/workflows/ultramodern-workspace-gates.yml',
      ).replace(
        `node-version: '${expectedNodeVersion}'`,
        "node-version: '25.0.0'",
      ),
      'utf-8',
    );

    const failingResult = runGeneratedWorkspaceCheck(workspaceDir);
    const output = commandOutput(failingResult);
    assert.notEqual(failingResult.status, 0, output);
    assert.match(
      output,
      new RegExp(
        `CI workflow must pin the generated Node version ${expectedNodeVersion}; found 25\\.0\\.0`,
      ),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('emitted module federation config leases Zephyr fail-closed behavior only when authenticated', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-zephyr-'));
  const workspaceDir = path.join(tempRoot, 'zephyr-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'zephyr-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    const modernConfig = read(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    assert.match(
      modernConfig,
      /import \{\s*getBuildConfigEnvironment,\s*withBuildConfigEnvironment,?\s*\} from '@modern-js\/app-tools\/config';/u,
      'generated Modern config must import the public config environment API',
    );
    // Zephyr is always registered (no gate), but fail-closed behavior is leased
    // only for an authoritative CI deploy, signalled by Zephyr's own
    // ZE_CI_TOKEN; a plain build degrades gracefully (works without a Zephyr
    // Cloud account, and a build may set ZE_SECRET_TOKEN only to skip auth).
    assert.match(
      modernConfig,
      /getBuildConfigEnvironment\(\s*'ZE_CI_TOKEN'\s*\)/u,
      'generated Modern config must key Zephyr fail-closed behavior off the Zephyr CI deploy token',
    );
    assert.match(
      modernConfig,
      /withBuildConfigEnvironment\(\s*'ZE_FAIL_BUILD',\s*'true',\s*withZephyrRspack\(\),?\s*\)/u,
      'generated Modern config must lease Zephyr fail-closed behavior through the public config API when it does deploy',
    );
    assert.doesNotMatch(
      modernConfig,
      /\bprocess\s*\.\s*env\b/u,
      'generated Modern config must not bypass the public config API with direct process.env access',
    );
    assert.match(modernConfig, /\n\s*zephyrRspackPlugin\(\),/u);
    assert.doesNotMatch(
      modernConfig,
      /@effect-diagnostics|ULTRAMODERN_ZEPHYR|zephyrWarn|Promise\.race|modifyRspackConfig\(\s*(?:async\s+)?(?:config|\(config\))\s*=>|console\.warn/u,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate converges a legacy shell-only workspace to a validator-clean state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-migrate-shell-'));
  const workspaceDir = path.join(tempRoot, 'shell-only-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'shell-only-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    // Fresh shell-only workspace already satisfies the (backend-surface-gated)
    // contract self-check.
    const freshResult = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(freshResult.status, 0, commandOutput(freshResult));

    // Simulate an older-create workspace: agent/i18n scripts shipped as .mjs
    // and package.json wired at those legacy paths.
    for (const name of [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ]) {
      fs.renameSync(
        path.join(workspaceDir, `scripts/${name}.mts`),
        path.join(workspaceDir, `scripts/${name}.mjs`),
      );
    }
    const legacyPackage = readJson(workspaceDir, 'package.json');
    legacyPackage.scripts['skills:install'] =
      'node ./scripts/bootstrap-agent-skills.mjs';
    legacyPackage.scripts['skills:check'] =
      'node ./scripts/bootstrap-agent-skills.mjs --check';
    legacyPackage.scripts.postinstall =
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall";
    legacyPackage.scripts['agents:refs:install'] =
      'node ./scripts/setup-agent-reference-repos.mjs';
    legacyPackage.scripts['i18n:boundaries'] =
      'node ./scripts/check-ultramodern-i18n-boundaries.mjs';
    writeJson(workspaceDir, 'package.json', legacyPackage);

    const migrateStatus = await runUltramodernToolingCli(
      ['migrate-strict-effect', '--skip-install'],
      workspaceDir,
    );
    assert.equal(migrateStatus, 0);

    for (const name of [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ]) {
      assert.equal(exists(workspaceDir, `scripts/${name}.mts`), true, name);
      assert.equal(exists(workspaceDir, `scripts/${name}.mjs`), false, name);
    }

    // The migrated workspace must again satisfy the generated contract check,
    // including the skills/agent-reference wrappers and script wiring, without
    // requiring backend-federation or Zerops artifacts.
    const migratedResult = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(migratedResult.status, 0, commandOutput(migratedResult));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace package-source strategy and Tailwind-disabled generation remain integrated', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'workspace-source-no-tailwind');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'workspace-source-no-tailwind',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: {
        strategy: 'workspace',
      },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const rootPackage = readJson(workspaceDir, 'package.json');
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const packageSource = ultramodernConfig.packageSource;
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );

    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.equal(
      rootPackage.modernjs.packageSource.config,
      './.modernjs/ultramodern.json',
    );
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    for (const dependency of ['tailwindcss', '@rsbuild/plugin-tailwindcss']) {
      assert.equal(shellPackage.devDependencies[dependency], undefined);
      assert.equal(catalogPackage.devDependencies[dependency], undefined);
    }
    for (const relativePath of [
      'apps/shell-super-app/tailwind.config.ts',
      'verticals/catalog/tailwind.config.ts',
    ]) {
      assert.equal(exists(workspaceDir, relativePath), false, relativePath);
    }
    assert.equal(ultramodernConfig.features.tailwind, false);
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'shell-super-app').kind,
      'shell',
    );
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'catalog').kind,
      'vertical',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Surface-profile-aware generated validator (Sol batch-3 verify #5 / #9)     */
/* -------------------------------------------------------------------------- */

function generateProfileWorkspace(
  workspaceDir: string,
  vertical: {
    name: string;
    preset?: 'full-stack' | 'api-only' | 'ui-only';
    apiProtocol?: 'rest' | 'rpc';
    horizontalRemote?: boolean;
  },
) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    modernVersion: '3.2.1',
    name: vertical.name,
    preset: vertical.preset,
    apiProtocol: vertical.apiProtocol,
    horizontalRemote: vertical.horizontalRemote,
  });
}

test('generated validator accepts multiple verticals added in non-alphabetical order (cross-process identity + set-cohort)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-multi-vertical-'));
  const workspaceDir = path.join(tempRoot, 'multi-vertical-workspace');
  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: path.basename(workspaceDir),
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    // Insertion order deliberately differs from filesystem-sorted order so the
    // app-id cohort check (set semantics) and the delivery-unit build marker
    // (deterministic identity hash, recomputed in the spawned validator
    // process) are both exercised end to end.
    for (const name of ['inventory', 'finance', 'people', 'analytics']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        modernVersion: '3.2.1',
        name,
      });
    }

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts an api-only (headless) workspace and rejects planted UI/MF artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-api-'));
  const workspaceDir = path.join(tempRoot, 'api-only-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'headless',
      preset: 'api-only',
    });

    // The headless unit ships API artifacts but no UI/MF files.
    assert.ok(exists(workspaceDir, 'verticals/headless/shared/api.ts'));
    assert.ok(exists(workspaceDir, 'verticals/headless/api/index.ts'));
    assert.ok(
      !exists(workspaceDir, 'verticals/headless/module-federation.config.ts'),
    );
    assert.ok(
      !exists(workspaceDir, 'verticals/headless/src/federation-entry.tsx'),
    );

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    // Planting a UI/MF artifact into a headless unit must be rejected.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/headless/module-federation.config.ts'),
      'export default {};\n',
      'utf-8',
    );
    const failing = runGeneratedWorkspaceCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(
      output,
      /Unexpected .*module-federation\.config\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(workspaceDir, 'verticals/headless/module-federation.config.ts'),
    );

    // Planting colocated route metadata (a UI/browser-surface artifact) into a
    // headless unit must also be rejected.
    fs.mkdirSync(path.join(workspaceDir, 'verticals/headless/src/routes'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/ultramodern-route-metadata.ts',
      ),
      'export const metadata = {};\n',
      'utf-8',
    );
    const failingRouteMeta = runGeneratedWorkspaceCheck(workspaceDir);
    const routeMetaOutput = commandOutput(failingRouteMeta);
    assert.notEqual(failingRouteMeta.status, 0, routeMetaOutput);
    assert.match(
      routeMetaOutput,
      /Unexpected .*ultramodern-route-metadata\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/ultramodern-route-metadata.ts',
      ),
    );

    // Planting the federated `./Widget` demo component (a UI-only artifact:
    // descriptors.ts:127 -> src/components/${domain}-widget.tsx) into a headless
    // unit must be rejected.
    fs.mkdirSync(path.join(workspaceDir, 'verticals/headless/src/components'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/components/headless-widget.tsx',
      ),
      'export const Widget = () => null;\n',
      'utf-8',
    );
    const failingWidget = runGeneratedWorkspaceCheck(workspaceDir);
    const widgetOutput = commandOutput(failingWidget);
    assert.notEqual(failingWidget.status, 0, widgetOutput);
    assert.match(
      widgetOutput,
      /Unexpected .*src\/components\/headless-widget\.tsx for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/components/headless-widget.tsx',
      ),
    );

    // Planting a colocated `[lang]/route.meta.ts` (a UI/browser route-meta
    // artifact) into a headless unit must be rejected too.
    fs.mkdirSync(
      path.join(workspaceDir, 'verticals/headless/src/routes/[lang]'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/[lang]/route.meta.ts',
      ),
      'export const meta = {};\n',
      'utf-8',
    );
    const failingRouteMetaColocated = runGeneratedWorkspaceCheck(workspaceDir);
    const routeMetaColocatedOutput = commandOutput(failingRouteMetaColocated);
    assert.notEqual(
      failingRouteMetaColocated.status,
      0,
      routeMetaColocatedOutput,
    );
    assert.match(
      routeMetaColocatedOutput,
      /Unexpected .*\[lang\]\/route\.meta\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/[lang]/route.meta.ts',
      ),
    );

    // Widening the headless unit's Module Federation DTS boundary to a browser
    // federation entry it does not ship must be rejected (the api-only mf-types
    // boundary only covers the app ambient types).
    const mfTypes = readJson(
      workspaceDir,
      'verticals/headless/tsconfig.mf-types.json',
    );
    mfTypes.include = ['src/federation-entry.tsx', 'src/modern-app-env.d.ts'];
    writeJson(
      workspaceDir,
      'verticals/headless/tsconfig.mf-types.json',
      mfTypes,
    );
    const failingDts = runGeneratedWorkspaceCheck(workspaceDir);
    const dtsOutput = commandOutput(failingDts);
    assert.notEqual(failingDts.status, 0, dtsOutput);
    assert.match(
      dtsOutput,
      /restore the generated MicroVertical Module Federation DTS boundary/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts a ui-only workspace and rejects planted API artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-ui-'));
  const workspaceDir = path.join(tempRoot, 'ui-only-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'surface',
      preset: 'ui-only',
    });

    assert.ok(
      exists(workspaceDir, 'verticals/surface/src/federation-entry.tsx'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/surface/shared/api.ts'));

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    // Planting an API contract into a ui-only unit must be rejected.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/surface/shared/api.ts'),
      'export const api = {};\n',
      'utf-8',
    );
    const failing = runGeneratedWorkspaceCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(output, /Unexpected .*shared\/api\.ts for a ui-only unit/);
    fs.rmSync(path.join(workspaceDir, 'verticals/surface/shared/api.ts'));

    // Planting an RPC contract into a ui-only unit must be rejected too: a
    // ui-only unit carries no API contract in either protocol.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/surface/shared/rpc.ts'),
      'export const rpc = {};\n',
      'utf-8',
    );
    const failingRpc = runGeneratedWorkspaceCheck(workspaceDir);
    const rpcOutput = commandOutput(failingRpc);
    assert.notEqual(failingRpc.status, 0, rpcOutput);
    assert.match(rpcOutput, /Unexpected .*shared\/rpc\.ts for a ui-only unit/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator validates a Horizontal Remote (components-only) workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-hr-'));
  const workspaceDir = path.join(tempRoot, 'horizontal-remote-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'design-system',
      horizontalRemote: true,
    });

    assert.ok(
      exists(workspaceDir, 'verticals/design-system/src/federation-entry.tsx'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/design-system/shared/api.ts'));

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts an rpc-protocol workspace and rejects a missing RPC client', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-rpc-'));
  const workspaceDir = path.join(tempRoot, 'rpc-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'catalog',
      apiProtocol: 'rpc',
    });

    // RPC generation emits the RPC contract/client, not the REST surface.
    assert.ok(exists(workspaceDir, 'verticals/catalog/shared/rpc.ts'));
    assert.ok(
      exists(workspaceDir, 'verticals/catalog/src/api/catalog-rpc-client.ts'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/catalog/shared/api.ts'));
    assert.ok(
      !exists(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
    );

    // The compact config records the `rpc` protocol, so the generated
    // validator synthesizes a REST-less Cloudflare proof route (mirroring
    // policy.ts:76) and, per its readiness assertions, must NOT require a REST
    // `apiReadiness` route for this unit. The exit-0 check below is the
    // end-to-end proof that no REST readiness is required for an rpc unit.
    const rpcConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const rpcAppEntry = rpcConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'catalog',
    );
    assert.equal(rpcAppEntry?.api?.protocol, 'rpc');

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    // Planting the REST API client into an RPC unit must be rejected: an RPC
    // unit ships only the `${stem}-rpc-client`, never the REST `${stem}-client`.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
      'export const client = {};\n',
      'utf-8',
    );
    const failingRestClient = runGeneratedWorkspaceCheck(workspaceDir);
    const restClientOutput = commandOutput(failingRestClient);
    assert.notEqual(failingRestClient.status, 0, restClientOutput);
    assert.match(
      restClientOutput,
      /catalog RPC unit must not emit the REST API client/,
    );
    fs.rmSync(
      path.join(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
    );

    // Removing the RPC client must be rejected by the generated validator.
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/api/catalog-rpc-client.ts',
      ),
    );
    const failing = runGeneratedWorkspaceCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(
      output,
      /Missing verticals\/catalog\/src\/api\/catalog-rpc-client\.ts/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator still accepts a rest full-stack workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-rest-'));
  const workspaceDir = path.join(tempRoot, 'rest-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'catalog',
      apiProtocol: 'rest',
    });
    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
