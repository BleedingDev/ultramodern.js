import path from 'node:path';
import { createZeropsRuntimeMaterializationScript } from '../../../ultramodern-workspace/workspace-scripts';
import { createZeropsYaml } from '../../../ultramodern-workspace/zerops';
import {
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { type MigrationIo, writeTextIfChanged } from './io';

export function updateGeneratedZeropsArtifacts(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  const apps = allWorkspaceAppsFromToolingConfig(config);
  let changed = writeTextIfChanged(
    io,
    path.join(io.workspaceRoot, 'zerops.yaml'),
    `${createZeropsYaml(config.workspace.packageScope, apps)}\n`,
  );
  changed =
    writeTextIfChanged(
      io,
      path.join(io.workspaceRoot, 'scripts/materialize-zerops-runtime.mjs'),
      createZeropsRuntimeMaterializationScript(),
    ) || changed;
  return changed;
}
