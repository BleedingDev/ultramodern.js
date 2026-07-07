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

export function nextAvailablePort(ports: Record<string, unknown>): number {
  const numericPorts = Object.values(ports).filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  return Math.max(FIRST_VERTICAL_PORT - 1, ...numericPorts) + 1;
}

export function assertCanCreate(workspaceRoot: string, relativePath: string) {
  if (fs.existsSync(path.join(workspaceRoot, relativePath))) {
    throw new Error(`Refusing to overwrite existing path: ${relativePath}`);
  }
}
