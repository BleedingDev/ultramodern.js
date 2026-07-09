import path from 'node:path';
import { createAppModernConfig } from '../../../ultramodern-workspace/module-federation';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeTextIfChanged } from './io';

export function updateGeneratedModernConfigs(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  for (const app of apps) {
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'modern.config.ts'),
        createAppModernConfig(
          config.workspace.packageScope,
          app,
          remotes,
          config.features.tailwind,
        ),
      ) || changed;
  }

  return changed;
}
