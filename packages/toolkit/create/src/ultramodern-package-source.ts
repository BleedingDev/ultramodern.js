export const WORKSPACE_PACKAGE_VERSION = 'workspace:*';
export const BLEEDINGDEV_CREATE_PACKAGE = '@bleedingdev/modern-js-create';
export const BLEEDINGDEV_PACKAGE_SCOPE = 'bleedingdev';
export const BLEEDINGDEV_PACKAGE_NAME_PREFIX = 'modern-js-';
export const BLEEDINGDEV_FRAMEWORK_VERSION_ENV =
  'MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION';

export const ULTRAMODERN_SINGLE_APP_MODERN_PACKAGES = [
  '@modern-js/runtime',
  '@modern-js/app-tools',
  '@modern-js/tsconfig',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-bff',
  '@modern-js/adapter-rstest',
] as const;

export const ULTRAMODERN_WORKSPACE_MODERN_PACKAGES = [
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

export type UltramodernModernPackagesMetadata = {
  packages: string[];
  specifier: string;
  registry?: string;
  aliases?: Record<string, string>;
};

export function modernPackageVersion(
  packageSource: ResolvedUltramodernPackageSource,
): string {
  return packageSource.strategy === 'install'
    ? packageSource.modernPackageVersion
    : WORKSPACE_PACKAGE_VERSION;
}

export function modernAliasPackageName(
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

export function modernPackageAliases(
  packageNames: readonly string[],
  packageSource: ResolvedUltramodernPackageSource,
): Record<string, string> | undefined {
  if (!packageSource.aliasScope) {
    return undefined;
  }

  return Object.fromEntries(
    packageNames.map(packageName => [
      packageName,
      modernAliasPackageName(packageName, packageSource),
    ]),
  );
}

export function createModernPackagesMetadata(
  packageNames: readonly string[],
  packageSource: ResolvedUltramodernPackageSource,
  options: { includeAliases?: boolean } = {},
): UltramodernModernPackagesMetadata {
  const includeAliases =
    options.includeAliases ?? Boolean(packageSource.aliasScope);
  const aliases = includeAliases
    ? modernPackageAliases(packageNames, packageSource)
    : undefined;

  return {
    packages: [...packageNames],
    specifier: modernPackageVersion(packageSource),
    ...(packageSource.registry ? { registry: packageSource.registry } : {}),
    ...(aliases ? { aliases } : {}),
  };
}
