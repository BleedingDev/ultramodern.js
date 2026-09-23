import fs from 'node:fs';
import path from 'node:path';
import { defaultAppRootDirs, moduleFederationConfigFile } from './constants';
import {
  collectMetadataAppDirs,
  collectWorkspaceScanRoots,
  firstSegment,
  normalizeRelativePath,
  readJsonIfExists,
  scanForModuleFederationConfigs,
} from './path-utils';
import type {
  ModuleFederationDiscoveredConfig,
  ModuleFederationValidationOptions,
} from './types';

export function discoverModuleFederationConfigs(
  options: ModuleFederationValidationOptions,
): ModuleFederationDiscoveredConfig[] {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const appDirs = new Set<string>();
  const metadata = readJsonIfExists(
    path.join(workspaceRoot, 'topology/reference-topology.json'),
  );
  const metadataAppDirs = new Set<string>();
  const apiOnlyDirs = collectMetadataAppDirs(metadata, metadataAppDirs);

  if (options.appDirs && options.appDirs.length > 0) {
    for (const appDir of options.appDirs) {
      appDirs.add(normalizeRelativePath(appDir));
    }
  } else {
    const scanRoots = new Set(defaultAppRootDirs);

    for (const appDir of metadataAppDirs) {
      appDirs.add(appDir);
    }
    collectWorkspaceScanRoots(workspaceRoot, scanRoots);

    for (const appDir of appDirs) {
      const segment = firstSegment(appDir);
      if (segment) {
        scanRoots.add(segment);
      }
    }

    if (fs.existsSync(path.join(workspaceRoot, moduleFederationConfigFile))) {
      appDirs.add('.');
    }

    for (const scanRoot of scanRoots) {
      scanForModuleFederationConfigs(workspaceRoot, scanRoot, appDirs);
    }
  }

  return Array.from(appDirs)
    .sort()
    .filter(
      appDir =>
        !apiOnlyDirs.has(appDir) ||
        fs.existsSync(
          path.join(workspaceRoot, appDir, moduleFederationConfigFile),
        ),
    )
    .map(appDir => ({
      appDir,
      configPath: path.join(workspaceRoot, appDir, moduleFederationConfigFile),
    }));
}
