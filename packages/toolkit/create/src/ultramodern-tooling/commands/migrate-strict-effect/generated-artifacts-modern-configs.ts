import path from 'node:path';
import { createShellRemoteComponents } from '../../../ultramodern-workspace/demo-components';
import { appHasApi } from '../../../ultramodern-workspace/descriptors';
import {
  createAppModernConfig,
  createBackendModuleFederationConfig,
  createRemoteModuleFederationConfig,
  createShellModuleFederationConfig,
} from '../../../ultramodern-workspace/module-federation';
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
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'module-federation.config.ts',
        ),
        app.kind === 'shell'
          ? createShellModuleFederationConfig(
              config.workspace.packageScope,
              remotes,
            )
          : createRemoteModuleFederationConfig(
              config.workspace.packageScope,
              app,
              remotes,
            ),
      ) || changed;

    if (appHasApi(app)) {
      changed =
        writeTextIfChanged(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            'backend-federation.config.ts',
          ),
          createBackendModuleFederationConfig(app),
        ) || changed;
    } else {
      changed =
        io.remove(
          path.join(
            io.workspaceRoot,
            app.directory,
            'backend-federation.config.ts',
          ),
        ) || changed;
    }

    if (app.kind === 'shell') {
      changed =
        writeTextIfChanged(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            'src/routes/vertical-components.tsx',
          ),
          createShellRemoteComponents(remotes),
        ) || changed;
    }
  }

  return changed;
}
