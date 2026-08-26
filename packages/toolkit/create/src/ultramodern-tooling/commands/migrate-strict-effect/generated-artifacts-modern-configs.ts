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
import { formatGeneratedSourceCandidates } from '../../../ultramodern-workspace/fs-io';
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
import { appDeclaresReactRouter } from './react-router-retirement';

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
  recognizedGeneratedSources: readonly string[] = [],
) {
  if (!fs.existsSync(filePath)) {
    return io.writeGenerated(filePath, generatedSource);
  }
  const existingSource = fs.readFileSync(filePath, 'utf-8');
  if (existingSource === generatedSource) {
    return io.writeGenerated(filePath, existingSource);
  }
  if (recognizedGeneratedSources.includes(existingSource)) {
    return io.writeGenerated(filePath, generatedSource);
  }
  io.log(
    `${path.relative(io.workspaceRoot, filePath)} was preserved: ` +
      'its generated ownership cannot be proven.',
  );
  return false;
}

function removeOwnedTypeScriptConfig(
  io: MigrationIo,
  filePath: string,
  recognizedGeneratedSources: readonly string[],
) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  if (recognizedGeneratedSources.includes(fs.readFileSync(filePath, 'utf-8'))) {
    return io.remove(filePath);
  }
  io.log(
    `${path.relative(io.workspaceRoot, filePath)} was preserved: ` +
      'surface metadata cannot delete a config whose exact generated ownership cannot be proven.',
  );
  return false;
}

function addLegacyGeneratedModernDefaults(source: string) {
  const serverAnchor = "        publicDir: ['./locales', './assets'],\n";
  const optionsEnd = '    },\n  ),\n);';
  return source
    .replace(
      serverAnchor,
      `${serverAnchor}        ssr: {
          mode: 'stream',
          moduleFederationAppSSR: true,
        },
`,
    )
    .replace(
      optionsEnd,
      `      enableBffRequestId: true,
      enableModuleFederationSSR: true,
      enableTelemetryExporters: true,
      telemetryFailLoudStartup: false,
${optionsEnd}`,
    );
}

function formatGeneratedModernConfigCandidates(
  generatedSources: readonly string[],
) {
  return formatGeneratedSourceCandidates(
    generatedSources.map(
      (source, index) => [`candidate-${index}.ts`, source] as const,
    ),
  );
}

const formatGeneratedTypeScriptConfig = (generatedSource: string) =>
  formatGeneratedModernConfigCandidates([generatedSource])[0];

function isGeneratedModernConfig(
  source: string,
  generatedSources: readonly string[],
) {
  return generatedSources.includes(source);
}

function addPreviousTailwindOptimizationOverride(source: string) {
  return source.replace(
    'pluginTailwindcss()',
    'pluginTailwindcss({ optimize: false })',
  );
}

export function updateGeneratedModernConfigs(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
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
    const rawGeneratedModernConfig = createAppModernConfig(
      config.workspace.packageScope,
      app,
      remotes,
      config.features.tailwind,
      configuredDevPorts,
    );
    const previousTailwindModernConfig =
      addPreviousTailwindOptimizationOverride(rawGeneratedModernConfig);
    const [generatedModernConfig, ...recognizedGeneratedModernConfigs] =
      formatGeneratedModernConfigCandidates([
        rawGeneratedModernConfig,
        addLegacyGeneratedModernDefaults(rawGeneratedModernConfig),
        previousTailwindModernConfig,
        addLegacyGeneratedModernDefaults(previousTailwindModernConfig),
      ]);
    if (!fs.existsSync(modernConfigPath)) {
      io.writeGenerated(modernConfigPath, generatedModernConfig);
    } else {
      const existingModernConfig = fs.readFileSync(modernConfigPath, 'utf-8');
      if (existingModernConfig === generatedModernConfig) {
        io.writeGenerated(modernConfigPath, existingModernConfig);
      } else if (
        isGeneratedModernConfig(existingModernConfig, [
          generatedModernConfig,
          ...recognizedGeneratedModernConfigs,
        ])
      ) {
        io.writeGenerated(modernConfigPath, generatedModernConfig);
      } else {
        io.log(
          `${path.relative(io.workspaceRoot, modernConfigPath)} was preserved: ` +
            'an existing Modern config is consumer-owned unless its generated ownership can be proven.',
        );
      }
    }
    // A headless (api-only) unit exposes no browser MF surface. Delete only a
    // byte-exact current generator artifact; stale metadata is not ownership
    // evidence and consumer-owned configs must survive whole.
    const moduleFederationConfigPath = path.join(
      io.workspaceRoot,
      app.directory,
      'module-federation.config.ts',
    );
    const enableBridgeRouter = appDeclaresReactRouter(
      path.join(io.workspaceRoot, app.directory),
    );
    const createGeneratedModuleFederationConfig = (bridgeRouter: boolean) =>
      formatGeneratedTypeScriptConfig(
        app.kind === 'shell'
          ? createShellModuleFederationConfig(
              config.workspace.packageScope,
              app,
              remotes,
              bridgeRouter,
            )
          : createRemoteModuleFederationConfig(
              config.workspace.packageScope,
              app,
              remotes,
              bridgeRouter,
            ),
      );
    const generatedModuleFederationConfig =
      createGeneratedModuleFederationConfig(enableBridgeRouter);
    const recognizedModuleFederationConfigs = [
      generatedModuleFederationConfig,
      createGeneratedModuleFederationConfig(!enableBridgeRouter),
    ];
    if (appEmitsBrowserUi(app)) {
      // Existing configs are never regenerated wholesale without byte-exact
      // current ownership proof. The later bridge pass performs its one safe,
      // structural edit while preserving consumer extensions.
      writeOwnedTypeScriptConfig(
        io,
        moduleFederationConfigPath,
        generatedModuleFederationConfig,
        recognizedModuleFederationConfigs,
      );
    } else {
      removeOwnedTypeScriptConfig(
        io,
        moduleFederationConfigPath,
        recognizedModuleFederationConfigs,
      );
    }

    const backendFederationConfigPath = path.join(
      io.workspaceRoot,
      app.directory,
      'backend-federation.config.ts',
    );
    const generatedBackendFederationConfig = formatGeneratedTypeScriptConfig(
      createBackendModuleFederationConfig(app),
    );
    if (appHasApi(app)) {
      writeOwnedTypeScriptConfig(
        io,
        backendFederationConfigPath,
        generatedBackendFederationConfig,
        [generatedBackendFederationConfig],
      );
    } else {
      removeOwnedTypeScriptConfig(io, backendFederationConfigPath, [
        generatedBackendFederationConfig,
      ]);
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
        io.writeGenerated(
          componentsPath,
          createShellRemoteComponents(app, shellUiRemotes),
        );
        io.writeGenerated(
          workerComponentsPath,
          createShellWorkerRemoteComponents(app, shellUiRemotes),
        );
      } else if (
        fs.existsSync(workerComponentsPath) &&
        isGeneratedShellComposition(
          fs.readFileSync(workerComponentsPath, 'utf-8'),
        )
      ) {
        // A custom host composition is environment-neutral and obtains its
        // workerd behavior from federated-components.worker.tsx. A stale
        // generated route sibling would shadow that custom composition.
        io.remove(workerComponentsPath);
      }
    } else {
      for (const expose of distributedSsrExposes(app)) {
        writeGeneratedUiSourceIfChanged(
          io,
          path.join(
            io.workspaceRoot,
            app.directory,
            `src/routes/[lang]/_mf/fragment/${distributedSsrFragmentSlug(expose)}/page.tsx`,
          ),
          createRemoteExposeFragmentPage(app, expose),
        );
      }
    }
    if ((app.verticalRefs?.length ?? 0) > 0) {
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
      );
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
      );
    }
  }
}
