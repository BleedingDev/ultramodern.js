import {
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  type ResolvedUltramodernPackageSource,
  WORKSPACE_PACKAGE_VERSION,
} from '../../../ultramodern-package-source';
import { isCreatePackageSourceCheckout } from '../../../ultramodern-release-cohort';
import { readUltramodernConfig } from '../../config';
import { hasFlag, readOption } from '../options';

export function createMigrationPackageSource(
  args: string[],
  current: ReturnType<typeof readUltramodernConfig>,
): ResolvedUltramodernPackageSource {
  const workspaceRequested = hasFlag(args, '--workspace');
  const explicitInstallRequested =
    !workspaceRequested &&
    (current.packageSource?.strategy === 'install' ||
      [
        '--version',
        '--ultramodern-package-version',
        '--registry',
        '--ultramodern-package-registry',
        '--ultramodern-package-scope',
        '--ultramodern-package-name-prefix',
      ].some(option => readOption(args, option) !== undefined));
  if (isCreatePackageSourceCheckout() && explicitInstallRequested) {
    throw new Error(
      'A local @modern-js/create source checkout cannot migrate an explicit install package source. Use --workspace locally or run the packed published package with its authenticated release cohort projection.',
    );
  }
  const strategy =
    workspaceRequested || isCreatePackageSourceCheckout()
      ? 'workspace'
      : 'install';
  const registry =
    readOption(args, '--registry') ??
    readOption(args, '--ultramodern-package-registry') ??
    current.packageSource?.registry;
  const explicitAliasScope = readOption(args, '--ultramodern-package-scope');
  const aliasScope =
    explicitAliasScope ??
    (strategy === 'install' && registry === undefined
      ? (current.packageSource?.aliasScope ?? BLEEDINGDEV_PACKAGE_SCOPE)
      : current.packageSource?.aliasScope);
  const aliasPackageNamePrefix =
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
