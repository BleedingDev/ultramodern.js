import fs from 'node:fs';
import path from 'node:path';
import { mfTypesArchive } from './constants';
import { discoverModuleFederationConfigs } from './discovery';
import { inspectModuleFederationConfigSource } from './inspect';
import { relativePath } from './path-utils';
import type {
  ModuleFederationConfigInspection,
  ModuleFederationValidationOptions,
  ModuleFederationValidationResult,
} from './types';

export function assertExposedAppDtsSettings(
  app: ModuleFederationConfigInspection,
) {
  if (app.dts.compilerInstance !== 'effect-tsgo') {
    throw new Error(
      `Module Federation DTS compilerInstance must resolve "@effect/tsgo" for ${app.appDir}.`,
    );
  }

  if (app.dts.tsConfigPath !== './tsconfig.mf-types.json') {
    throw new Error(
      `Module Federation DTS tsConfigPath must be "./tsconfig.mf-types.json" for ${app.appDir}.`,
    );
  }
}

export function assertTypesArchive(workspaceRoot: string, appDir: string) {
  const typesArchivePath = path.join(workspaceRoot, appDir, mfTypesArchive);
  if (!fs.existsSync(typesArchivePath)) {
    throw new Error(
      `Missing Module Federation DTS archive: ${relativePath(
        workspaceRoot,
        typesArchivePath,
      )}`,
    );
  }

  if (fs.statSync(typesArchivePath).size === 0) {
    throw new Error(
      `Empty Module Federation DTS archive: ${relativePath(
        workspaceRoot,
        typesArchivePath,
      )}`,
    );
  }
}

export function validateModuleFederationTypes(
  options: ModuleFederationValidationOptions,
): ModuleFederationValidationResult {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const discoveredConfigs = discoverModuleFederationConfigs({
    ...options,
    workspaceRoot,
  });
  const apps: ModuleFederationConfigInspection[] = [];
  const missingConfigPaths: string[] = [];

  for (const discoveredConfig of discoveredConfigs) {
    if (!fs.existsSync(discoveredConfig.configPath)) {
      missingConfigPaths.push(
        relativePath(workspaceRoot, discoveredConfig.configPath),
      );
      continue;
    }

    const configPath = relativePath(workspaceRoot, discoveredConfig.configPath);
    apps.push(
      inspectModuleFederationConfigSource(
        fs.readFileSync(discoveredConfig.configPath, 'utf-8'),
        discoveredConfig.appDir,
        configPath,
      ),
    );
  }

  if (missingConfigPaths.length > 0) {
    throw new Error(
      `Missing Module Federation config: ${missingConfigPaths.join(', ')}`,
    );
  }

  const noExposeApps = apps.filter(
    app => app.exposes.length === 0 && !app.hostOnlyNoExposes,
  );
  if (noExposeApps.length > 0) {
    const suffix =
      apps.filter(app => app.exposes.length > 0).length === 0
        ? ' Validation would otherwise validate zero exposed apps.'
        : '';
    throw new Error(
      `Module Federation configs declare no exposes without an explicit host-only/no-exposes declaration: ${noExposeApps
        .map(app => app.appDir)
        .join(', ')}.${suffix}`,
    );
  }

  let exposedAppCount = 0;
  let hostOnlyAppCount = 0;

  for (const app of apps) {
    if (app.hostOnlyNoExposes) {
      hostOnlyAppCount += 1;
      continue;
    }

    assertExposedAppDtsSettings(app);
    assertTypesArchive(workspaceRoot, app.appDir);
    exposedAppCount += 1;
  }

  if (
    apps.length > 0 &&
    exposedAppCount === 0 &&
    hostOnlyAppCount !== apps.length
  ) {
    throw new Error(
      'Module Federation validation inspected configs but validated zero exposed apps. Declare host-only/no-exposes intent only for host apps without exposes.',
    );
  }

  return {
    apps,
    configCount: apps.length,
    exposedAppCount,
    hostOnlyAppCount,
  };
}
