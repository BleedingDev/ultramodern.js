#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateApp } from './ultramodern-cloudflare-proof.mjs';

const workspaceRoot = path.resolve(
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const compactConfigPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');
const localOverlayPath = path.join(
  workspaceRoot,
  'topology/local-overlays/development.json',
);
const defaultOut = path.join(
  workspaceRoot,
  '.codex/reports/cloudflare-version-proof/public-url-proof.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalJson(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : {};
}

function toKebabCase(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function toPascalCase(value) {
  return toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toEnvSegment(value) {
  return toKebabCase(value).replace(/-/gu, '_').toUpperCase();
}

function normalizeRelativePath(value) {
  return String(value ?? '').replace(/\\/gu, '/').replace(/^\.\/+/u, '');
}

function appNamespace(app) {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}

function normalizeCompactApp(rawApp, localOverlay = {}) {
  const id = String(rawApp.id);
  const kind = rawApp.kind === 'vertical' ? 'vertical' : 'shell';
  const appPath =
    typeof rawApp.path === 'string'
      ? normalizeRelativePath(rawApp.path)
      : kind === 'shell'
        ? 'apps/shell-super-app'
        : `verticals/${toKebabCase(id)}`;
  const packageSuffix =
    typeof rawApp.packageSuffix === 'string'
      ? rawApp.packageSuffix
      : appPath.split('/').at(-1) ?? id;
  const domain =
    typeof rawApp.domain === 'string'
      ? rawApp.domain
      : kind === 'vertical'
        ? packageSuffix
        : undefined;
  const moduleFederation =
    rawApp.moduleFederation && typeof rawApp.moduleFederation === 'object'
      ? rawApp.moduleFederation
      : {};
  const surfaceProfile =
    rawApp.surfaceProfile === 'api-only' || rawApp.surfaceProfile === 'ui-only'
      ? rawApp.surfaceProfile
      : 'full-stack';
  const api =
    rawApp.api && typeof rawApp.api === 'object'
      ? {
          stem:
            typeof rawApp.api.stem === 'string'
              ? rawApp.api.stem
              : domain ?? id,
          prefix:
            typeof rawApp.api.prefix === 'string'
              ? rawApp.api.prefix
              : `/${domain ?? id}-api`,
          protocol: rawApp.api.protocol === 'rpc' ? 'rpc' : 'rest',
        }
      : undefined;
  const cloudflare =
    rawApp.deploy?.cloudflare && typeof rawApp.deploy.cloudflare === 'object'
      ? rawApp.deploy.cloudflare
      : {};
  const jsonSmokeChecks = Array.isArray(cloudflare.jsonSmokeChecks)
    ? cloudflare.jsonSmokeChecks
    : undefined;
  const port =
    typeof rawApp.port === 'number'
      ? rawApp.port
      : typeof localOverlay.ports?.[id] === 'number'
        ? localOverlay.ports[id]
        : undefined;

  return {
    id,
    kind,
    path: appPath,
    packageSuffix,
    domain,
    port,
    surfaceProfile,
    emitsUi: kind === 'shell' || surfaceProfile !== 'api-only',
    mfName:
      typeof moduleFederation.name === 'string'
        ? moduleFederation.name
        : kind === 'shell'
          ? 'shellSuperApp'
          : `vertical${toPascalCase(domain ?? id)}`,
    api,
    cloudflare,
    deliveryUnit:
      rawApp.deliveryUnit && typeof rawApp.deliveryUnit === 'object'
        ? rawApp.deliveryUnit
        : undefined,
    backendFederation:
      rawApp.backendFederation && typeof rawApp.backendFederation === 'object'
        ? rawApp.backendFederation
        : undefined,
    serverExecution:
      localOverlay.serverExecution?.[id] &&
      typeof localOverlay.serverExecution[id] === 'object'
        ? localOverlay.serverExecution[id]
        : undefined,
    jsonSmokeChecks,
  };
}

function buildMarkerFor(app) {
  const buildMarker = app.deliveryUnit?.buildMarker;
  if (typeof buildMarker !== 'string' || buildMarker.length === 0) {
    throw new Error(
      `${app.id} is missing its generated delivery-unit build marker`,
    );
  }
  return buildMarker;
}

function createDeliveryUnit(app) {
  const buildMarker = buildMarkerFor(app);
  const unitId = app.deliveryUnit.unitId;
  const identity = {
    unitId,
    buildMarker,
    sourceRevision: 'workspace',
  };

  return {
    ...app.deliveryUnit,
    surfaces: {
      ...(app.emitsUi ? { ui: { ...identity, surface: 'ui' } } : {}),
      ...(app.api ? { api: { ...identity, surface: 'api' } } : {}),
    },
  };
}

function createCloudflareSecurity() {
  return {
    enabled: true,
    headers: {
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentTypeOptions: 'nosniff',
      permissionsPolicy:
        'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    },
    contentSecurityPolicy: {
      mode: 'report-only',
      directives: {
        'base-uri': [`'self'`],
        'connect-src': [`'self'`, 'https:', 'http:', 'wss:', 'ws:'],
        'default-src': [`'self'`],
        'font-src': [`'self'`, 'data:', 'https:', 'http:'],
        'form-action': [`'self'`],
        'frame-ancestors': [`'self'`],
        'img-src': [`'self'`, 'data:', 'blob:', 'https:', 'http:'],
        'manifest-src': [`'self'`, 'https:', 'http:'],
        'object-src': [`'none'`],
        'script-src': [
          `'self'`,
          `'unsafe-inline'`,
          `'unsafe-eval'`,
          'https:',
          'http:',
          'blob:',
        ],
        'style-src': [`'self'`, `'unsafe-inline'`, 'https:', 'http:'],
        'worker-src': [`'self'`, 'blob:'],
      },
      reason:
        'Report-only by default so Cloudflare Module Federation SSR can prove remote script, style, and connect compatibility before enforcement.',
    },
    noindex: {
      workersDev: true,
      localhost: true,
      previewHostnames: [],
    },
  };
}

function createQualityGates() {
  return {
    publicRoutes: {
      requireSitemapWhenPresent: true,
      requireRobotsSitemapConsistency: true,
      requireWebManifestWhenPresent: true,
    },
    statusCodes: {
      notFoundRoute: '/__ultramodern-smoke-missing/nope',
      unknownRouteStatus: 404,
    },
    indexing: {
      previewNoindex: true,
      productionPublicRoutesIndexable: true,
    },
    assets: {
      cssPreloadRequired: true,
      cssResponseRequired: true,
      cacheControlRequiredForCss: true,
      sourcemapsPubliclyReferenced: false,
    },
    budgets: {
      ssrHtmlMaxBytes: 250_000,
      mfManifestMaxBytes: 500_000,
      localeJsonMaxBytes: 100_000,
      sitemapXmlMaxBytes: 500_000,
      cssAssetMaxBytes: 750_000,
    },
    csp: {
      finalMode: 'report-only-dogfood',
      decision:
        'Report-only remains the generated final mode until public smoke proof records MF SSR script/style/connect compatibility for the deployed surface.',
    },
  };
}

function createPublicHead() {
  return {
    alternates: {
      hreflang: ['en', 'cs'],
      xDefault: 'en',
    },
  };
}

function createPublicSurface() {
  return {
    publicRoutes: [],
    routeEntries: [],
    contentSources: [],
    concreteUrlPaths: [],
  };
}

function createCloudflareRoutes(app) {
  return {
    ...(app.emitsUi
      ? {
          ssr: '/en',
          mfManifest: '/mf-manifest.json',
          locale: `/locales/en/${appNamespace(app)}.json`,
        }
      : {}),
    ...(app.api
      ? app.api.protocol === 'rpc'
        ? { rpc: `${app.api.prefix}/rpc` }
        : { apiReadiness: `${app.api.prefix}/${app.api.stem}/readiness` }
      : {}),
  };
}

function createApiReadinessRoute(app) {
  return app.api?.protocol === 'rest'
    ? `${app.api.prefix}/${app.api.stem}/readiness`
    : undefined;
}

function createRpcRoute(app) {
  return app.api?.protocol === 'rpc' ? `${app.api.prefix}/rpc` : undefined;
}

function createRpcProbe(app) {
  const id = `${app.id}-cloudflare-proof`;
  return {
    method: 'POST',
    body: { jsonrpc: '2.0', id, method: 'list', params: { limit: 1 } },
    expect: { id, 'result.items.0.id': `starter-${app.api.stem}` },
  };
}

function createCloudflareWorkerName(packageScope, app) {
  return `${toKebabCase(packageScope)}-${app.packageSuffix}`.slice(0, 63);
}

function createWorkerBindingName(app) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER`;
}

function createWorkerBindingEnv(app) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER_BINDING`;
}

function createDispatchNamespaceEnv(app) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_DISPATCH_NAMESPACE`;
}

function createDispatchWorkerNameEnv(app) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER_NAME`;
}

function createBackendRemoteName(app) {
  return `${app.mfName ?? `vertical${toPascalCase(app.id)}`}Backend`;
}

function createCloudflareExecutionSurface(packageScope, app) {
  const workerRuntime = {
    workerEntry: '.output/server/index.mjs',
    workerManifest: '.output/server/modern-worker-manifest.json',
    effectBffBundle: '.output/worker/__modern_bff_effect.js',
  };
  return {
    kind: 'cloudflare-worker-snapshot',
    workerName: createCloudflareWorkerName(packageScope, app),
    publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
    ...(app.emitsUi
      ? {
          ssr: {
            ...workerRuntime,
            routeManifest: '.output/server/route.json',
            ssrBundle: '.output/worker/index.js',
            assetsBinding: 'ASSETS',
          },
        }
      : { api: workerRuntime }),
    zephyr: {
      runtime: app.emitsUi ? 'ssr-worker' : 'api-worker',
      integration: 'managed-cloudflare',
      snapshotIdEnv: `ZEPHYR_${toEnvSegment(app.domain ?? app.id)}_SNAPSHOT_ID`,
      versionIdEnv: `ZEPHYR_${toEnvSegment(app.domain ?? app.id)}_VERSION_ID`,
      applicationUidEnv: `ZEPHYR_${toEnvSegment(app.domain ?? app.id)}_APPLICATION_UID`,
    },
    workerDispatch: {
      preferred: 'service-binding',
      serviceBinding: createWorkerBindingName(app),
      serviceBindingEnv: createWorkerBindingEnv(app),
      dispatchNamespaceEnv: createDispatchNamespaceEnv(app),
      dispatchWorkerNameEnv: createDispatchWorkerNameEnv(app),
      requestInterface: 'fetch',
    },
  };
}

function createNodeExecutionSurface(app) {
  return {
    kind: 'node-mf-runtime',
    adapterVersion: 'backend-mf-effect-v1',
    remoteName: createBackendRemoteName(app),
    manifestUrl: `http://localhost:${app.port}/backend-mf-manifest.json`,
    containerEntry: `http://localhost:${app.port}/backendRemoteEntry.cjs`,
    remoteType: 'commonjs-module',
    expose: './effect-api',
    runtimePackage: '@modern-js/plugin-bff/effect',
  };
}

function createServerExecutionProof(packageScope, app) {
  if (!app.api) {
    return undefined;
  }
  const rpc = createRpcRoute(app);
  const readiness = createApiReadinessRoute(app);
  return {
    apiBaseUrl: `http://localhost:${app.port}${rpc ?? app.api.prefix}`,
    versionBoundary: 'web-and-api-same-build',
    cloudflare: {
      ...createCloudflareExecutionSurface(packageScope, app),
      ...(rpc ? { rpcPath: rpc, rpcSerialization: 'json' } : {}),
      ...(readiness ? { apiReadiness: readiness } : {}),
    },
    node: createNodeExecutionSurface(app),
  };
}

function createBackendFederationProof(packageScope, app) {
  if (!app.api) {
    return undefined;
  }
  const apiReadiness = createApiReadinessRoute(app);
  const rpc = createRpcRoute(app);
  const marker = buildMarkerFor(app);
  const remoteName = createBackendRemoteName(app);
  return {
    role: 'microvertical-server',
    name: remoteName,
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    exposes: {
      './effect-api': {
        runtime: `${app.path}/api/index.ts`,
        ...(rpc
          ? {
              contract: `${app.path}/shared/rpc.ts`,
              rpc,
              serialization: 'json',
            }
          : { readiness: apiReadiness }),
      },
    },
    versionBoundary: {
      invariant: 'web-and-api-same-build',
      ...(app.emitsUi
        ? {
            ui: {
              manifestUrl: `http://localhost:${app.port}/mf-manifest.json`,
              marker,
            },
          }
        : {}),
      api: {
        ...(rpc ? { rpc, serialization: 'json' } : { readiness: apiReadiness }),
        marker,
      },
    },
    executionSurfaces: {
      cloudflare: createCloudflareExecutionSurface(packageScope, app),
      node: createNodeExecutionSurface(app),
    },
    compatibility: {
      contractVersion: 'microvertical-server-effect-v1',
    },
  };
}

function createProofTarget(app) {
  const cloudflare = app.deploy?.cloudflare;
  return {
    appId: app.id,
    marker: app.marker,
    cloudflare: {
      workerName: cloudflare?.workerName,
      publicUrlEnv: cloudflare?.publicUrlEnv,
      routes: cloudflare?.routes,
      serviceBindings: cloudflare?.serviceBindings,
      jsonSmokeChecks: cloudflare?.jsonSmokeChecks,
    },
    ...(app.backendFederation
      ? { backendFederation: app.backendFederation }
      : {}),
    ...(app.serverExecution ? { serverExecution: app.serverExecution } : {}),
    ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
  };
}

function createShellServiceBindingProof(packageScope, app, apps) {
  if (app.kind !== 'shell') {
    return undefined;
  }

  const bindings = apps
    .filter(candidate => candidate.kind !== 'shell' && candidate.api)
    .map(candidate => {
      const rpc = createRpcRoute(candidate);
      return {
        appId: candidate.id,
        binding: createWorkerBindingName(candidate),
        route: rpc ?? `${candidate.api.prefix}/${candidate.api.stem}/readiness`,
        service: createCloudflareWorkerName(packageScope, candidate),
        interface: 'fetch',
        ...(rpc
          ? createRpcProbe(candidate)
          : { expectedMarker: buildMarkerFor(candidate) }),
      };
    });

  return bindings.length > 0 ? bindings : undefined;
}

function createContractApp(config, app, apps) {
  const packageScope =
    typeof config.workspace?.packageScope === 'string'
      ? config.workspace.packageScope
      : path.basename(workspaceRoot);
  const compatibilityDate =
    typeof config.deploy?.worker?.compatibilityDate === 'string'
      ? config.deploy.worker.compatibilityDate
      : '2026-06-02';
  const workerName = createCloudflareWorkerName(packageScope, app);
  const backendFederation = createBackendFederationProof(packageScope, app);
  const serverExecution = createServerExecutionProof(packageScope, app);
  const deliveryUnit = createDeliveryUnit(app);
  const serviceBindings = createShellServiceBindingProof(
    packageScope,
    app,
    apps,
  );

  return {
    id: app.id,
    deploy: {
      cloudflare: {
        ...app.cloudflare,
        workerName,
        publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
        compatibilityDate,
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        routes: app.cloudflare.routes ?? createCloudflareRoutes(app),
        ...(serviceBindings ? { serviceBindings } : {}),
        ...(app.jsonSmokeChecks ? { jsonSmokeChecks: app.jsonSmokeChecks } : {}),
        security: app.cloudflare.security ?? createCloudflareSecurity(),
        qualityGates: app.cloudflare.qualityGates ?? createQualityGates(),
      },
    },
    i18n: {
      namespace: appNamespace(app),
    },
    marker: {
      appId: app.id,
      build: buildMarkerFor(app),
    },
    ...(deliveryUnit ? { deliveryUnit } : {}),
    ...(backendFederation ? { backendFederation } : {}),
    ...(serverExecution ? { serverExecution } : {}),
    routes: {
      publicHead: createPublicHead(),
      publicSurface: createPublicSurface(),
    },
    styling: {
      federation: {
        rootSelector: `[data-app-id="${app.id}"]`,
      },
    },
  };
}

function synthesizeContractFromCompactConfig(config) {
  const localOverlay = readOptionalJson(localOverlayPath);
  const apps = Array.isArray(config.topology?.apps)
    ? config.topology.apps.map(app => normalizeCompactApp(app, localOverlay))
    : [];

  return {
    sourcePath: compactConfigPath,
    apps: apps.map(app => createContractApp(config, app, apps)),
  };
}

function readGeneratedContractView() {
  if (fs.existsSync(compactConfigPath)) {
    return synthesizeContractFromCompactConfig(readJson(compactConfigPath));
  }
  throw new Error(
    `Missing UltraModern config. Expected ${path.relative(
      workspaceRoot,
      compactConfigPath,
    )}.`,
  );
}

function parseArgs(argv) {
  const parsed = {
    appId: undefined,
    out: defaultOut,
    requirePublicUrls: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--app') {
      parsed.appId = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      parsed.out = argv[index + 1];
      index += 1;
    } else if (arg === '--require-public-urls') {
      parsed.requirePublicUrls = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/proof-cloudflare-version.mts [--app workspace] [--out evidence.json] [--require-public-urls]

Set each app's public URL using the contract env key, for example:
  ULTRAMODERN_PUBLIC_URL_WORKSPACE=https://workspace.example.workers.dev
`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const contract = readGeneratedContractView();
  const apps = args.appId
    ? contract.apps.filter(app => app.id === args.appId)
    : contract.apps;
  assert(apps.length > 0, `No generated app matched ${args.appId}`);

  const results = [];
  const skipped = [];
  for (const app of apps) {
    const publicUrlEnv = app.deploy?.cloudflare?.publicUrlEnv;
    const publicUrl = publicUrlEnv && process.env[publicUrlEnv];
    if (!publicUrl) {
      const skippedEntry = {
        appId: app.id,
        status: args.requirePublicUrls ? 'fail' : 'skipped',
        publicUrlEnv,
        reason: 'public URL environment variable is not set',
      };
      skipped.push(skippedEntry);
      if (args.requirePublicUrls) {
        throw new Error(`${app.id} requires ${publicUrlEnv}`);
      }
      continue;
    }
    results.push(await validateApp(app, publicUrl));
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: results.length > 0 ? 'pass' : 'skipped',
    contractPath: contract.sourcePath ?? compactConfigPath,
    proofTargets: apps.map(createProofTarget),
    results,
    skipped,
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `[cloudflare-version-proof] ${report.status}: ${args.out}\n`,
  );
  return 0;
}

main().then(
  exitCode => {
    process.exitCode = exitCode;
  },
  error => {
    process.stderr.write(`[cloudflare-version-proof] ${error.message}\n`);
    process.exitCode = 1;
  },
);
