import path from 'node:path';
import { createBackendFederationContractFile } from '../../../ultramodern-workspace/backend-federation';
import {
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { type MigrationIo } from './io';

export function updateGeneratedBackendFederationContractFiles(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of allWorkspaceAppsFromToolingConfig(config)) {
    if (!app.api) {
      continue;
    }
    changed =
      io.writeGenerated(
        path.join(io.workspaceRoot, app.directory, 'api/backend-federation.ts'),
        createBackendFederationContractFile(app),
      ) || changed;
  }
  return changed;
}
