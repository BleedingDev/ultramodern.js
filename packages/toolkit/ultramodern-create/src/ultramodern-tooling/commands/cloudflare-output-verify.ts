import { createRequire } from 'node:module';
import path from 'node:path';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import type { CommandContext } from './context';
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
        context.workspaceRoot,
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

export async function runCloudflareOutputVerify(
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

  const targets = resolveCloudflareOutputVerifyTargets(args, context);
  const verifierRequire = createRequire(
    path.join(context.workspaceRoot, 'package.json'),
  );
  const { verifyCloudflareOutput, verifyCloudflareOutputMutationPolicy } =
    verifierRequire(
      '@modern-js/app-tools-extensions/cloudflare-output-verifier',
    ) as typeof import('@modern-js/app-tools-extensions/cloudflare-output-verifier');
  let failed = false;
  for (const target of targets) {
    const result = await verifyCloudflareOutput({
      outputDirectory: target.outputDirectory,
      importWorker: true,
    });
    if (result.ok) {
      console.log(`[ultramodern] Cloudflare output verified: ${target.label}`);
    } else {
      failed = true;
      console.error(`[ultramodern] Cloudflare output failed: ${target.label}`);
      for (const issue of result.issues) {
        console.error(
          `- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`,
        );
      }
    }
  }
  const policyResult = await verifyCloudflareOutputMutationPolicy({
    scanRoots: [context.workspaceRoot],
    excludePaths: [],
  });
  if (!policyResult.ok) {
    failed = true;
    console.error('[ultramodern] generated-output mutation policy failed');
    for (const issue of policyResult.issues) {
      console.error(
        `- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`,
      );
    }
  }
  return failed ? 1 : 0;
}
