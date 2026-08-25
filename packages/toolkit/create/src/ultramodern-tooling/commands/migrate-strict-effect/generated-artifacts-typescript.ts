import fs from 'node:fs';
import path from 'node:path';
import {
  createAppEnvDts,
  createAppRuntimeConfig,
} from '../../../ultramodern-workspace/app-files';
import {
  createRemoteExposeFragmentPage,
  regenerateGeneratedNavigationSurface,
  remoteComponentOutputPath,
} from '../../../ultramodern-workspace/demo-components';
import {
  appI18nNamespace,
  distributedSsrExposes,
  distributedSsrFragmentSlug,
  resolveRemoteRefs,
} from '../../../ultramodern-workspace/descriptors';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../../../ultramodern-workspace/package-json';
import {
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { writeGeneratedUiSourceIfChanged } from './generated-ui-source';
import { type MigrationIo, writeJsonFile } from './io';

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function readJsonObject(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return jsonObject(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

function mergeUniqueJsonValues(generated: unknown, existing: unknown) {
  const generatedValues = Array.isArray(generated) ? generated : [];
  const existingValues = Array.isArray(existing) ? existing : [];
  const seen = new Set(generatedValues.map(value => JSON.stringify(value)));
  return [
    ...generatedValues,
    ...existingValues.filter(value => {
      const key = JSON.stringify(value);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  ];
}

function mergeTypeScriptPlugins(generated: unknown, existing: unknown) {
  const generatedPlugins = Array.isArray(generated) ? generated : [];
  const existingPlugins = Array.isArray(existing) ? existing : [];
  const existingByName = new Map(
    existingPlugins
      .map(jsonObject)
      .filter(plugin => typeof plugin?.name === 'string')
      .map(plugin => [plugin.name, plugin]),
  );
  const merged = generatedPlugins.map(generatedPlugin => {
    const generatedObject = jsonObject(generatedPlugin);
    const existingObject =
      typeof generatedObject?.name === 'string'
        ? existingByName.get(generatedObject.name)
        : undefined;
    if (!generatedObject || !existingObject) {
      return generatedPlugin;
    }
    existingByName.delete(generatedObject.name as string);
    return {
      ...generatedObject,
      ...existingObject,
      diagnosticSeverity: {
        ...jsonObject(generatedObject.diagnosticSeverity),
        ...jsonObject(existingObject.diagnosticSeverity),
      },
    };
  });
  return [...merged, ...existingByName.values()];
}

function mergeTypeScriptConfig(generated: unknown, existing: unknown) {
  const generatedConfig = jsonObject(generated) ?? {};
  const existingConfig = jsonObject(existing) ?? {};
  const generatedCompilerOptions =
    jsonObject(generatedConfig.compilerOptions) ?? {};
  const existingCompilerOptions = {
    ...(jsonObject(existingConfig.compilerOptions) ?? {}),
  };
  delete existingCompilerOptions.skipLibCheck;
  const compilerOptions = {
    ...existingCompilerOptions,
    ...generatedCompilerOptions,
  };
  if (
    Array.isArray(generatedCompilerOptions.plugins) ||
    Array.isArray(existingCompilerOptions.plugins)
  ) {
    compilerOptions.plugins = mergeTypeScriptPlugins(
      generatedCompilerOptions.plugins,
      existingCompilerOptions.plugins,
    );
  }
  const merged: JsonObject = { ...existingConfig, ...generatedConfig };
  if (Object.keys(compilerOptions).length > 0) {
    merged.compilerOptions = compilerOptions;
  }
  for (const key of ['include', 'exclude', 'references'] as const) {
    if (
      Array.isArray(generatedConfig[key]) ||
      Array.isArray(existingConfig[key])
    ) {
      merged[key] = mergeUniqueJsonValues(
        generatedConfig[key],
        existingConfig[key],
      );
    }
  }
  return merged;
}

function writeMergedTypeScriptConfig(
  io: MigrationIo,
  filePath: string,
  generated: unknown,
) {
  const existing = readJsonObject(filePath);
  const merged = mergeTypeScriptConfig(generated, existing);
  if (existing && JSON.stringify(merged) !== JSON.stringify(generated)) {
    io.log(
      `${path.relative(io.workspaceRoot, filePath)} preserved consumer-owned TypeScript configuration.`,
    );
  }
  return writeJsonFile(io, filePath, merged);
}

function generatedManifest(io: MigrationIo, config: UltramodernToolingConfig) {
  const sourcePath = path.isAbsolute(config.sourcePath)
    ? config.sourcePath
    : path.join(io.workspaceRoot, config.sourcePath);
  const manifest = readJsonObject(sourcePath);
  const generator = jsonObject(manifest?.generator);
  return generator?.package === '@modern-js/create' ? manifest : undefined;
}

function manifestApps(manifest: JsonObject) {
  const topology = jsonObject(manifest.topology);
  return Array.isArray(topology?.apps)
    ? topology.apps.map(jsonObject).filter(app => app !== undefined)
    : [];
}

function packageManifest(io: MigrationIo, appDirectory: string) {
  return readJsonObject(
    path.join(io.workspaceRoot, appDirectory, 'package.json'),
  );
}

function shellSurfaceIsOwned(
  io: MigrationIo,
  app: ReturnType<typeof allWorkspaceAppsFromToolingConfig>[number],
  manifestApp: JsonObject,
) {
  const packageJson = packageManifest(io, app.directory);
  const moduleFederation = jsonObject(manifestApp.moduleFederation);
  return (
    manifestApp.kind === 'shell' &&
    manifestApp.path === app.directory &&
    moduleFederation?.role === 'host' &&
    typeof manifestApp.package === 'string' &&
    packageJson?.name === manifestApp.package
  );
}

function deliveryUnitSurfaceIsOwned(
  io: MigrationIo,
  config: UltramodernToolingConfig,
  app: ReturnType<typeof allWorkspaceAppsFromToolingConfig>[number],
  manifestApp: JsonObject,
  expose: string,
  sourcePath: string,
) {
  const deliveryUnit = jsonObject(manifestApp.deliveryUnit);
  const moduleFederation = jsonObject(manifestApp.moduleFederation);
  const packageJson = packageManifest(io, app.directory);
  const packageExports = jsonObject(packageJson?.exports);
  const exposedSurfaces = Array.isArray(moduleFederation?.exposes)
    ? moduleFederation.exposes
    : [];
  const packageName = manifestApp.package;
  return (
    manifestApp.kind === 'vertical' &&
    manifestApp.path === app.directory &&
    typeof packageName === 'string' &&
    packageJson?.name === packageName &&
    deliveryUnit?.kind === 'microvertical-delivery-unit' &&
    deliveryUnit.packageName === packageName &&
    deliveryUnit.unitId === `${config.workspace.packageScope}/${app.id}` &&
    exposedSurfaces.includes(expose) &&
    packageExports?.[expose] === sourcePath
  );
}

function updateGeneratedNavigationSurfaces(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  const manifest = generatedManifest(io, config);
  if (manifest === undefined) {
    return false;
  }

  const apps = allWorkspaceAppsFromToolingConfig(config);
  const appsById = new Map(
    manifestApps(manifest).map(app => [String(app.id ?? ''), app]),
  );
  let changed = false;

  for (const app of apps) {
    const manifestApp = appsById.get(app.id);
    if (manifestApp === undefined) {
      continue;
    }

    if (app.kind === 'shell' && shellSurfaceIsOwned(io, app, manifestApp)) {
      const filePath = path.join(
        io.workspaceRoot,
        app.directory,
        'src/routes/shell-frame.tsx',
      );
      if (fs.existsSync(filePath)) {
        const source = fs.readFileSync(filePath, 'utf-8');
        changed =
          io.write(
            filePath,
            regenerateGeneratedNavigationSurface(source, 'shell-frame'),
          ) || changed;
      }
      continue;
    }

    for (const [expose, sourcePath] of Object.entries(app.exposes ?? {})) {
      const isCheckoutNavigationSurface =
        (expose === './AddToCart' &&
          sourcePath === './src/components/add-to-cart.tsx') ||
        (expose === './CheckoutPage' &&
          sourcePath === './src/components/checkout-page.tsx');
      if (app.id !== 'checkout' || !isCheckoutNavigationSurface) {
        continue;
      }
      const relativePath = remoteComponentOutputPath(app, expose);
      if (
        relativePath === undefined ||
        !deliveryUnitSurfaceIsOwned(
          io,
          config,
          app,
          manifestApp,
          expose,
          sourcePath,
        )
      ) {
        continue;
      }
      const filePath = path.join(io.workspaceRoot, relativePath);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const source = fs.readFileSync(filePath, 'utf-8');
      if (
        !source.includes(`data-modern-boundary-id="${app.id}"`) ||
        !source.includes(`data-modern-mf-expose="${expose}"`)
      ) {
        continue;
      }
      changed =
        io.write(
          filePath,
          regenerateGeneratedNavigationSurface(source, 'demo-component'),
        ) || changed;
    }
  }

  return changed;
}

function ensureGeneratedIgnoreRules(io: MigrationIo) {
  const gitignorePath = path.join(io.workspaceRoot, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  const lines =
    existing.trimEnd().length === 0 ? [] : existing.trimEnd().split(/\r?\n/u);
  let changed = false;

  for (const rule of [
    '.mf/',
    '**/.mf/',
    'dist-cloudflare/',
    '.output/',
    '**/.output/',
    '.modern-js/',
    '**/.modern-js/',
    '**/src/modern-tanstack/',
    '**/.tsgo.*.resolved.json',
  ]) {
    if (!lines.includes(rule)) {
      lines.push(rule);
      changed = true;
    }
  }

  if (!changed) {
    return false;
  }

  return io.write(gitignorePath, `${lines.join('\n')}\n`);
}

function updateGeneratedShellRuntimeSurfaces(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  const manifest = generatedManifest(io, config);
  if (manifest === undefined) {
    return false;
  }

  const apps = allWorkspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const appsById = new Map(
    manifestApps(manifest).map(app => [String(app.id ?? ''), app]),
  );
  let changed = false;

  for (const app of apps.filter(app => app.kind === 'shell')) {
    const manifestApp = appsById.get(app.id);
    if (
      manifestApp === undefined ||
      !shellSurfaceIsOwned(io, app, manifestApp)
    ) {
      continue;
    }

    const runtimePath = path.join(
      io.workspaceRoot,
      app.directory,
      'src/modern.runtime.ts',
    );
    if (!fs.existsSync(runtimePath)) {
      continue;
    }
    const runtimeSource = fs.readFileSync(runtimePath, 'utf-8');
    if (
      !runtimeSource.includes('/verticals/') ||
      !runtimeSource.includes('/locales/')
    ) {
      continue;
    }

    const shellRemotes = resolveRemoteRefs(app, remotes);
    for (const language of ['en', 'cs'] as const) {
      const shellLocaleDirectory = path.join(
        io.workspaceRoot,
        app.directory,
        'locales',
        language,
      );
      const shellLocale =
        readJsonObject(
          path.join(shellLocaleDirectory, `${appI18nNamespace(app)}.json`),
        ) ?? {};
      const mergedLocale = Object.assign(
        {},
        shellLocale,
        ...shellRemotes.map(remote =>
          readJsonObject(
            path.join(
              io.workspaceRoot,
              remote.directory,
              'locales',
              language,
              `${appI18nNamespace(remote)}.json`,
            ),
          ),
        ),
      );
      changed =
        writeJsonFile(
          io,
          path.join(shellLocaleDirectory, `${appI18nNamespace(app)}.json`),
          mergedLocale,
        ) || changed;
      changed =
        writeJsonFile(
          io,
          path.join(shellLocaleDirectory, 'translation.json'),
          mergedLocale,
        ) || changed;
    }

    changed =
      io.write(
        runtimePath,
        createAppRuntimeConfig(app, config.workspace.packageScope, remotes),
      ) || changed;
  }

  return changed;
}

export function updateGeneratedTypeScriptSurfaces(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = allWorkspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  changed =
    writeMergedTypeScriptConfig(
      io,
      path.join(io.workspaceRoot, 'tsconfig.base.json'),
      createTsConfigBase(),
    ) || changed;
  changed = ensureGeneratedIgnoreRules(io) || changed;

  for (const sharedPackage of [
    'packages/shared-contracts',
    'packages/shared-design-tokens',
  ]) {
    changed =
      writeMergedTypeScriptConfig(
        io,
        path.join(io.workspaceRoot, sharedPackage, 'tsconfig.json'),
        createSharedPackageTsConfig(sharedPackage),
      ) || changed;
  }

  for (const app of apps) {
    changed =
      writeMergedTypeScriptConfig(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.json'),
        createAppTsConfig(app, remotes),
      ) || changed;
    changed =
      writeMergedTypeScriptConfig(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.mf-types.json'),
        createAppMfTypesTsConfig(app),
      ) || changed;
    changed =
      io.write(
        path.join(io.workspaceRoot, app.directory, 'src/modern-app-env.d.ts'),
        createAppEnvDts(app, remotes, config.workspace.packageScope),
      ) || changed;

    if (app.kind !== 'shell') {
      for (const expose of distributedSsrExposes(app)) {
        const fragmentPagePath = path.join(
          io.workspaceRoot,
          app.directory,
          'src/routes/[lang]/_mf/fragment',
          distributedSsrFragmentSlug(expose),
          'page.tsx',
        );
        if (!fs.existsSync(fragmentPagePath)) {
          continue;
        }
        const fragmentPageSource = fs.readFileSync(fragmentPagePath, 'utf-8');
        if (
          !fragmentPageSource.includes(
            "from '@modern-js/runtime/module-federation';",
          ) ||
          !fragmentPageSource.includes(
            'data-modern-distributed-ssr-marker="start"',
          )
        ) {
          continue;
        }
        changed =
          writeGeneratedUiSourceIfChanged(
            io,
            fragmentPagePath,
            createRemoteExposeFragmentPage(app, expose),
          ) || changed;
      }
    }
  }

  changed = updateGeneratedShellRuntimeSurfaces(io, config) || changed;
  changed = updateGeneratedNavigationSurfaces(io, config) || changed;

  return changed;
}
