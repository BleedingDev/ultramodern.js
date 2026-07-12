import fs from 'node:fs';
import path from 'node:path';
import { createAppEnvDts } from '../../../ultramodern-workspace/app-files';
import {
  regenerateGeneratedNavigationSurface,
  remoteComponentOutputPath,
} from '../../../ultramodern-workspace/demo-components';
import {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../../../ultramodern-workspace/package-json';
import {
  type UltramodernToolingConfig,
  workspaceAppsFromToolingConfig,
} from '../../config';
import { type MigrationIo, writeJsonIfChanged, writeTextIfChanged } from './io';

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
  app: ReturnType<typeof workspaceAppsFromToolingConfig>[number],
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
  app: ReturnType<typeof workspaceAppsFromToolingConfig>[number],
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

  const apps = workspaceAppsFromToolingConfig(config);
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
          writeTextIfChanged(
            io,
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
        writeTextIfChanged(
          io,
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

export function updateGeneratedTypeScriptSurfaces(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');

  changed =
    writeJsonIfChanged(
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
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, sharedPackage, 'tsconfig.json'),
        createSharedPackageTsConfig(sharedPackage),
      ) || changed;
  }

  for (const app of apps) {
    changed =
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.json'),
        createAppTsConfig(app, remotes),
      ) || changed;
    changed =
      writeJsonIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'tsconfig.mf-types.json'),
        createAppMfTypesTsConfig(app),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'src/modern-app-env.d.ts'),
        createAppEnvDts(app, remotes),
      ) || changed;
  }

  changed = updateGeneratedNavigationSurfaces(io, config) || changed;

  return changed;
}
