import { validateWorkspace } from '../../ultramodern-workspace/validation/workspace';
import { createWorkspaceValidationContract } from '../../ultramodern-workspace/workspace-validation-contract';
import { readUltramodernWorkspaceInputs } from '../config';
import type { CommandContext } from './context';

export function runValidate(context: CommandContext) {
  const { config, verticals, primaryShell, additionalShells } =
    readUltramodernWorkspaceInputs(context.workspaceRoot);
  validateWorkspace(
    context.workspaceRoot,
    createWorkspaceValidationContract(
      config.workspace.packageScope,
      config.features.tailwind,
      verticals,
      additionalShells,
      primaryShell,
    ),
  );
  return 0;
}
