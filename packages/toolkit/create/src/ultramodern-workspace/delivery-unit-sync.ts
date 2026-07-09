import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../ultramodern-tooling/config';
import { createBackendFederationContract } from './backend-federation';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import { ULTRAMODERN_CONFIG_PATH } from './descriptors';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from './module-federation';
import type { WorkspaceApp } from './types';

const REFERENCE_TOPOLOGY_PATH = 'topology/reference-topology.json';

type SyncContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeTextIfChanged(absolutePath: string, content: string): boolean {
  if (
    fs.existsSync(absolutePath) &&
    fs.readFileSync(absolutePath, 'utf-8') === content
  ) {
    return false;
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf-8');
  return true;
}

function writeJsonIfChanged(absolutePath: string, value: unknown): boolean {
  return writeTextIfChanged(
    absolutePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/**
 * Stamp the delivery-unit identity blocks onto a single topology entry
 * (either a compact-config `topology.apps[]` app or a
 * `reference-topology.json` `verticals[]` vertical). The mutation is
 * surgical: existing backend-federation fields are preserved and only the
 * delivery-unit identity is (re)written, so a second run is a no-op.
 */
function stampDeliveryUnitIdentity(
  entry: Record<string, any>,
  scope: string,
  app: WorkspaceApp,
): void {
  const block = deliveryUnitContractBlock(createDeliveryUnitRecord(scope, app));

  entry.deliveryUnit = block;

  if (isPlainObject(entry.backendFederation)) {
    entry.backendFederation.deliveryUnit = block;
    if (!isPlainObject(entry.backendFederation.versionBoundary)) {
      entry.backendFederation.versionBoundary = {};
    }
    entry.backendFederation.versionBoundary.identityRoot = 'deliveryUnit';
  } else {
    // No backend-federation block present at all: materialise the canonical
    // one, which already carries the delivery-unit identity + identityRoot.
    entry.backendFederation = createBackendFederationContract(scope, app);
  }
}

export function runSyncDeliveryUnit(
  args: string[],
  context: SyncContext,
): number {
  const parsed = parseArgs({
    args,
    options: {
      help: {
        type: 'boolean',
        short: 'h',
      },
      workspace: {
        type: 'string',
      },
    },
    strict: true,
    allowPositionals: false,
  });

  if (parsed.values.help) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern sync-delivery-unit [--workspace <dir>]

Backfills the per-vertical delivery-unit identity blocks required by
\`ultramodern validate\` onto an existing generated workspace, in place and
through framework tooling only. For each full-stack vertical it writes the
delivery-unit block into .modernjs/ultramodern.json topology.apps[] and
topology/reference-topology.json verticals[] (plus backendFederation.deliveryUnit
and backendFederation.versionBoundary.identityRoot) and regenerates
verticals/<id>/shared/ultramodern-build.{json,ts}. Idempotent: a second run writes
nothing.
`);
    return 0;
  }

  const workspaceOverride = parsed.values.workspace;
  const workspaceRoot = workspaceOverride
    ? path.resolve(context.invocationCwd, workspaceOverride)
    : context.workspaceRoot;

  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  if (!fs.existsSync(compactPath)) {
    throw new Error(
      `Missing ${ULTRAMODERN_CONFIG_PATH}. sync-delivery-unit needs the compact ` +
        'UltraModern config; run `modern-js-create ultramodern migrate-strict-effect` first.',
    );
  }

  const config = readUltramodernConfig(workspaceRoot);
  const scope = config.workspace.packageScope;
  const apiApps = workspaceAppsFromToolingConfig(config).filter(app =>
    Boolean(app.api),
  );

  const written: string[] = [];
  const unchanged: string[] = [];
  const track = (relativePath: string, changed: boolean) => {
    (changed ? written : unchanged).push(relativePath);
  };

  const appById = new Map(apiApps.map(app => [app.id, app]));

  // (1) .modernjs/ultramodern.json topology.apps[]
  const compact = JSON.parse(fs.readFileSync(compactPath, 'utf-8'));
  if (isPlainObject(compact) && Array.isArray(compact.topology?.apps)) {
    for (const entry of compact.topology.apps) {
      if (!isPlainObject(entry)) {
        continue;
      }
      const app = appById.get(String(entry.id));
      if (app) {
        stampDeliveryUnitIdentity(entry, scope, app);
      }
    }
  }
  track(ULTRAMODERN_CONFIG_PATH, writeJsonIfChanged(compactPath, compact));

  // (2) topology/reference-topology.json verticals[]
  const topologyPath = path.join(workspaceRoot, REFERENCE_TOPOLOGY_PATH);
  if (fs.existsSync(topologyPath)) {
    const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf-8'));
    if (isPlainObject(topology) && Array.isArray(topology.verticals)) {
      for (const entry of topology.verticals) {
        if (!isPlainObject(entry)) {
          continue;
        }
        const app = appById.get(String(entry.id));
        if (app) {
          stampDeliveryUnitIdentity(entry, scope, app);
        }
      }
    }
    track(REFERENCE_TOPOLOGY_PATH, writeJsonIfChanged(topologyPath, topology));
  }

  // (3) verticals/<id>/shared/ultramodern-build.{json,ts}
  // (framework-owned; regenerate from canonical descriptors)
  for (const app of apiApps) {
    const buildModulePath = path.join(
      app.directory,
      'shared/ultramodern-build.ts',
    );
    const buildArtifactPath = path.join(
      app.directory,
      'shared/ultramodern-build.json',
    );
    track(
      buildModulePath,
      writeTextIfChanged(
        path.join(workspaceRoot, buildModulePath),
        createUltramodernBuildModule(scope, app),
      ),
    );
    track(
      buildArtifactPath,
      writeTextIfChanged(
        path.join(workspaceRoot, buildArtifactPath),
        createUltramodernBuildArtifactJson(scope, app),
      ),
    );
  }

  if (written.length === 0) {
    process.stdout.write(
      '[ultramodern] sync-delivery-unit: already in sync; no files written.\n',
    );
  } else {
    process.stdout.write(
      `[ultramodern] sync-delivery-unit: wrote ${written.length} file(s):\n`,
    );
    for (const relativePath of written) {
      process.stdout.write(`  wrote    ${relativePath}\n`);
    }
    for (const relativePath of unchanged) {
      process.stdout.write(`  in-sync  ${relativePath}\n`);
    }
  }

  return 0;
}
