#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
);
const configPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');
const contractVersion = 'microvertical-server-effect-v1';
const nodeAdapterVersion = 'backend-mf-effect-v1';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readBuildIdentity(app) {
  const buildArtifactPath = path.join(
    workspaceRoot,
    app.path,
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
    app.path,
    'shared/ultramodern-build.ts',
  );
  if (!fs.existsSync(buildModulePath)) {
    return {};
  }
  console.warn(
    `[backend-federation] ${path.relative(
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

function parseArgs(argv) {
  const options = {
    app: undefined,
    target: 'dist',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') {
      options.app = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--target') {
      options.target = argv[index + 1] ?? options.target;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/generate-node-backend-federation.mts [--app <id>] [--target dist|dist-cloudflare]',
      );
      process.exit(0);
    }
  }
  return options;
}

function backendApps(config, appFilter) {
  return (config.topology?.apps ?? []).filter(app => {
    if (app.kind !== 'vertical') {
      return false;
    }
    if (!backendFederationMetadata(app)) {
      return false;
    }
    return appFilter ? app.id === appFilter : true;
  });
}

function backendFederationMetadata(app) {
  return app.backendFederation ?? app.api?.backendFederation;
}

function backendFederationExposes(app) {
  const backend = backendFederationMetadata(app);
  const exposes = Array.isArray(backend.exposes)
    ? backend.exposes.filter(expose => typeof expose === 'string')
    : backend.exposes &&
        typeof backend.exposes === 'object' &&
        !Array.isArray(backend.exposes)
      ? Object.keys(backend.exposes)
    : [];

  if (exposes.length > 0) {
    return exposes;
  }

  if (typeof backend.expose === 'string') {
    return [backend.expose];
  }

  throw new Error(`${app.id} backend federation expose metadata is missing`);
}

function normalizeBackendFederation(app) {
  const backend = backendFederationMetadata(app);
  const nodeSurface = backend.executionSurfaces?.node ?? {};
  const exposes = backendFederationExposes(app);

  return {
    ...backend,
    name: backend.name ?? nodeSurface.remoteName,
    remoteType: backend.remoteType ?? nodeSurface.remoteType ?? 'module',
    manifestUrl: backend.manifestUrl ?? nodeSurface.manifestUrl,
    containerEntry: backend.containerEntry ?? nodeSurface.containerEntry,
    runtimePackage: backend.runtimePackage ?? nodeSurface.runtimePackage,
    contractVersion:
      backend.contractVersion ??
      backend.compatibility?.contractVersion ??
      contractVersion,
    nodeAdapterVersion:
      backend.nodeAdapterVersion ?? nodeSurface.adapterVersion ?? nodeAdapterVersion,
    expose:
      typeof backend.expose === 'string'
        ? backend.expose
        : (nodeSurface.expose ?? exposes[0]),
    exposes,
  };
}

function createRemoteEntrySource(app) {
  const exposes = backendFederationExposes(app);
  return `const factories = {
${exposes
  .map(
    expose => `${JSON.stringify(expose)}: async () =>
  import(new URL('../api/backend-federation.ts', import.meta.url).href),
`,
  )
  .join('')}
};

export async function init() {}

export function get(id) {
  const factory = factories[id];
  if (!factory) {
    throw new Error(\`Unknown backend federation expose \${id}\`);
  }
  return factory;
}

export default { init, get };
`;
}

function createManifest(app) {
  const backend = normalizeBackendFederation(app);
  const buildIdentity = readBuildIdentity(app);
  const compactDeliveryUnit =
    app.deliveryUnit && typeof app.deliveryUnit === 'object'
      ? app.deliveryUnit
      : undefined;
  const unitId = compactDeliveryUnit?.unitId ?? buildIdentity.unitId;
  const sourceRevision =
    compactDeliveryUnit?.sourceRevision ?? buildIdentity.sourceRevision;
  return {
    schemaVersion: 1,
    name: backend.name,
    id: backend.name,
    version: buildIdentity.version,
    buildVersion: buildIdentity.buildVersion,
    type: backend.remoteType,
    entry: {
      url: backend.containerEntry,
      type: backend.remoteType,
    },
    metaData: {
      name: backend.name,
      type: backend.remoteType,
      buildInfo: {
        buildName: buildIdentity.packageName,
        buildVersion: buildIdentity.buildVersion,
      },
      remoteEntry: {
        name: 'backendRemoteEntry.mjs',
        path: '',
        type: backend.remoteType,
      },
        exposes: backend.exposes.map(expose => ({
          id: expose,
          name: expose,
        path: expose,
      })),
    },
    exposes: backend.exposes.map(expose => ({
      id: expose,
      name: expose,
      path: expose,
    })),
    backendFederation: {
      role: backend.role ?? 'microvertical-server',
      name: backend.name,
      runtimeFramework: backend.runtimeFramework ?? 'effect',
      strictEffectApproach: backend.strictEffectApproach ?? true,
      contractVersion: backend.contractVersion,
      nodeAdapterVersion: backend.nodeAdapterVersion,
      manifestUrl: backend.manifestUrl,
      containerEntry: backend.containerEntry,
      expose: backend.expose,
      runtimePackage: backend.runtimePackage,
      ...(unitId && buildIdentity.buildVersion
        ? {
            deliveryUnit: {
              schemaVersion: 1,
              kind: 'microvertical-delivery-unit',
              unitId,
              packageName: buildIdentity.packageName,
              version: buildIdentity.version,
              buildMarker: buildIdentity.buildVersion,
              sourceRevision,
            },
          }
        : {}),
      versionBoundary: {
        packageName: buildIdentity.packageName,
        version: buildIdentity.version,
        buildVersion: buildIdentity.buildVersion,
        ...(unitId && buildIdentity.buildVersion
          ? {
              deliveryUnit: {
                unitId,
                buildMarker: buildIdentity.buildVersion,
              },
            }
          : {}),
      },
    },
  };
}

const options = parseArgs(process.argv.slice(2));
const config = readJson(configPath);
const apps = backendApps(config, options.app);

if (options.app && apps.length === 0) {
  throw new Error(`No generated backend federation app matched ${options.app}`);
}

for (const app of apps) {
  const outputDir = path.join(workspaceRoot, app.path, options.target);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'backendRemoteEntry.mjs'),
    createRemoteEntrySource(app),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(outputDir, 'backend-mf-manifest.json'),
    `${JSON.stringify(createManifest(app), null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `[ultramodern] generated backend federation artifacts for ${app.id} in ${path.relative(
      workspaceRoot,
      outputDir,
    )}`,
  );
}

if (apps.length === 0) {
  console.log('[ultramodern] no backend federation apps to generate');
}
