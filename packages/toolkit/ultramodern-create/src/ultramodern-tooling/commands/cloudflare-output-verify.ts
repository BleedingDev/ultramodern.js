import path from 'node:path';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, runRenderedModule } from './context';
import { readOption } from './options';

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
  excludePaths,
}: {
  workspaceRoot: string;
  targets: CloudflareOutputVerifyTarget[];
  excludePaths: string[];
}) => `
import { createRequire } from 'node:module';
import path from 'node:path';

const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const targets = ${JSON.stringify(targets, null, 2)};
const scanRoots = [workspaceRoot];
const excludePaths = ${JSON.stringify(excludePaths)};
const verifierRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const {
  verifyCloudflareOutput,
  verifyCloudflareOutputMutationPolicy,
} = verifierRequire('@modern-js/app-tools/cloudflare-output-verifier');

let failed = false;
for (const target of targets) {
  const result = await verifyCloudflareOutput({
    outputDirectory: target.outputDirectory,
    importWorker: true,
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
  const policyResult = await verifyCloudflareOutputMutationPolicy({ scanRoots, excludePaths });
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
  ultramodern-create ultramodern cloudflare-output-verify [--app <id> | --output <dir>]

Verifies generated Cloudflare output against the UltraModern worker contract.
Without --app or --output, every generated workspace app is verified.
`);
    return 0;
  }

  const source = renderCloudflareOutputVerifyModule({
    workspaceRoot: context.workspaceRoot,
    targets: resolveCloudflareOutputVerifyTargets(args, context),
    // The generated validation-contract validator is a read-only proof artifact
    // whose embedded contract records generated-output paths as data; exclude it
    // from the mutation scan so those literals are not misread as a rewrite.
    excludePaths: [
      path.join(
        context.workspaceRoot,
        'scripts',
        'validate-ultramodern-workspace.mts',
      ),
    ],
  });

  return runRenderedModule(source, context);
}
