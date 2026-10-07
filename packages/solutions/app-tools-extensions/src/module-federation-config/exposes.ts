import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceSourceReadObserver } from '../publication-inputs';

import { inspectModuleFederationConfigSource } from './inspect';
import type { ModuleFederationConfigInspection } from './types';

const moduleFederationConfigFile = 'module-federation.config.ts';

/**
 * Returns undefined when the app ships no Module Federation config, or when the
 * config cannot be inspected statically, so callers keep their own expectation
 * rather than inventing a surface path. `ultramodern mf-types` reports those
 * configs separately, so staying quiet here never hides a broken config.
 * Native deployment policy loads dynamic configs through Modern.js's loader.
 */
export function readModuleFederationConfigInspection(
  workspaceRoot: string,
  appDirectory: string,
): ModuleFederationConfigInspection | undefined {
  const configPath = path.join(
    workspaceRoot,
    appDirectory,
    moduleFederationConfigFile,
  );
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    const source = fs.readFileSync(configPath, 'utf-8');
    return inspectModuleFederationConfigSource(
      source,
      appDirectory,
      path.join(appDirectory, moduleFederationConfigFile),
    );
  } catch {
    return undefined;
  }
}

/** The literal source paths, independently of the complete expose-name list. */
export function readModuleFederationExposePaths(
  workspaceRoot: string,
  appDirectory: string,
): Record<string, string> | undefined {
  return readModuleFederationConfigInspection(workspaceRoot, appDirectory)
    ?.exposePaths;
}
