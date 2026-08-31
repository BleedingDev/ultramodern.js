import fs from 'node:fs';
import path from 'node:path';

import type { ResolvedPackageSource } from '../../ultramodern-workspace/types';
import {
  LEGACY_DEVELOPMENT_OVERLAY_PATH,
  LEGACY_PACKAGE_SOURCE_METADATA_PATH,
} from './constants';
import { readJsonObject, readOptionalJsonObject } from './json';

export function packageScopeFromRoot(workspaceRoot: string): string {
  const rootPackage = readOptionalJsonObject(
    path.join(workspaceRoot, 'package.json'),
  );
  return typeof rootPackage.name === 'string' && rootPackage.name.length > 0
    ? rootPackage.name
    : path.basename(workspaceRoot);
}

export function packageSourceFromMetadata(
  workspaceRoot: string,
): ResolvedPackageSource | undefined {
  const metadataPath = path.join(
    workspaceRoot,
    LEGACY_PACKAGE_SOURCE_METADATA_PATH,
  );
  if (!fs.existsSync(metadataPath)) {
    return undefined;
  }

  const metadata = readJsonObject(metadataPath);
  const aliases = metadata.modernPackages?.aliases ?? {};
  // Pick package + alias from the SAME entry so the derived prefix cannot
  // mix two different alias mappings.
  const firstAliasEntry = Object.entries(aliases).find(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const firstPackage = firstAliasEntry?.[0];
  const firstAlias = firstAliasEntry?.[1];
  const aliasScope = firstAlias?.match(/^@([^/]+)\//u)?.[1];
  const unscopedName = firstPackage?.split('/').at(-1) ?? '';
  const aliasUnscopedName = firstAlias?.split('/').at(-1) ?? '';
  const aliasPackageNamePrefix =
    aliasUnscopedName &&
    unscopedName &&
    aliasUnscopedName.endsWith(unscopedName)
      ? aliasUnscopedName.slice(0, -unscopedName.length)
      : undefined;

  return {
    strategy: metadata.strategy === 'install' ? 'install' : 'workspace',
    modernPackageVersion:
      typeof metadata.modernPackages?.specifier === 'string'
        ? metadata.modernPackages.specifier
        : 'workspace:*',
    registry:
      typeof metadata.modernPackages?.registry === 'string'
        ? metadata.modernPackages.registry
        : undefined,
    aliasScope,
    aliasPackageNamePrefix,
  };
}

export function readOverlayPorts(
  workspaceRoot: string,
): Record<string, number> {
  const overlayPath = path.join(workspaceRoot, LEGACY_DEVELOPMENT_OVERLAY_PATH);
  if (!fs.existsSync(overlayPath)) {
    return {};
  }

  const overlay = readJsonObject(overlayPath);
  const ports = overlay.ports;
  if (ports === null || typeof ports !== 'object' || Array.isArray(ports)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(ports).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}
