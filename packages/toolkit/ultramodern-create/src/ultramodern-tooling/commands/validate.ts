import { validateWorkspace } from '../../ultramodern-workspace/validation/workspace';
import { createWorkspaceValidationContract } from '../../ultramodern-workspace/workspace-validation-contract';
import { readResolvedUltramodernWorkspaceInputs } from '../config';
import type { CommandContext } from './context';

export async function runValidate(context: CommandContext) {
  const { config, raw, verticals, primaryShell, additionalShells } =
    await readResolvedUltramodernWorkspaceInputs(
      context.workspaceRoot,
      {},
      {
        command: 'validate',
        // This command checks authored development topology, not a deployment.
        env: 'development',
      },
    );
  validateWorkspace(
    context.workspaceRoot,
    createWorkspaceValidationContract(
      config.workspace.packageScope,
      config.features.tailwind,
      raw.topology.sharedPackages,
      verticals,
      additionalShells,
      primaryShell,
    ),
  );
  return 0;
}
