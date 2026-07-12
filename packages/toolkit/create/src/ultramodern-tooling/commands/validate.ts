import { readWorkspaceReleaseCohort } from '../../ultramodern-release-cohort';
import { createWorkspaceValidationScript } from '../../ultramodern-workspace/workspace-scripts';
import {
  additionalShellsFromToolingConfig,
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, runRenderedModule } from './context';

export function runValidate(context: CommandContext) {
  const config = readUltramodernConfig(context.workspaceRoot);
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const primaryShell = apps.find(app => app.kind === 'shell');
  const additionalShells = additionalShellsFromToolingConfig(config);
  const releaseCohort =
    config.packageSource?.strategy === 'install'
      ? readWorkspaceReleaseCohort(context.workspaceRoot)
      : undefined;
  const source = createWorkspaceValidationScript(
    config.workspace.packageScope,
    config.features.tailwind,
    remotes,
    releaseCohort,
    additionalShells,
    primaryShell,
  );

  return runRenderedModule(source, context);
}
