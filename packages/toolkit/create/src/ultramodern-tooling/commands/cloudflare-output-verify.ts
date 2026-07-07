import path from 'node:path';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, runRenderedModule } from './context';
import { hasFlag, readOption } from './options';

interface CloudflareOutputVerifyTarget {
  label: string;
  outputDirectory: string;
}

const resolveCloudflareOutputVerifyTargets = (
  args: string[],
  context: CommandContext,
): CloudflareOutputVerifyTarget[] => {
  const outputDirectory = readOption(args, '--output');
  const appId = readOption(args, '--app');

  if (outputDirectory && appId) {
    throw new Error('Use either --app or --output, not both.');
  }

  const targets = outputDirectory
    ? [
        {
          label: outputDirectory,
          outputDirectory: path.resolve(context.invocationCwd, outputDirectory),
        },
      ]
    : workspaceAppsFromToolingConfig(
        readUltramodernConfig(context.workspaceRoot),
      )
        .filter(app => !appId || app.id === appId)
        .map(app => ({
          label: app.id,
          outputDirectory: path.join(
            context.workspaceRoot,
            app.directory,
            '.output',
          ),
        }));

  if (targets.length === 0) {
    throw new Error(`No generated UltraModern app matched ${appId}.`);
  }

  return targets;
};

const renderCloudflareOutputVerifyModule = ({
  workspaceRoot,
  targets,
  scanRoots,
  importWorker,
}: {
  workspaceRoot: string;
  targets: CloudflareOutputVerifyTarget[];
  scanRoots: string[];
  importWorker: boolean;
}) => `
import { createRequire } from 'node:module';
import path from 'node:path';

const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const targets = ${JSON.stringify(targets, null, 2)};
const scanRoots = ${JSON.stringify(scanRoots)};
const verifierRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const {
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} = verifierRequire('@modern-js/app-tools/cloudflare-output-verifier');

let failed = false;
for (const target of targets) {
  const result = await verifyCloudflareOutput({
    outputDirectory: target.outputDirectory,
    importWorker: ${JSON.stringify(importWorker)},
  });
  if (result.ok) {
    console.log(\`[ultramodern] Cloudflare output verified: \${target.label}\`);
  } else {
    failed = true;
    console.error(\`[ultramodern] Cloudflare output failed: \${target.label}\`);
    for (const issue of result.issues) {
      console.error(\`- \${issue.code}: \${issue.message}\${issue.path ? \` (\${issue.path})\` : ''}\`);
    }
  }
}

if (scanRoots.length > 0) {
  const policyResult = await verifyCloudflareOutputMutationPolicy({ scanRoots });
  if (!policyResult.ok) {
    failed = true;
    console.error('[ultramodern] generated-output mutation policy failed');
    for (const issue of policyResult.issues) {
      console.error(\`- \${issue.code}: \${issue.message}\${issue.path ? \` (\${issue.path})\` : ''}\`);
    }
  }
}

process.exit(failed ? 1 : 0);
`;

export function runCloudflareOutputVerify(
  args: string[],
  context: CommandContext,
) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern cloudflare-output-verify [--app <id> | --output <dir>] [--no-import-worker] [--no-source-scan]

Verifies generated Cloudflare output against the UltraModern worker contract.
Without --app or --output, every generated workspace app is verified.
`);
    return 0;
  }

  const source = renderCloudflareOutputVerifyModule({
    workspaceRoot: context.workspaceRoot,
    targets: resolveCloudflareOutputVerifyTargets(args, context),
    scanRoots: hasFlag(args, '--no-source-scan') ? [] : [context.workspaceRoot],
    importWorker: !hasFlag(args, '--no-import-worker'),
  });

  return runRenderedModule(source, context);
}
