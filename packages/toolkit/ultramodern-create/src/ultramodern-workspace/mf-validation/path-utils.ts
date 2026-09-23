import fs from 'node:fs';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { moduleFederationConfigFile, skippedScanDirs } from './constants';
import type { JsonRecord } from './types';

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/u, '');
  const trimmed = normalized.replace(/\/+$/u, '');
  return trimmed === '' ? '.' : trimmed;
}

export function relativePath(root: string, target: string): string {
  return normalizeRelativePath(toPosixPath(path.relative(root, target)));
}

export function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function collectMetadataAppDirs(value: unknown, appDirs: Set<string>) {
  if (!isRecord(value)) return;
  const entries = [
    value.shell,
    ...(Array.isArray(value.verticals) ? value.verticals : []),
    ...(Array.isArray(value.shells) ? value.shells : []),
  ];
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      path.isAbsolute(entry.path)
    )
      throw new Error('Reference topology apps require relative paths.');
    const normalized = normalizeRelativePath(entry.path);
    if (normalized === '..' || normalized.startsWith('../'))
      throw new Error(`Topology app path leaves workspace: ${entry.path}`);
    appDirs.add(normalized);
  }
}

function literalRootFromPattern(pattern: string): string | undefined {
  const normalized = normalizeRelativePath(pattern);
  if (
    normalized === '.' ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('../')
  ) {
    return undefined;
  }

  const segments = normalized.split('/');
  const literalSegments: string[] = [];

  for (const segment of segments) {
    if (/[*?[\]{}]/u.test(segment)) {
      break;
    }
    literalSegments.push(segment);
  }

  return literalSegments.length > 0 ? literalSegments.join('/') : undefined;
}

export function collectWorkspaceScanRoots(
  workspaceRoot: string,
  roots: Set<string>,
) {
  const file = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(file)) return;
  const workspace = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!isRecord(workspace) || !Array.isArray(workspace.packages)) return;
  for (const pattern of workspace.packages) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) continue;
    const root = literalRootFromPattern(pattern);
    if (root) roots.add(root);
  }
}

export function firstSegment(appDir: string): string | undefined {
  if (appDir === '.') {
    return undefined;
  }

  return appDir.split('/')[0];
}

export function scanForModuleFederationConfigs(
  workspaceRoot: string,
  scanRoot: string,
  appDirs: Set<string>,
) {
  const absoluteRoot = path.join(workspaceRoot, scanRoot);
  if (
    !fs.existsSync(absoluteRoot) ||
    !fs.statSync(absoluteRoot).isDirectory()
  ) {
    return;
  }

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedScanDirs.has(entry.name)) {
          visit(path.join(directory, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name === moduleFederationConfigFile) {
        appDirs.add(relativePath(workspaceRoot, directory));
      }
    }
  };

  visit(absoluteRoot);
}
