import fs from 'node:fs';
import path from 'node:path';
import { readUltramodernConfig } from '../../ultramodern-tooling/config';
import type { UltramodernBridgeConfig } from '../bridge-config';
import { ULTRAMODERN_CONFIG_PATH } from '../descriptors';
import { packageName, toKebabCase } from '../naming';
import { resolvePackageSource } from '../package-source';
import type {
  ResolvedPackageSource,
  UltramodernWorkspaceOptions,
  WorkspaceApp,
} from '../types';
import { FIRST_VERTICAL_PORT } from './constants';

export function existingPackageSource(
  workspaceRoot: string,
  modernVersion: string,
  packageSource?: UltramodernWorkspaceOptions['packageSource'],
): ResolvedPackageSource {
  if (packageSource) {
    return resolvePackageSource({
      targetDir: workspaceRoot,
      packageName: path.basename(workspaceRoot),
      modernVersion,
      packageSource,
    });
  }

  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  if (fs.existsSync(compactPath)) {
    const compactConfig = readUltramodernConfig(workspaceRoot);
    if (compactConfig.packageSource) {
      return compactConfig.packageSource;
    }
  }

  throw new Error(`Missing UltraModern workspace file: ${compactPath}`);
}

export function existingTailwindEnabled(workspaceRoot: string): boolean {
  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  if (fs.existsSync(compactPath)) {
    return readUltramodernConfig(workspaceRoot).features.tailwind;
  }

  throw new Error(`Missing UltraModern workspace file: ${compactPath}`);
}

export function existingBridgeConfig(
  workspaceRoot: string,
): UltramodernBridgeConfig | undefined {
  const compactPath = path.join(workspaceRoot, ULTRAMODERN_CONFIG_PATH);
  return fs.existsSync(compactPath)
    ? readUltramodernConfig(workspaceRoot).bridge
    : undefined;
}

export function assertValidVerticalName(name: string): string {
  const normalized = toKebabCase(name);
  if (!normalized || normalized !== name) {
    throw new Error(
      `Invalid Vertical name "${name}". Use lowercase kebab-case.`,
    );
  }
  return normalized;
}

export function configuredDevelopmentPorts(
  ports: Record<string, unknown>,
  additionalShells: WorkspaceApp[] = [],
): number[] {
  return [
    ...new Set(
      [
        ...Object.values(ports),
        ...additionalShells.map(shell => shell.port),
      ].filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      ),
    ),
  ];
}

export function assertGlobalPortUniqueness(
  ports: Record<string, unknown>,
  additionalShells: WorkspaceApp[] = [],
) {
  const owners = new Map<number, string>();
  for (const [id, value] of Object.entries(ports)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const previous = owners.get(value);
    if (previous) {
      throw new Error(
        `Duplicate development port "${value}" for ${previous} and ${id}.`,
      );
    }
    owners.set(value, id);
  }
  for (const shell of additionalShells) {
    const previous = owners.get(shell.port);
    if (previous) {
      throw new Error(
        `Duplicate development port "${shell.port}" for ${previous} and ${shell.id}.`,
      );
    }
    owners.set(shell.port, shell.id);
  }
}

/**
 * Allocate from the one workspace-wide port set. The caller supplies the
 * lower bound for its app class (verticals start at 4101; additional shells at
 * 3120), while existing overlay and shell ports always participate.
 */
export function nextAvailablePort(
  ports: Record<string, unknown>,
  additionalShells: WorkspaceApp[] = [],
  minimumPort = FIRST_VERTICAL_PORT,
): number {
  const used = new Set(configuredDevelopmentPorts(ports, additionalShells));
  let candidate = minimumPort;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export function assertCanCreate(workspaceRoot: string, relativePath: string) {
  if (fs.existsSync(path.join(workspaceRoot, relativePath))) {
    throw new Error(`Refusing to overwrite existing path: ${relativePath}`);
  }
}
