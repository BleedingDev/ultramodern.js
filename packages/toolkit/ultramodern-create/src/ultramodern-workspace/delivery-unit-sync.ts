import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  readResolvedUltramodernWorkspaceInputs,
  readUltramodernWorkspaceInputs,
} from '../ultramodern-tooling/config';
import { runWorkspaceTransaction } from './add-vertical/transaction';
import {
  isPlainObject,
  stampDeliveryUnitIdentity,
} from './delivery-unit-stamp';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from './module-federation';
import { captureWorkspaceRendererEvaluations } from './renderer-config-evaluation';

type SyncContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

function writeTextIfChanged(absolutePath: string, content: string): boolean {
  if (
    fs.existsSync(absolutePath) &&
    fs.readFileSync(absolutePath, 'utf8') === content
  )
    return false;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
  return true;
}

/** Rebuild owned local identity projections from authoritative app configs. */
export async function runSyncDeliveryUnit(
  args: string[],
  context: SyncContext,
): Promise<number> {
  const parsed = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      workspace: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  if (parsed.values.help) {
    process.stdout.write(`Usage:
  ultramodern-create ultramodern sync-delivery-unit [--workspace <dir>]

Resolve each application's modern.config, then atomically regenerate local
renderer and delivery-unit identities in topology and shared build artifacts.
Headless units have no UI identity. Authored source configs are preserved.
`);
    return 0;
  }
  const workspaceRoot = parsed.values.workspace
    ? path.resolve(context.invocationCwd, parsed.values.workspace)
    : context.workspaceRoot;
  const originalWorkspace = readUltramodernWorkspaceInputs(workspaceRoot);
  const evaluations = await captureWorkspaceRendererEvaluations(
    workspaceRoot,
    originalWorkspace.apps,
  );
  const { written, unchanged } = await runWorkspaceTransaction(
    workspaceRoot,
    async stagingRoot => {
      const workspace = await readResolvedUltramodernWorkspaceInputs(
        stagingRoot,
        {},
        { evaluations },
      );
      const scope = workspace.config.workspace.packageScope;
      const appById = new Map(workspace.apps.map(app => [app.id, app]));
      const written: string[] = [];
      const unchanged: string[] = [];
      const track = (relativePath: string, content: string) => {
        const changed = writeTextIfChanged(
          path.join(stagingRoot, relativePath),
          content,
        );
        (changed ? written : unchanged).push(relativePath);
      };
      const topology = workspace.raw.topology;
      for (const entry of [
        topology.shell,
        ...topology.verticals,
        ...(topology.shells ?? []),
      ]) {
        if (!isPlainObject(entry))
          throw new Error('Invalid topology application record.');
        const app = appById.get(entry.id);
        if (!app)
          throw new Error(`Unknown topology application: ${String(entry.id)}.`);
        stampDeliveryUnitIdentity(
          entry,
          scope,
          app,
          app.deliveryUnit!.version!,
        );
      }
      track(
        'topology/reference-topology.json',
        `${JSON.stringify(topology, null, 2)}\n`,
      );
      for (const app of workspace.apps) {
        track(
          path.join(app.directory, 'shared/ultramodern-build.ts'),
          createUltramodernBuildModule(scope, app),
        );
        track(
          path.join(app.directory, 'shared/ultramodern-build.json'),
          createUltramodernBuildArtifactJson(scope, app),
        );
      }
      return { written, unchanged };
    },
  );

  if (!written.length) {
    process.stdout.write(
      '[ultramodern] sync-delivery-unit: already in sync; no files written.\n',
    );
  } else {
    process.stdout.write(
      `[ultramodern] sync-delivery-unit: wrote ${written.length} file(s):\n`,
    );
    for (const relativePath of written)
      process.stdout.write(`  wrote    ${relativePath}\n`);
    for (const relativePath of unchanged)
      process.stdout.write(`  in-sync  ${relativePath}\n`);
  }
  return 0;
}
