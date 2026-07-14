#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd());
const workspaceRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const compactConfigPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');
const defaultOut = path.join(
  workspaceRoot,
  '.codex/reports/node-backend-federation-proof/proof.json',
);

// Keep these constants/checks in sync with
// @modern-js/utils/universal backend-federation-contract. Generated workspace
// scripts do not currently import @modern-js/utils directly.
const contractVersion = 'microvertical-server-effect-v1';
const nodeAdapterVersion = 'backend-mf-effect-v1';
const backendExpose = './effect-api';
const localRuntimeRelativePaths = [
  'packages/cli/plugin-bff/dist/esm-node/runtime/effect/index.mjs',
  'cli/plugin-bff/dist/esm-node/runtime/effect/index.mjs',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBuildIdentity(app) {
  const buildArtifactPath = path.join(
    workspaceRoot,
    app.directory,
    'shared/ultramodern-build.json',
  );
  if (fs.existsSync(buildArtifactPath)) {
    const artifact = readJson(buildArtifactPath);
    const deliveryUnit = artifact.deliveryUnit ?? {};
    return {
      buildVersion: deliveryUnit.buildMarker ?? deliveryUnit.build,
      packageName: deliveryUnit.packageName,
      version: deliveryUnit.version,
      unitId: deliveryUnit.unitId,
      sourceRevision: deliveryUnit.sourceRevision,
    };
  }

  const buildModulePath = path.join(
    workspaceRoot,
    app.directory,
    'shared/ultramodern-build.ts',
  );
  if (!fs.existsSync(buildModulePath)) {
    return {};
  }
  console.warn(
    `[backend-federation-proof] ${path.relative(
      workspaceRoot,
      buildArtifactPath,
    )} missing; falling back to legacy regex parsing of ${path.relative(
      workspaceRoot,
      buildModulePath,
    )}.`,
  );

  const source = fs.readFileSync(buildModulePath, 'utf8');
  return {
    buildVersion: source.match(/\bbuild:\s*['"]([^'"]+)['"]/u)?.[1],
    packageName: source.match(/\bpackageName:\s*['"]([^'"]+)['"]/u)?.[1],
    version: source.match(/\bversion:\s*['"]([^'"]+)['"]/u)?.[1],
    unitId: source.match(/\bunitId:\s*['"]([^'"]+)['"]/u)?.[1],
    sourceRevision: source.match(/\bsourceRevision:\s*['"]([^'"]+)['"]/u)?.[1],
  };
}

function hasBackendFederationManifestAdapter(runtime) {
  return typeof runtime?.loadBackendFederatedEffectApiFromManifest === 'function';
}

function findLocalRuntimePath(createBin) {
  let current = path.dirname(fileURLToPath(pathToFileURL(createBin)));
  for (let depth = 0; depth < 8; depth += 1) {
    for (const relativePath of localRuntimeRelativePaths) {
      const candidate = path.join(current, relativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

async function importBackendFederationRuntime() {
  let importError;
  try {
    const runtimePath = workspaceRequire.resolve('@modern-js/plugin-bff/effect');
    const runtime = await import(pathToFileURL(runtimePath).href);
    if (hasBackendFederationManifestAdapter(runtime)) {
      return runtime;
    }

    importError = new Error(
      `${runtimePath} does not export loadBackendFederatedEffectApiFromManifest`,
    );
  } catch (error) {
    importError = error;
  }

  const createBin = process.env.ULTRAMODERN_CREATE_BIN;
  if (!createBin) {
    throw importError;
  }

  const localRuntimePath = findLocalRuntimePath(createBin);
  if (!localRuntimePath) {
    throw importError;
  }

  const localRuntime = await import(pathToFileURL(localRuntimePath).href);
  if (!hasBackendFederationManifestAdapter(localRuntime)) {
    throw new Error(
      `${localRuntimePath} does not export loadBackendFederatedEffectApiFromManifest`,
    );
  }

  return localRuntime;
}

function normalizeRelativePath(value) {
  return String(value ?? '')
    .replace(/\\/gu, '/')
    .replace(/^\.\/+/u, '');
}

function toPascalCase(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function createBackendName(app) {
  return (
    app.backendFederation?.name ??
    app.backendFederation?.executionSurfaces?.node?.remoteName ??
    app.serverExecution?.node?.remoteName ??
    (typeof app.moduleFederation?.name === 'string'
      ? `${app.moduleFederation.name}Backend`
      : `vertical${toPascalCase(app.id)}Backend`)
  );
}

function createBackendManifestUrl(app) {
  return (
    app.backendFederation?.executionSurfaces?.node?.manifestUrl ??
    app.serverExecution?.node?.manifestUrl ??
    `http://localhost:${app.port}/backend-mf-manifest.json`
  );
}

function createBackendContainerEntry(app) {
  return (
    app.backendFederation?.executionSurfaces?.node?.containerEntry ??
    app.serverExecution?.node?.containerEntry ??
    `http://localhost:${app.port}/backendRemoteEntry.mjs`
  );
}

function resolveRemoteType(app) {
  return (
    app.backendFederation?.executionSurfaces?.node?.remoteType ??
    app.serverExecution?.node?.remoteType ??
    'module'
  );
}

function normalizeRoutePath(value) {
  const route = String(value ?? '').trim();
  if (!route) {
    return '/';
  }
  return route.startsWith('/') ? route : `/${route}`;
}

function collectJsonSmokeChecks(apps, targetApp) {
  const apiPrefix = normalizeRoutePath(targetApp.api?.prefix ?? `/${targetApp.id}-api`);

  const configuredChecks = apps
    .flatMap((app) =>
      Array.isArray(app?.deploy?.cloudflare?.jsonSmokeChecks)
        ? app.deploy.cloudflare.jsonSmokeChecks
        : [],
    )
    .filter((check) => {
      if (typeof check?.route !== 'string') {
        return false;
      }
      const route = normalizeRoutePath(check.route);
      return route === apiPrefix || route.startsWith(`${apiPrefix}/`);
    });

  if (configuredChecks.length > 0) {
    return configuredChecks;
  }

  const readinessRoute =
    targetApp.backendFederation?.exposes?.[backendExpose]?.readiness ??
    targetApp.backendFederation?.versionBoundary?.api?.readiness ??
    targetApp.serverExecution?.cloudflare?.apiReadiness;
  if (typeof readinessRoute !== 'string' || readinessRoute.length === 0) {
    return [];
  }

  return [
    {
      id: `${targetApp.id}-backend-readiness`,
      method: 'GET',
      route: readinessRoute,
      expect: {
        'checks.api': 'ready',
        status: 'ready',
        versionSkew: 'none',
      },
    },
  ];
}

function compactApps(config, appFilter) {
  const apps = Array.isArray(config.topology?.apps) ? config.topology.apps : [];
  const filteredApps = apps
    .filter((app) => app?.kind === 'vertical' && app.api)
    .filter((app) => !appFilter || app.id === appFilter)
    .map((app) => ({
      id: app.id,
      directory:
        typeof app.path === 'string' ? normalizeRelativePath(app.path) : `verticals/${app.id}`,
      backendName: createBackendName(app),
      manifestUrl: createBackendManifestUrl(app),
      containerEntry: createBackendContainerEntry(app),
      remoteType: resolveRemoteType(app),
      smokeChecks: collectJsonSmokeChecks(apps, app),
      compactDeliveryUnit:
        app.deliveryUnit && typeof app.deliveryUnit === 'object'
          ? app.deliveryUnit
          : undefined,
    }));

  if (appFilter && filteredApps.length === 0) {
    throw new Error(`No vertical API app matched --app ${appFilter}`);
  }

  return filteredApps;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function assertFile(filePath, appId, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${appId} missing ${path.relative(
        workspaceRoot,
        filePath,
      )}; run pnpm build or the relevant vertical build before pnpm node:proof`,
    );
  }

  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`${appId} ${label} is not a file`);
  }
}

function jsonPathValue(value, path) {
  const segments = String(path ?? '')
    .split('.')
    .filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function normalizeJsonExpectations(check) {
  if (Array.isArray(check.expectations)) {
    return check.expectations;
  }
  if (check.expect && typeof check.expect === 'object') {
    return Object.entries(check.expect).map(([path, value]) => ({
      path,
      value,
    }));
  }
  return [];
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

async function runSmokeChecks(app, loaded, createEffectBffTestHandler) {
  if (!Array.isArray(app.smokeChecks) || app.smokeChecks.length === 0) {
    throw new Error(
      `${app.id} backend runtime has no smoke checks; configure a JSON smoke check or expose an API readiness route`,
    );
  }
  if (typeof createEffectBffTestHandler !== 'function') {
    throw new Error(`${app.id} backend runtime cannot create Effect test handler`);
  }

  const servicePrefix = loaded.contract?.servicePrefix ?? loaded.contract?.apiPrefix;
  if (typeof servicePrefix !== 'string' || servicePrefix.length === 0) {
    throw new Error(
      `${app.id} backend expose missing contract.servicePrefix/apiPrefix`,
    );
  }

  const edge = await createEffectBffTestHandler({
    module: loaded.runtime,
    prefix: servicePrefix,
  });
  try {
    const results = [];
    for (const check of app.smokeChecks) {
      const method = String(check.method ?? 'GET').toUpperCase();
      const route = normalizeRoutePath(check.route);
      const headers = {};
      const init = { method, headers };
      if (check.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(check.body);
      }

      const response = await edge.handler(new Request(new URL(route, 'http://localhost'), init));
      const bodyText = await response.text();
      let body;
      try {
        body = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
      } catch (error) {
        throw new Error(`${app.id} ${method} ${route} did not return JSON: ${error.message}`);
      }

      if (!response.ok) {
        throw new Error(`${app.id} ${method} ${route} returned HTTP ${response.status}`);
      }

      const assertions = normalizeJsonExpectations(check).map((expectation) => {
        const actual = jsonPathValue(body, expectation.path);
        assertJsonEqual(
          actual,
          expectation.value,
          `${app.id} ${method} ${route} ${expectation.path}`,
        );
        return {
          path: expectation.path,
          expected: expectation.value,
          actual,
          status: 'pass',
        };
      });

      results.push({
        id: check.id ?? `${method} ${route}`,
        method,
        route,
        statusCode: response.status,
        assertions,
        status: 'pass',
      });
    }
    return results;
  } finally {
    await edge.dispose?.();
  }
}

function resolveArtifacts(app, target) {
  const targetDirectory = path.join(workspaceRoot, app.directory, target);

  return {
    manifestPath: path.join(targetDirectory, 'backend-mf-manifest.json'),
    entryPath: path.join(targetDirectory, 'backendRemoteEntry.mjs'),
  };
}

function validateManifest(app, manifest, buildIdentity) {
  assertEqual(manifest.schemaVersion, 1, `${app.id} backend manifest schema`);
  assertEqual(manifest.name, app.backendName, `${app.id} backend manifest name`);
  assertEqual(manifest.id, app.backendName, `${app.id} backend manifest id`);
  assertEqual(
    manifest.version,
    buildIdentity.version,
    `${app.id} backend manifest version`,
  );
  assertEqual(
    manifest.buildVersion,
    buildIdentity.buildVersion,
    `${app.id} backend manifest build version`,
  );
  assertEqual(manifest.metaData?.name, app.backendName, `${app.id} backend manifest metadata name`);
  assertEqual(
    manifest.metaData?.buildInfo?.buildName,
    buildIdentity.packageName,
    `${app.id} backend manifest package name`,
  );
  assertEqual(
    manifest.metaData?.buildInfo?.buildVersion,
    buildIdentity.buildVersion,
    `${app.id} backend manifest metadata build version`,
  );
  assertEqual(
    manifest.metaData?.remoteEntry?.name,
    'backendRemoteEntry.mjs',
    `${app.id} backend manifest remote entry filename`,
  );
  assertEqual(
    manifest.metaData?.remoteEntry?.type,
    app.remoteType,
    `${app.id} backend manifest remote entry type`,
  );
  assertEqual(manifest.entry?.url, app.containerEntry, `${app.id} backend manifest entry URL`);
  assertEqual(manifest.entry?.type, app.remoteType, `${app.id} backend manifest entry type`);
  assertEqual(
    manifest.backendFederation?.role,
    'microvertical-server',
    `${app.id} backend manifest role`,
  );
  assertEqual(
    manifest.backendFederation?.runtimeFramework,
    'effect',
    `${app.id} backend manifest runtime framework`,
  );
  assertEqual(
    manifest.backendFederation?.strictEffectApproach,
    true,
    `${app.id} backend manifest strict Effect flag`,
  );
  assertEqual(
    manifest.backendFederation?.contractVersion,
    contractVersion,
    `${app.id} backend manifest contract version`,
  );
  assertEqual(
    manifest.backendFederation?.nodeAdapterVersion,
    nodeAdapterVersion,
    `${app.id} backend manifest Node adapter version`,
  );
  assertEqual(
    manifest.backendFederation?.manifestUrl,
    app.manifestUrl,
    `${app.id} backend manifest URL`,
  );
  assertEqual(
    manifest.backendFederation?.containerEntry,
    app.containerEntry,
    `${app.id} backend container URL`,
  );
  assertEqual(manifest.backendFederation?.expose, backendExpose, `${app.id} backend expose`);
  assertEqual(
    manifest.backendFederation?.versionBoundary?.packageName,
    buildIdentity.packageName,
    `${app.id} backend manifest version-boundary package`,
  );
  assertEqual(
    manifest.backendFederation?.versionBoundary?.version,
    buildIdentity.version,
    `${app.id} backend manifest version-boundary version`,
  );
  assertEqual(
    manifest.backendFederation?.versionBoundary?.buildVersion,
    buildIdentity.buildVersion,
    `${app.id} backend manifest version-boundary build version`,
  );

  const manifestDeliveryUnit = manifest.backendFederation?.deliveryUnit;
  if (manifestDeliveryUnit) {
    assertEqual(
      manifestDeliveryUnit.unitId,
      buildIdentity.unitId,
      `${app.id} backend manifest delivery-unit id`,
    );
    assertEqual(
      manifestDeliveryUnit.buildMarker,
      buildIdentity.buildVersion,
      `${app.id} backend manifest delivery-unit build marker`,
    );
    assertEqual(
      manifestDeliveryUnit.packageName,
      buildIdentity.packageName,
      `${app.id} backend manifest delivery-unit package name`,
    );
    assertEqual(
      manifestDeliveryUnit.version,
      buildIdentity.version,
      `${app.id} backend manifest delivery-unit version`,
    );
    assertEqual(
      manifestDeliveryUnit.sourceRevision,
      buildIdentity.sourceRevision,
      `${app.id} backend manifest delivery-unit source revision`,
    );
  }

  const versionBoundaryDeliveryUnit =
    manifest.backendFederation?.versionBoundary?.deliveryUnit;
  if (versionBoundaryDeliveryUnit) {
    assertEqual(
      versionBoundaryDeliveryUnit.unitId,
      buildIdentity.unitId,
      `${app.id} backend manifest version-boundary delivery-unit id`,
    );
    assertEqual(
      versionBoundaryDeliveryUnit.buildMarker,
      buildIdentity.buildVersion,
      `${app.id} backend manifest version-boundary delivery-unit build marker`,
    );
  }

  const exposes = Array.isArray(manifest.exposes) ? manifest.exposes : [];
  if (!exposes.some((expose) => expose?.name === backendExpose)) {
    throw new Error(`${app.id} backend manifest missing ${backendExpose} expose`);
  }
}

function assertCompactDeliveryUnitMatchesBuild(app, buildIdentity) {
  const compactDeliveryUnit = app.compactDeliveryUnit;
  if (!compactDeliveryUnit) {
    return;
  }

  const mismatches = [];
  const compare = (label, a, b) => {
    if (a !== undefined && b !== undefined && a !== b) {
      mismatches.push(`${label}: deliveryUnit=${a} vs ultramodern-build=${b}`);
    }
  };
  compare('unitId', compactDeliveryUnit.unitId, buildIdentity.unitId);
  compare(
    'buildMarker/build',
    compactDeliveryUnit.buildMarker,
    buildIdentity.buildVersion,
  );
  compare(
    'packageName',
    compactDeliveryUnit.packageName,
    buildIdentity.packageName,
  );
  compare('version', compactDeliveryUnit.version, buildIdentity.version);

  if (mismatches.length > 0) {
    throw new Error(
      `${app.id} delivery-unit identity drift between ${path.relative(
        workspaceRoot,
        compactConfigPath,
      )} (deliveryUnit) and ${path.relative(
        workspaceRoot,
        path.join(workspaceRoot, app.directory, 'shared/ultramodern-build.ts'),
      )}: ${mismatches.join('; ')}`,
    );
  }
}

async function importBackendEntry(entryPath) {
  const entry = await import(pathToFileURL(entryPath).href);
  const container = entry.default ?? entry;

  if (!container || typeof container.get !== 'function' || typeof container.init !== 'function') {
    throw new Error(
      `${path.relative(
        workspaceRoot,
        entryPath,
      )} does not export a Module Federation get/init container`,
    );
  }

  return container;
}

async function proveBackend(app, backendRuntime, target) {
  const {
    createEffectBffTestHandler,
    loadBackendFederatedEffectApiFromManifest,
  } = backendRuntime;
  const { manifestPath, entryPath } = resolveArtifacts(app, target);

  assertFile(manifestPath, app.id, 'backend manifest');
  assertFile(entryPath, app.id, 'backend remote entry');

  const buildIdentity = readBuildIdentity(app);
  assertCompactDeliveryUnitMatchesBuild(app, buildIdentity);
  const manifest = readJson(manifestPath);
  validateManifest(app, manifest, buildIdentity);

  const localRuntimeEntry = pathToFileURL(entryPath).href;
  const loaded = await loadBackendFederatedEffectApiFromManifest({
    hostName: 'ultramodernNodeBackendProof',
    manifest,
    manifestPath,
    remote: {
      entry: localRuntimeEntry,
    },
    expected: {
      buildMarker: buildIdentity.buildVersion,
      buildVersion: buildIdentity.buildVersion,
      contractVersion,
      nodeAdapterVersion,
      packageName: buildIdentity.packageName,
      remoteName: app.backendName,
      unitId: buildIdentity.unitId,
    },
  });
  const backendContract = loaded.backendFederationContract;

  assertEqual(
    backendContract?.strictEffectApproach,
    true,
    `${app.id} backend expose strict Effect flag`,
  );
  assertEqual(
    backendContract?.runtimeFramework,
    'effect',
    `${app.id} backend expose runtime framework`,
  );
  assertEqual(backendContract?.role, 'microvertical-server', `${app.id} backend expose role`);
  assertEqual(backendContract?.name, app.backendName, `${app.id} backend expose name`);
  assertEqual(
    backendContract?.compatibility?.contractVersion,
    contractVersion,
    `${app.id} backend expose contract version`,
  );
  assertEqual(
    backendContract?.compatibility?.nodeAdapterVersion,
    nodeAdapterVersion,
    `${app.id} backend expose Node adapter version`,
  );
  assertEqual(
    backendContract?.compatibility?.packageName,
    buildIdentity.packageName,
    `${app.id} backend expose package name`,
  );
  assertEqual(
    backendContract?.compatibility?.build,
    buildIdentity.buildVersion,
    `${app.id} backend expose build version`,
  );
  assertEqual(
    manifest.buildVersion,
    backendContract?.compatibility?.build,
    `${app.id} backend manifest/expose build coupling`,
  );
  if (backendContract?.compatibility?.unitId !== undefined) {
    assertEqual(
      backendContract.compatibility.unitId,
      manifest.backendFederation?.deliveryUnit?.unitId,
      `${app.id} backend expose delivery-unit id`,
    );
  }

  if (loaded.api === undefined || loaded.runtime === undefined) {
    throw new Error(`${app.id} backend expose missing api/runtime exports`);
  }

  const smokeChecks = await runSmokeChecks(app, loaded, createEffectBffTestHandler);

  return {
    appId: app.id,
    expose: backendExpose,
    manifestPath: normalizeRelativePath(path.relative(workspaceRoot, manifestPath)),
    containerPath: normalizeRelativePath(path.relative(workspaceRoot, entryPath)),
    manifestUrl: app.manifestUrl,
    containerEntry: app.containerEntry,
    runtimeEntry: localRuntimeEntry,
    remoteName: app.backendName,
    remoteType: app.remoteType,
    versionBoundary: {
      packageName: buildIdentity.packageName,
      version: buildIdentity.version,
      buildVersion: buildIdentity.buildVersion,
      unitId: buildIdentity.unitId,
      sourceRevision: buildIdentity.sourceRevision,
    },
    smokeChecks,
    status: 'pass',
  };
}

function parseArgs(argv) {
  const parsed = { app: undefined, out: defaultOut, target: 'dist' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      parsed.out = argv[index + 1];
      index += 1;
    } else if (arg === '--app') {
      parsed.app = argv[index + 1];
      index += 1;
    } else if (arg === '--target') {
      parsed.target = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.out) {
    throw new Error('--out requires a path');
  }
  if (!parsed.target) {
    throw new Error('--target requires a directory name');
  }

  return parsed;
}

function printHelp() {
  process.stdout
    .write(`Usage: node scripts/proof-node-backend-federation.mjs [--app id] [--target dist] [--out proof.json]
`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const config = readJson(compactConfigPath);
  const apps = compactApps(config, args.app);
  const results = [];
  const backendRuntime =
    apps.length > 0 ? await importBackendFederationRuntime() : undefined;

  for (const app of apps) {
    results.push(await proveBackend(app, backendRuntime, args.target));
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: results.length > 0 ? 'pass' : 'skipped',
    target: args.target,
    results,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[node-backend-federation-proof] ${report.status}: ${args.out}\n`);

  return 0;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    process.stderr.write(`[node-backend-federation-proof] ${error.message}\n`);
    process.exitCode = 1;
  },
);
