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
import { writeGeneratedUiSourceIfChanged } from './generated-ui-source';
import { type MigrationIo, readJsonFile } from './io';
import {
  appDeclaresReactRouter,
  isGeneratedModuleFederationConfig,
} from './react-router-retirement';

function isGeneratedShellComposition(source: string) {
  return (
    source.includes('const createRemoteComponent =') &&
    source.includes('export const VerticalShowcase =')
  );
}

function writeOwnedTypeScriptConfig(
  io: MigrationIo,
  filePath: string,
  generatedSource: string,
  isGenerated: (source: string) => boolean,
) {
  if (!fs.existsSync(filePath)) {
    return io.write(filePath, generatedSource);
  }
  const existingSource = fs.readFileSync(filePath, 'utf-8');
  if (existingSource === generatedSource || isGenerated(existingSource)) {
    return io.write(filePath, generatedSource);
  }
  io.log(
    `${path.relative(io.workspaceRoot, filePath)} was preserved: ` +
      'its generated ownership cannot be proven.',
  );
  return false;
}

function isGeneratedBackendModuleFederationConfig(source: string) {
  return [
    "import { createRequire } from 'node:module';",
    'const bffVersion =',
    'const effectVersion =',
    "'./effect-api': './api/effect-api.ts'",
    "filename: 'backendRemoteEntry.cjs'",
    'const moduleFederationConfig: Parameters<',
    'export default moduleFederationConfig;',
  ].every(signature => source.includes(signature));
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
    const modernConfigPath = path.join(
      io.workspaceRoot,
      app.directory,
      'modern.config.ts',
    );
    const generatedModernConfig = createAppModernConfig(
      config.workspace.packageScope,
      app,
      remotes,
      config.features.tailwind,
      configuredDevPorts,
    );
    if (!fs.existsSync(modernConfigPath)) {
      changed = io.write(modernConfigPath, generatedModernConfig) || changed;
    } else if (
      fs.readFileSync(modernConfigPath, 'utf-8') !== generatedModernConfig
    ) {
      io.log(
        `${path.relative(io.workspaceRoot, modernConfigPath)} was preserved: ` +
          'an existing Modern config is consumer-owned unless its generated ownership can be proven.',
      );
    }
    // A headless (api-only) unit exposes no browser MF surface: migrate must
    // not write a browser config for it — and must remove a stale one.
    if (appEmitsBrowserUi(app)) {
      // Generated MF configs are regenerated wholesale, so the bridge router
      // opt-in can only survive migrate by being derived — the app's own
      // declared React Router dependency is that single source of truth.
      const enableBridgeRouter = appDeclaresReactRouter(
        path.join(io.workspaceRoot, app.directory),
      );
      changed =
        writeOwnedTypeScriptConfig(
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
                enableBridgeRouter,
              )
            : createRemoteModuleFederationConfig(
                config.workspace.packageScope,
                app,
                remotes,
                enableBridgeRouter,
              ),
          isGeneratedModuleFederationConfig,
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
        writeOwnedTypeScriptConfig(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            'backend-federation.config.ts',
          ),
          createBackendModuleFederationConfig(app),
          isGeneratedBackendModuleFederationConfig,
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
          io.write(
            componentsPath,
            createShellRemoteComponents(app, shellUiRemotes),
          ) || changed;
        changed =
          io.write(
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
          writeGeneratedUiSourceIfChanged(
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
        writeGeneratedUiSourceIfChanged(
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
        writeGeneratedUiSourceIfChanged(
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
