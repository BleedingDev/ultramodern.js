import fs from 'node:fs';
import path from 'node:path';
import { inspectModuleFederationConfigSource } from './inspect';
import type { ModuleFederationConfigInspection } from './types';

/** Records each filesystem read so callers can bind the inputs they consumed. */
export type ModuleFederationConfigReadObserver = (
  input: string,
  operation: 'content' | 'entry-kind',
  existed: boolean,
) => void;

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
  observeInput?: ModuleFederationConfigReadObserver,
): ModuleFederationConfigInspection | undefined {
  const configPath = path.join(
    workspaceRoot,
    appDirectory,
    moduleFederationConfigFile,
  );
  const existed = fs.existsSync(configPath);
  observeInput?.(configPath, 'entry-kind', existed);
  if (!existed) {
    return undefined;
  }
  try {
    const source = fs.readFileSync(configPath, 'utf-8');
    observeInput?.(configPath, 'content', true);
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
  observeInput?: ModuleFederationConfigReadObserver,
): Record<string, string> | undefined {
  return readModuleFederationConfigInspection(
    workspaceRoot,
    appDirectory,
    observeInput,
  )?.exposePaths;
}
