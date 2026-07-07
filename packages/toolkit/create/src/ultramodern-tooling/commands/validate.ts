import { createWorkspaceValidationScript } from '../../ultramodern-workspace/workspace-scripts';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import { type CommandContext, runRenderedModule } from './context';

export function runValidate(context: CommandContext) {
  const config = readUltramodernConfig(context.workspaceRoot);
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const source = createWorkspaceValidationScript(
    config.workspace.packageScope,
    config.features.tailwind,
    remotes,
  );

  return runRenderedModule(source, context);
}
