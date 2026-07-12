import path from 'node:path';
import {
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { type MigrationIo } from './io';

export function removeGeneratedFileIfExists(
  io: MigrationIo,
  relativePath: string,
) {
  return io.remove(path.join(io.workspaceRoot, relativePath));
}

export function removeStaleBackendFederationArtifacts(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const relativePath of [
    'scripts/generate-node-backend-federation.mts',
    'scripts/proof-node-backend-federation.mts',
    'scripts/verify-cloudflare-output.mts',
  ]) {
    changed = removeGeneratedFileIfExists(io, relativePath) || changed;
  }

  for (const app of allWorkspaceAppsFromToolingConfig(config)) {
    changed =
      removeGeneratedFileIfExists(
        io,
        path.join(app.directory, 'api/backend-federation.ts'),
      ) || changed;
  }

  return changed;
}
