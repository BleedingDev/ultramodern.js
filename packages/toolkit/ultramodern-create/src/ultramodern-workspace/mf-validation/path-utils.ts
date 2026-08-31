import fs from 'node:fs';
import path from 'node:path';
import {
  generatedMetadataPaths,
  moduleFederationConfigFile,
  skippedScanDirs,
} from './constants';
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

function addMetadataAppDir(value: unknown, appDirs: Set<string>, hint = '') {
  if (!isRecord(value)) {
    return;
  }

  const pathValue =
    typeof value.path === 'string'
      ? value.path
      : typeof value.directory === 'string'
        ? value.directory
        : undefined;
  const hasModuleFederationDeclaration =
    isRecord(value.moduleFederation) ||
    typeof value.moduleFederationName === 'string' ||
    hint === 'apps' ||
    hint === 'verticals' ||
    hint === 'remotes' ||
    hint === 'moduleFederation';

  if (
    pathValue &&
    hasModuleFederationDeclaration &&
    !path.isAbsolute(pathValue)
  ) {
    appDirs.add(normalizeRelativePath(pathValue));
  }
}

export function collectMetadataAppDirs(
  value: unknown,
  appDirs: Set<string>,
  hint = '',
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMetadataAppDirs(entry, appDirs, hint);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  addMetadataAppDir(value, appDirs, hint);

  for (const [key, entry] of Object.entries(value)) {
    collectMetadataAppDirs(entry, appDirs, key);
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

export function collectBridgeScanRoots(value: unknown, roots: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectBridgeScanRoots(entry, roots);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const workspacePackages = value.bridge;
  if (isRecord(workspacePackages)) {
    const entries = workspacePackages.workspacePackages;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (isRecord(entry) && typeof entry.pattern === 'string') {
          const root = literalRootFromPattern(entry.pattern);
          if (root) {
            roots.add(root);
          }
        }
      }
    }
  }

  for (const entry of Object.values(value)) {
    collectBridgeScanRoots(entry, roots);
  }
}

export function readGeneratedMetadata(workspaceRoot: string): unknown[] {
  return generatedMetadataPaths
    .map(metadataPath =>
      readJsonIfExists(path.join(workspaceRoot, metadataPath)),
    )
    .filter((metadata): metadata is unknown => metadata !== undefined);
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
