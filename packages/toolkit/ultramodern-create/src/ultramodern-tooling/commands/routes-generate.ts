import path from 'node:path';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, runRenderedModule } from './context';
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

const renderRoutesGenerateModule = ({
  workspaceRoot,
  targets,
}: {
  workspaceRoot: string;
  targets: RoutesGenerateTarget[];
}) => `
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const targets = ${JSON.stringify(targets, null, 2)};
const appRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const pluginUrl = pathToFileURL(
  appRequire.resolve('@modern-js/plugin-tanstack'),
).href;
const { generateTanstackRouteArtifacts } = await import(pluginUrl);

let failed = false;
// Sequential — the app-tools cli singleton is not re-entrant.
for (const target of targets) {
  try {
    await generateTanstackRouteArtifacts({ appDirectory: target.appDirectory });
    console.log(\`[ultramodern] TanStack route artifacts generated: \${target.label}\`);
  } catch (error) {
    failed = true;
    console.error(\`[ultramodern] TanStack route generation failed: \${target.label}\`);
    // Print the full underlying failure, including the cause chain. The
    // route-generate crash is often an opaque node error thrown deep inside
    // app-tools/plugin (e.g. a path TypeError), so surfacing only
    // \`error.message\` swallows the stack that points at the real culprit.
    let current = error;
    let depth = 0;
    while (current) {
      const label = depth === 0 ? '-' : '  caused by:';
      const detail =
        current instanceof Error
          ? current.stack ?? \`\${current.name}: \${current.message}\`
          : String(current);
      console.error(\`\${label} \${detail}\`);
      current = current instanceof Error ? current.cause : undefined;
      depth += 1;
    }
  }
}

process.exit(failed ? 1 : 0);
`;

export function runRoutesGenerate(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  ultramodern-create ultramodern routes-generate [--app <id>]

Regenerates TanStack route artifacts (router.gen.ts, register.gen.d.ts) for
generated UltraModern apps without running dev or build. Without --app, every
generated workspace app is regenerated.
`);
    return 0;
  }

  const source = renderRoutesGenerateModule({
    workspaceRoot: context.workspaceRoot,
    targets: resolveRoutesGenerateTargets(args, context),
  });

  return runRenderedModule(source, context);
}
