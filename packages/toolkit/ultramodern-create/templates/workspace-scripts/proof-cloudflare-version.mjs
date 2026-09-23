#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateApp } from './ultramodern-cloudflare-proof.mjs';
import {
  readGeneratedContractView as readPublicSurfaceView,
  resolvePublicSurface,
} from './generate-public-surface-assets.mjs';

const workspaceRoot = path.resolve(
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const topologyPath = path.join(workspaceRoot, 'topology/reference-topology.json');
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

function toEnvSegment(value) {
  return toKebabCase(value).replace(/-/gu, '_').toUpperCase();
}

function appNamespace(app) {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
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

function createPublicHead() {
  return {
    alternates: {
      hreflang: ['en', 'cs'],
      xDefault: 'en',
    },
  };
}

function createRpcProbe(app) {
  const id = `${app.id}-cloudflare-proof`;
  return {
    method: 'POST',
    body: { jsonrpc: '2.0', id, method: 'list', params: { limit: 1 } },
    expect: { id, 'result.items.0.id': `starter-${app.api.stem}` },
  };
}

function createWorkerBindingName(app) {
  return `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_WORKER`;
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
    publicSurface: app.routes?.publicSurface,
    ...(app.backendFederation
      ? { backendFederation: app.backendFederation }
      : {}),
    ...(app.serverExecution ? { serverExecution: app.serverExecution } : {}),
    ...(app.deliveryUnit ? { deliveryUnit: app.deliveryUnit } : {}),
  };
}

function createShellServiceBindingProof(app, apps) {
  if (app.kind !== 'shell') {
    return undefined;
  }

  const bindings = apps
    .filter(candidate => candidate.kind !== 'shell' && candidate.api)
    .map(candidate => {
      const rpc = candidate.cloudflare.routes?.rpc;
      return {
        appId: candidate.id,
        binding: createWorkerBindingName(candidate),
        route: rpc ?? candidate.cloudflare.routes?.apiReadiness,
        service: candidate.cloudflare.workerName,
        interface: 'fetch',
        ...(rpc
          ? createRpcProbe(candidate)
          : { expectedMarker: buildMarkerFor(candidate) }),
      };
    });

  return bindings.length > 0 ? bindings : undefined;
}

async function readGeneratedContractView() {
  const topology = readJson(topologyPath);
  const localOverlay = readJson(localOverlayPath);
  if (topology.schemaVersion !== 1 || !topology.shell || !Array.isArray(topology.verticals)) {
    throw new Error('Invalid topology/reference-topology.json');
  }
  const apps = [topology.shell, ...topology.verticals, ...(topology.shells ?? [])];
  const publicApps = new Map((await readPublicSurfaceView()).apps.map(app => [app.id, app]));
  return {
    sourcePath: topologyPath,
    apps: await Promise.all(apps.map(async app => {
      if (typeof app.path !== 'string' || !app.path || !app.cloudflare) {
        throw new Error(`${app.id} is missing its topology path or Cloudflare contract`);
      }
      const buildMarker = buildMarkerFor(app);
      const serviceBindings = createShellServiceBindingProof(app, apps);
      return {
        id: app.id,
        deploy: {
          cloudflare: {
            ...app.cloudflare,
            ...(serviceBindings ? { serviceBindings } : {}),
          },
        },
        i18n: { namespace: appNamespace(app) },
        marker: { appId: app.id, build: buildMarker },
        deliveryUnit: createDeliveryUnit({
          ...app,
          emitsUi: app.kind === 'shell' || app.surfaceProfile !== 'api-only',
        }),
        ...(app.backendFederation ? { backendFederation: app.backendFederation } : {}),
        ...(localOverlay.serverExecution?.[app.id]
          ? { serverExecution: localOverlay.serverExecution[app.id] }
          : {}),
        routes: {
          publicHead: createPublicHead(),
          publicSurface: await resolvePublicSurface(publicApps.get(app.id)),
        },
        styling: { federation: { rootSelector: `[data-app-id="${app.id}"]` } },
      };
    })),
  };
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
  ultramodern-create ultramodern cloudflare-proof [--app workspace] [--out evidence.json] [--require-public-urls]

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

  const contract = await readGeneratedContractView();
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
    contractPath: contract.sourcePath,
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
