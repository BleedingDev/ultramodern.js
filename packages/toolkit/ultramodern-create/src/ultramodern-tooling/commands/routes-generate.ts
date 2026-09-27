import path from 'node:path';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, spawnNodeScript } from './context';
import { readOption } from './options';

interface RoutesGenerateTarget {
  label: string;
  appDirectory: string;
}

const resolveRoutesGenerateTargets = (
  args: string[],
  context: CommandContext,
): RoutesGenerateTarget[] => {
  const appId = readOption(args, '--app');

  const targets = workspaceAppsFromToolingConfig(
    readUltramodernConfig(context.workspaceRoot),
    context.workspaceRoot,
  )
    .filter(app => !appId || app.id === appId)
    .map(app => ({
      label: app.id,
      appDirectory: path.join(context.workspaceRoot, app.directory),
    }));

  if (targets.length === 0) {
    throw new Error(
      `No generated UltraModern app matched ${appId ?? '<any>'}.`,
    );
  }

  return targets;
};

export function runRoutesGenerate(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  ultramodern-create ultramodern routes-generate [--app <id>] [--manifest-only]

Regenerates src/routes/ultramodern-route-metadata.ts from the app's
route.meta.ts files and the TanStack route artifacts (router.gen.ts,
register.gen.d.ts) for generated UltraModern apps without running dev or build.
Without --app, every generated workspace app is regenerated.

--manifest-only writes only the route metadata manifest. It never loads the
app config, so app dev and build scripts run it before \`modern dev\` and
\`modern build\`, which regenerate the router artifacts themselves.
`);
    return 0;
  }

  const targets = resolveRoutesGenerateTargets(args, context);
  const mode = args.includes('--manifest-only') ? 'manifest' : 'all';
  let failed = false;
  // app-tools and its plugins keep process-global state, including import-time
  // cwd. Each app gets a fresh module graph rooted at its own directory.
  for (const target of targets) {
    const status = spawnNodeScript(
      'dist/esm-node/ultramodern-tooling/commands/routes-generate-app.js',
      [target.appDirectory, target.label, mode],
      context,
      { cwd: target.appDirectory },
    );
    failed ||= status !== 0;
  }
  return failed ? 1 : 0;
}
