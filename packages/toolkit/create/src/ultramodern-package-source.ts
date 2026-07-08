export const WORKSPACE_PACKAGE_VERSION = 'workspace:*';
export const BLEEDINGDEV_CREATE_PACKAGE = '@bleedingdev/modern-js-create';
export const BLEEDINGDEV_PACKAGE_SCOPE = 'bleedingdev';
export const BLEEDINGDEV_PACKAGE_NAME_PREFIX = 'modern-js-';
export const BLEEDINGDEV_FRAMEWORK_VERSION_ENV =
  'MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION';

export const ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES = [
  '@modern-js/create',
  '@modern-js/code-tools',
  '@modern-js/runtime',
  '@modern-js/app-tools',
  '@modern-js/tsconfig',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-bff',
  '@modern-js/adapter-rstest',
] as const;

export const ULTRAMODERN_WORKSPACE_MODERN_PACKAGES = [
  '@modern-js/create',
  '@modern-js/code-tools',
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
] as const;

export type UltramodernPackageSourceStrategy = 'workspace' | 'install';

export type ResolvedUltramodernPackageSource = {
  strategy: UltramodernPackageSourceStrategy;
  modernPackageVersion: string;
  registry?: string;
  aliasScope?: string;
  aliasPackageNamePrefix?: string;
};

export function modernPackageVersion(
  packageSource: ResolvedUltramodernPackageSource,
): string {
  return packageSource.strategy === 'install'
    ? packageSource.modernPackageVersion
    : WORKSPACE_PACKAGE_VERSION;
}

function modernAliasPackageName(
  packageName: string,
  packageSource: ResolvedUltramodernPackageSource,
): string {
  if (!packageSource.aliasScope) {
    return packageName;
  }

  const scope = packageSource.aliasScope.replace(/^@/, '');
  const unscopedName = packageName.split('/').at(-1);
  return `@${scope}/${packageSource.aliasPackageNamePrefix ?? ''}${unscopedName}`;
}

export function modernPackageSpecifier(
  packageName: string,
  packageSource: ResolvedUltramodernPackageSource,
): string {
  if (packageSource.strategy !== 'install') {
    return WORKSPACE_PACKAGE_VERSION;
  }

  if (!packageSource.aliasScope) {
    return packageSource.modernPackageVersion;
  }

  return `npm:${modernAliasPackageName(packageName, packageSource)}@${
    packageSource.modernPackageVersion
  }`;
}
