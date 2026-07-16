import fs from 'node:fs';
import path from 'node:path';
import { configuredDevelopmentPorts } from '../../../ultramodern-workspace/add-vertical/workspace-state';
import {
  createFederatedComponentsRegistry,
  createRemoteExposeFragmentPage,
  createShellRemoteComponents,
  createShellWorkerRemoteComponents,
} from '../../../ultramodern-workspace/demo-components';
import {
  appEmitsBrowserUi,
  appHasApi,
  distributedSsrExposes,
  distributedSsrFragmentSlug,
  resolveRemoteRefs,
} from '../../../ultramodern-workspace/descriptors';
import {
  createAppModernConfig,
  createBackendModuleFederationConfig,
  createRemoteModuleFederationConfig,
  createShellModuleFederationConfig,
} from '../../../ultramodern-workspace/module-federation';
import {
  additionalShellsFromToolingConfig,
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { type MigrationIo, readJsonFile, writeTextIfChanged } from './io';

function isGeneratedShellComposition(source: string) {
  return (
    source.includes('const createRemoteComponent =') &&
    source.includes('export const VerticalShowcase =')
  );
}

export function updateGeneratedModernConfigs(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = allWorkspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const overlayPath = path.join(
    io.workspaceRoot,
    'topology/local-overlays/development.json',
  );
  const overlay = fs.existsSync(overlayPath) ? readJsonFile(overlayPath) : {};
  const overlayPorts =
    overlay.ports && typeof overlay.ports === 'object'
      ? overlay.ports
      : Object.fromEntries(apps.map(app => [app.id, app.port]));
  const primaryShell = apps.find(app => app.kind === 'shell');
  const configuredPorts = primaryShell
    ? { ...overlayPorts, [primaryShell.id]: primaryShell.port }
    : overlayPorts;
  const additionalShells = additionalShellsFromToolingConfig(config);
  const configuredDevPorts =
    additionalShells.length > 0
      ? configuredDevelopmentPorts(configuredPorts, additionalShells).toSorted(
          (left, right) => left - right,
        )
      : undefined;

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
          configuredDevPorts,
        ),
      ) || changed;
    // A headless (api-only) unit exposes no browser MF surface: migrate must
    // not write a browser config for it — and must remove a stale one.
    if (appEmitsBrowserUi(app)) {
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
                app,
                remotes,
              )
            : createRemoteModuleFederationConfig(
                config.workspace.packageScope,
                app,
                remotes,
              ),
        ) || changed;
    } else {
      changed =
        io.remove(
          path.join(
            io.workspaceRoot,
            app.directory,
            'module-federation.config.ts',
          ),
        ) || changed;
    }

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
      // Each shell renders only the UI-emitting remotes named by its own
      // verticalRefs (G28 + G2a) — never the whole workspace remote set.
      const shellUiRemotes = resolveRemoteRefs(app, remotes).filter(
        appEmitsBrowserUi,
      );
      const componentsPath = path.join(
        io.workspaceRoot,
        app.directory,
        'src/routes/vertical-components.tsx',
      );
      const workerComponentsPath = path.join(
        io.workspaceRoot,
        app.directory,
        'src/routes/vertical-components.worker.tsx',
      );
      const existingComponents = fs.existsSync(componentsPath)
        ? fs.readFileSync(componentsPath, 'utf-8')
        : undefined;
      if (
        existingComponents === undefined ||
        isGeneratedShellComposition(existingComponents)
      ) {
        changed =
          writeTextIfChanged(
            io,
            componentsPath,
            createShellRemoteComponents(app, shellUiRemotes),
          ) || changed;
        changed =
          writeTextIfChanged(
            io,
            workerComponentsPath,
            createShellWorkerRemoteComponents(app, shellUiRemotes),
          ) || changed;
      } else if (
        fs.existsSync(workerComponentsPath) &&
        isGeneratedShellComposition(
          fs.readFileSync(workerComponentsPath, 'utf-8'),
        )
      ) {
        // A custom host composition is environment-neutral and obtains its
        // workerd behavior from federated-components.worker.tsx. A stale
        // generated route sibling would shadow that custom composition.
        changed = io.remove(workerComponentsPath) || changed;
      }
    } else {
      for (const expose of distributedSsrExposes(app)) {
        changed =
          writeTextIfChanged(
            io,
            path.join(
              io.workspaceRoot,
              app.directory,
              `src/routes/[lang]/_mf/fragment/${distributedSsrFragmentSlug(expose)}/page.tsx`,
            ),
            createRemoteExposeFragmentPage(app, expose),
          ) || changed;
      }
    }
    if ((app.verticalRefs?.length ?? 0) > 0) {
      changed =
        writeTextIfChanged(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            'src/federated-components.tsx',
          ),
          createFederatedComponentsRegistry(
            config.workspace.packageScope,
            app,
            remotes,
          ),
        ) || changed;
      changed =
        writeTextIfChanged(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            'src/federated-components.worker.tsx',
          ),
          createFederatedComponentsRegistry(
            config.workspace.packageScope,
            app,
            remotes,
            true,
          ),
        ) || changed;
    }
  }

  return changed;
}
