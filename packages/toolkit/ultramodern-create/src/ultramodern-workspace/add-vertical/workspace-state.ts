import fs from 'node:fs';
import path from 'node:path';
import type { UltramodernToolingConfig } from '../../ultramodern-tooling/config';
import { packageName, toKebabCase } from '../naming';
import { resolvePackageSource } from '../package-source';
import type { AddUltramodernShellOptions, WorkspaceApp } from '../types';
import { FIRST_VERTICAL_PORT } from './constants';

/** Resolve command overrides against the already normalized input snapshot. */
export function workspaceOperationSettings(
  options: AddUltramodernShellOptions,
  config: UltramodernToolingConfig,
) {
  const packageSource = options.packageSource
    ? resolvePackageSource({
        targetDir: options.workspaceRoot,
        packageName: path.basename(options.workspaceRoot),
        modernVersion: options.modernVersion,
        packageSource: options.packageSource,
      })
    : config.packageSource;
  if (!packageSource)
    throw new Error(
      `Missing UltraModern package source in workspace manifests: ${options.workspaceRoot}`,
    );
  return {
    packageSource,
    enableTailwind: options.enableTailwind ?? config.features.tailwind,
    bridge: undefined,
  };
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
      [...Object.values(ports)].filter(
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
