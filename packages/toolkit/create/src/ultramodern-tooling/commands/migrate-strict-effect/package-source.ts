import {
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  type ResolvedUltramodernPackageSource,
  WORKSPACE_PACKAGE_VERSION,
} from '../../../ultramodern-package-source';
import { readUltramodernConfig } from '../../config';
import { hasFlag, readOption } from '../options';

export function createMigrationPackageSource(
  args: string[],
  current: ReturnType<typeof readUltramodernConfig>,
): ResolvedUltramodernPackageSource {
  const strategy = hasFlag(args, '--workspace') ? 'workspace' : 'install';
  const registry =
    readOption(args, '--registry') ??
    readOption(args, '--ultramodern-package-registry');
  const explicitAliasScope =
    readOption(args, '--alias-scope') ??
    readOption(args, '--ultramodern-package-scope');
  const aliasScope =
    explicitAliasScope ??
    (strategy === 'install' && registry === undefined
      ? (current.packageSource?.aliasScope ?? BLEEDINGDEV_PACKAGE_SCOPE)
      : current.packageSource?.aliasScope);
  const aliasPackageNamePrefix =
    readOption(args, '--alias-package-name-prefix') ??
    readOption(args, '--ultramodern-package-name-prefix') ??
    current.packageSource?.aliasPackageNamePrefix ??
    (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined);

  if (strategy === 'workspace') {
    return {
      strategy,
      modernPackageVersion: WORKSPACE_PACKAGE_VERSION,
      ...(registry ? { registry } : {}),
      ...(aliasScope ? { aliasScope } : {}),
      ...(aliasPackageNamePrefix ? { aliasPackageNamePrefix } : {}),
    };
  }

  const version =
    readOption(args, '--version') ??
    readOption(args, '--ultramodern-package-version') ??
    current.packageSource?.modernPackageVersion;

  if (!version || version === WORKSPACE_PACKAGE_VERSION) {
    throw new Error(
      'migrate-strict-effect needs --version <published-ultramodern-version> for install package source.',
    );
  }

  return {
    strategy,
    modernPackageVersion: version,
    ...(registry ? { registry } : {}),
    ...(aliasScope ? { aliasScope } : {}),
    ...(aliasPackageNamePrefix ? { aliasPackageNamePrefix } : {}),
  };
}
