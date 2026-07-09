import path from 'node:path';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from '../../../ultramodern-workspace/module-federation';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeTextIfChanged } from './io';

export function updateGeneratedBuildIdentityModules(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'src/ultramodern-build.ts'),
        createUltramodernBuildReexportModule(),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.ts',
        ),
        createUltramodernBuildModule(config.workspace.packageScope, app),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.json',
        ),
        createUltramodernBuildArtifactJson(config.workspace.packageScope, app),
      ) || changed;
  }
  return changed;
}
