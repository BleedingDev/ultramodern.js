import path from 'node:path';
import { createBackendFederationContractFile } from '../../../ultramodern-workspace/backend-federation';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeTextIfChanged } from './io';

export function updateGeneratedBackendFederationContractFiles(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of workspaceAppsFromToolingConfig(config)) {
    if (!app.api) {
      continue;
    }
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'api/backend-federation.ts'),
        createBackendFederationContractFile(app),
      ) || changed;
  }
  return changed;
}
