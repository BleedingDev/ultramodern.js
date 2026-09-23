import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readUltramodernWorkspaceInputs } from '../ultramodern-tooling/config';
import { createBuildMarker } from './delivery-unit';
import {
  isPlainObject,
  stampDeliveryUnitIdentity,
} from './delivery-unit-stamp';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from './module-federation';

const REFERENCE_TOPOLOGY_PATH = 'topology/reference-topology.json';

type SyncContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

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
  ultramodern-create ultramodern sync-delivery-unit [--workspace <dir>]

Backfills the per-delivery-unit identity blocks required by
\`ultramodern validate\` onto an existing generated workspace, in place and
through framework tooling only. For each delivery unit it writes the
delivery-unit block into topology/reference-topology.json shell/verticals/shells
(plus backendFederation.deliveryUnit
and backendFederation.versionBoundary.identityRoot) and regenerates
<app>/shared/ultramodern-build.{json,ts}. Idempotent: a second run writes
nothing.
`);
    return 0;
  }

  const workspaceOverride = parsed.values.workspace;
  const workspaceRoot = workspaceOverride
    ? path.resolve(context.invocationCwd, workspaceOverride)
    : context.workspaceRoot;

  const workspace = readUltramodernWorkspaceInputs(workspaceRoot);
  const scope = workspace.config.workspace.packageScope;
  // Delivery-unit identity applies to ALL unit kinds (G29): shell, UI-only
  // verticals, and API-bearing verticals each carry a record.
  const packageVersions = new Map<string, string>();
  const workspaceApps = workspace.apps.map(app => {
    const manifestPath = path.join(
      workspaceRoot,
      app.directory,
      'package.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error(
        `${manifestPath} requires a package version for delivery-unit sync.`,
      );
    }
    packageVersions.set(app.id, manifest.version);
    return {
      ...app,
      deliveryUnit: {
        ...app.deliveryUnit,
        version: manifest.version,
        buildMarker: createBuildMarker(scope, app, manifest.version),
      },
    };
  });

  const written: string[] = [];
  const unchanged: string[] = [];
  const track = (relativePath: string, changed: boolean) => {
    (changed ? written : unchanged).push(relativePath);
  };

  const appById = new Map(workspaceApps.map(app => [app.id, app]));

  // Topology contains the canonical delivery-unit declarations.
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
          stampDeliveryUnitIdentity(
            entry,
            scope,
            app,
            packageVersions.get(app.id)!,
          );
        }
      }
    }
    if (isPlainObject(topology) && Array.isArray(topology.shells)) {
      for (const entry of topology.shells) {
        if (!isPlainObject(entry)) continue;
        const app = appById.get(String(entry.id));
        if (app)
          stampDeliveryUnitIdentity(
            entry,
            scope,
            app,
            packageVersions.get(app.id)!,
          );
      }
    }
    // The shell is its own delivery unit (G29): stamp its identity block too.
    if (isPlainObject(topology) && isPlainObject(topology.shell)) {
      const shell = appById.get(String(topology.shell.id));
      if (shell) {
        stampDeliveryUnitIdentity(
          topology.shell,
          scope,
          shell,
          packageVersions.get(shell.id)!,
        );
      }
    }
    track(REFERENCE_TOPOLOGY_PATH, writeJsonIfChanged(topologyPath, topology));
  }

  // <app>/shared/ultramodern-build.{json,ts} for every unit kind
  // (framework-owned; regenerate from canonical descriptors)
  for (const app of workspaceApps) {
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
