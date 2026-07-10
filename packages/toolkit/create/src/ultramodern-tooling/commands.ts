import path from 'node:path';
import { GENERATED_TOOLING_COMMANDS } from '../ultramodern-workspace/tooling-command-catalog';
import { runCloudflareOutputVerify } from './commands/cloudflare-output-verify';
import {
  type CommandContext,
  printHelp,
  runTemplateBackedToolingCommand,
} from './commands/context';
import { runMfTypes } from './commands/mf-types';
import { runMigrateStrictEffect } from './commands/migrate-strict-effect';
import { runRoutesGenerate } from './commands/routes-generate';
import { runSkills } from './commands/skills';
import { runSyncDeliveryUnit } from './commands/sync-delivery-unit';
import { runValidate } from './commands/validate';

export async function runUltramodernToolingCli(
  args: string[],
  workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd(),
): Promise<number> {
  try {
    const [command, ...rest] = args;
    const context = {
      workspaceRoot: path.resolve(workspaceRoot),
      invocationCwd: process.cwd(),
    };

    switch (command) {
      case undefined:
      case '--help':
      case '-h':
        printHelp();
        return 0;
      case GENERATED_TOOLING_COMMANDS.validate.command:
        return runValidate(context);
      case GENERATED_TOOLING_COMMANDS.mfTypes.command:
        return runMfTypes(rest, context);
      case GENERATED_TOOLING_COMMANDS.migrateStrictEffect.command:
        return await runMigrateStrictEffect(rest, context);
      case GENERATED_TOOLING_COMMANDS.cloudflareOutputVerify.command:
        return runCloudflareOutputVerify(rest, context);
      case GENERATED_TOOLING_COMMANDS.routesGenerate.command:
        return runRoutesGenerate(rest, context);
      case 'sync-delivery-unit':
        return runSyncDeliveryUnit(rest, context);
      case 'skills':
        return runSkills(rest, context);
      default:
        {
          const templateBackedStatus = runTemplateBackedToolingCommand(
            command ?? '',
            rest,
            context,
          );
          if (templateBackedStatus !== undefined) {
            return templateBackedStatus;
          }
        }
        throw new Error(`Unknown UltraModern command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ultramodern] ${message}\n`);
    return 1;
  }
}
