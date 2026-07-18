import {
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import type {
  ResolvedPackageSource,
  UltramodernWorkspaceOptions,
} from './types';

export function resolvePackageSource(
  options: UltramodernWorkspaceOptions,
): ResolvedPackageSource {
  const strategy = options.packageSource?.strategy ?? 'install';
  if (strategy === 'workspace') {
    return {
      strategy,
      modernPackageVersion: WORKSPACE_PACKAGE_VERSION,
      registry: options.packageSource?.registry,
      aliasScope: options.packageSource?.aliasScope,
      aliasPackageNamePrefix: options.packageSource?.aliasPackageNamePrefix,
    };
  }

  const registry = options.packageSource?.registry;
  const aliasScope =
    options.packageSource?.aliasScope ??
    (registry ? undefined : BLEEDINGDEV_PACKAGE_SCOPE);

  return {
    strategy,
    modernPackageVersion:
      options.packageSource?.modernPackageVersion ?? options.modernVersion,
    registry,
    aliasScope,
    aliasPackageNamePrefix:
      options.packageSource?.aliasPackageNamePrefix ??
      (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined),
  };
}

export function resolveWorkspacePackageLinkingPolicy(
  packageSource: Pick<ResolvedPackageSource, 'strategy'>,
): Partial<Record<'injectWorkspacePackages' | 'linkWorkspacePackages', true>> {
  return packageSource.strategy === 'workspace'
    ? {
        injectWorkspacePackages: true,
        linkWorkspacePackages: true,
      }
    : {};
}
