import {
  type ModuleFederationValidationTarget,
  validateModuleFederationTypes,
} from '../../ultramodern-workspace/mf-validation';
import type { CommandContext } from './context';

function parseMfTypesArgs(args: string[]) {
  const appDirs: string[] = [];
  let target: ModuleFederationValidationTarget = 'node';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || arg === '--') {
      continue;
    }

    let targetValue: string | undefined;
    if (arg === '--target') {
      targetValue = args[index + 1];
      if (targetValue === undefined || targetValue.startsWith('-')) {
        throw new Error('--target needs a value.');
      }
      index += 1;
    } else if (arg.startsWith('--target=')) {
      targetValue = arg.slice('--target='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown mf-types option: ${arg}`);
    } else {
      appDirs.push(arg);
    }

    if (targetValue !== undefined) {
      if (targetValue !== 'node' && targetValue !== 'cloudflare') {
        throw new Error(
          `Invalid mf-types target "${targetValue}". Expected "node" or "cloudflare".`,
        );
      }
      target = targetValue;
    }
  }

  return { appDirs, target };
}

export function runMfTypes(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  ultramodern-create ultramodern mf-types [--target node|cloudflare] [app-dir...]

Checks real Module Federation config files and target-specific DTS archives for exposed apps.
`);
    return 0;
  }

  const { appDirs, target } = parseMfTypesArgs(args);
  validateModuleFederationTypes({
    workspaceRoot: context.workspaceRoot,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
    target,
  });
  return 0;
}
