import fs from 'node:fs';
import path from 'node:path';
import { defaultAppRootDirs, moduleFederationConfigFile } from './constants';
import {
  collectBridgeScanRoots,
  collectMetadataAppDirs,
  firstSegment,
  normalizeRelativePath,
  readGeneratedMetadata,
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

  if (options.appDirs && options.appDirs.length > 0) {
    for (const appDir of options.appDirs) {
      appDirs.add(normalizeRelativePath(appDir));
    }
  } else {
    const metadata = readGeneratedMetadata(workspaceRoot);
    const scanRoots = new Set(defaultAppRootDirs);

    for (const metadataEntry of metadata) {
      collectMetadataAppDirs(metadataEntry, appDirs);
      collectBridgeScanRoots(metadataEntry, scanRoots);
    }

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
    .map(appDir => ({
      appDir,
      configPath: path.join(workspaceRoot, appDir, moduleFederationConfigFile),
    }));
}
