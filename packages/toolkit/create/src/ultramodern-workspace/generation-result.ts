import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createDeliveryUnitRecord } from './delivery-unit';
import type {
  DeliveryUnitDescriptor,
  SurfaceDescriptor,
} from './delivery-unit-schema/types';
import { exposeSurface } from './delivery-unit-schema/up-projection';
import { appHasApi, ULTRAMODERN_CONFIG_PATH } from './descriptors';
import { normalizePath, packageName } from './naming';
import type {
  ResolvedPackageSource,
  UltramodernGeneratedAppDescriptor,
  UltramodernGenerationOperation,
  UltramodernGenerationResult,
  UltramodernGenerationWarning,
  WorkspaceApp,
} from './types';
import { resolveOwnerAttribution } from './types';
import {
  EFFECT_VERSION,
  REACT_VERSION,
  TAILWIND_VERSION,
  TANSTACK_ROUTER_VERSION,
} from './versions';

/** Opaque, stable id for the current platform baseline cohort (G1d). */
const BASELINE_COHORT_ID = 'ultramodern-platform-baseline-v1';

export const ignoredSnapshotDirectories = new Set([
  '.git',
  '.nx',
  '.output',
  'coverage',
  'dist',
  'node_modules',
]);

type FileSnapshot = Map<string, string>;

export function createFileSnapshot(root: string): FileSnapshot {
  const files: FileSnapshot = new Map();

  if (!fs.existsSync(root)) {
    return files;
  }

  function collect(currentDir: string) {
    for (const entry of fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && ignoredSnapshotDirectories.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        const relativePath = normalizePath(path.relative(root, entryPath));
        files.set(relativePath, hashFile(entryPath));
      }
    }
  }

  collect(root);
  return files;
}

export function diffFileSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): Pick<UltramodernGenerationResult, 'createdPaths' | 'rewrittenPaths'> {
  const createdPaths: string[] = [];
  const rewrittenPaths: string[] = [];

  for (const [relativePath, hash] of after) {
    const previousHash = before.get(relativePath);
    if (previousHash === undefined) {
      createdPaths.push(relativePath);
    } else if (previousHash !== hash) {
      rewrittenPaths.push(relativePath);
    }
  }

  return {
    createdPaths: createdPaths.sort(),
    rewrittenPaths: rewrittenPaths.sort(),
  };
}

export function createGenerationResult(options: {
  operation: UltramodernGenerationOperation;
  workspaceRoot: string;
  packageScope: string;
  packageSource: ResolvedPackageSource;
  createdApps: WorkspaceApp[];
  createdPaths: string[];
  rewrittenPaths: string[];
  warnings?: UltramodernGenerationWarning[];
}): UltramodernGenerationResult {
  const createdApps = options.createdApps.map(app =>
    createGeneratedAppDescriptor(options.packageScope, app),
  );

  return {
    operation: options.operation,
    workspaceRoot: options.workspaceRoot,
    packageScope: options.packageScope,
    packageSource: { ...options.packageSource },
    createdApps,
    createdPaths: [...options.createdPaths].sort(),
    rewrittenPaths: [...options.rewrittenPaths].sort(),
    assignedPorts: Object.fromEntries(
      createdApps.map(app => [app.id, app.port]),
    ),
    moduleFederationNames: Object.fromEntries(
      createdApps.map(app => [app.id, app.moduleFederationName]),
    ),
    apiPrefixes: Object.fromEntries(
      createdApps
        .filter(app => app.apiPrefix)
        .map(app => [app.id, app.apiPrefix as string]),
    ),
    generatedContractPath: ULTRAMODERN_CONFIG_PATH,
    warnings: options.warnings ?? [],
    deliveryUnits: options.createdApps.map(app =>
      createGeneratedDeliveryUnitDescriptor(options.packageScope, app),
    ),
  };
}

/**
 * Build the canonical {@link DeliveryUnitDescriptor} for a generated app (G1d).
 * Identity (`unitId` / `buildMarker` / `sourceRevision`) is taken straight from
 * {@link createDeliveryUnitRecord} — the same function the emitted delivery-unit
 * records use in the same process — so the exposed descriptor matches the
 * records on disk. Every app kind (shell, UI-only vertical, api vertical)
 * carries a descriptor; down-projecting one reproduces the v1 identity.
 */
function createGeneratedDeliveryUnitDescriptor(
  scope: string,
  app: WorkspaceApp,
): DeliveryUnitDescriptor {
  const record = createDeliveryUnitRecord(scope, app);
  // Expose keys (e.g. `./Cart`) are MF module specifiers, not grammar-valid
  // SurfaceRef segments. Reuse the up-projection's expose mapper so the
  // exposed surfaceId is sanitized to the SurfaceRef grammar AND classified
  // (route vs component) by the same rule the canonical up-projection uses.
  const surfaces: SurfaceDescriptor[] = Object.entries(app.exposes ?? {}).map(
    ([key, value]) => exposeSurface(app, key, value),
  );
  if (appHasApi(app)) {
    surfaces.push({
      kind: 'api',
      surfaceId: app.api.stem,
      protocol: app.api.protocol ?? 'rest',
      locations: [{ platform: 'http', address: app.api.prefix }],
    });
  }

  const canonicalKind: DeliveryUnitDescriptor['kind'] =
    app.kind === 'shell' ? 'shell' : (app.deliveryUnitKind ?? 'microvertical');

  return {
    unitId: record.unitId,
    kind: canonicalKind,
    owner: resolveOwnerAttribution(app.ownership),
    sourceRevision: record.sourceRevision,
    buildMarker: record.buildMarker,
    baselineCohort: {
      cohortId: BASELINE_COHORT_ID,
      resolved: {
        react: REACT_VERSION,
        tanstackRouter: TANSTACK_ROUTER_VERSION,
        effect: EFFECT_VERSION,
        tailwind: TAILWIND_VERSION,
      },
    },
    surfaces,
  };
}

function createGeneratedAppDescriptor(
  scope: string,
  app: WorkspaceApp,
): UltramodernGeneratedAppDescriptor {
  return {
    id: app.id,
    directory: app.directory,
    packageName: packageName(scope, app.packageSuffix),
    packageSuffix: app.packageSuffix,
    displayName: app.displayName,
    kind: app.kind,
    portEnv: app.portEnv,
    port: app.port,
    moduleFederationName: app.mfName,
    ...(app.exposes ? { exposes: { ...app.exposes } } : {}),
    ...(appHasApi(app) ? { apiPrefix: app.api.prefix } : {}),
  };
}

function hashFile(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}
