import { validateModuleFederationTypes } from '../../ultramodern-workspace/mf-validation';
import type { CommandContext } from './context';

export function runMfTypes(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  ultramodern-create ultramodern mf-types [app-dir...]

Checks real Module Federation config files and DTS archives for exposed apps.
`);
    return 0;
  }

  validateModuleFederationTypes({
    workspaceRoot: context.workspaceRoot,
    appDirs: args.length > 0 ? args : undefined,
  });
  return 0;
}
