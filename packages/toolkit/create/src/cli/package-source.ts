import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCreatePackageRoot } from '../create-package-root';
import {
  BLEEDINGDEV_CREATE_PACKAGE,
  BLEEDINGDEV_FRAMEWORK_VERSION_ENV,
  BLEEDINGDEV_PACKAGE_NAME_PREFIX,
  BLEEDINGDEV_PACKAGE_SCOPE,
  type ResolvedUltramodernPackageSource,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import { isCreatePackageSourceCheckout } from '../ultramodern-release-cohort';
import { getOptionValue, WORKSPACE_PROTOCOL_FLAG } from './flags';
import { runSetupCommand } from './project-setup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const createPackageRoot = resolveCreatePackageRoot(__dirname);

type UltramodernPackageSource = ResolvedUltramodernPackageSource;
type CreatePackageJson = {
  name?: string;
  version?: string;
  ultramodern?: {
    frameworkVersion?: string;
  };
};

const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const REGISTRY_LOOKUP_TIMEOUT_MS = 15_000;

export function readCreatePackageJson(): CreatePackageJson {
  const createPackageJson = path.join(createPackageRoot, 'package.json');
  return JSON.parse(fs.readFileSync(createPackageJson, 'utf-8'));
}

export function isBleedingDevCreatePackage(
  createPackage: CreatePackageJson,
): boolean {
  return createPackage.name === BLEEDINGDEV_CREATE_PACKAGE;
}

export function getBleedingDevFrameworkVersion(
  createPackage: CreatePackageJson,
  fallbackVersion: string,
): string {
  const frameworkVersion = createPackage.ultramodern?.frameworkVersion;
  return typeof frameworkVersion === 'string' && frameworkVersion.length > 0
    ? frameworkVersion
    : fallbackVersion;
}

export function detectUltramodernPackageSource(
  args: string[],
  defaultPackageVersion: string,
  createPackage: CreatePackageJson,
): UltramodernPackageSource {
  const bleedingDevDefaults = isBleedingDevCreatePackage(createPackage);
  const strategy =
    getOptionValue(args, ['--ultramodern-package-source']) ??
    (bleedingDevDefaults ? 'install' : 'workspace');
  if (strategy !== 'workspace' && strategy !== 'install') {
    console.error(
      '--ultramodern-package-source must be "workspace" or "install"',
    );
    process.exit(1);
  }
  const packageSourceStrategy =
    strategy as UltramodernPackageSource['strategy'];
  const explicitRegistry = getOptionValue(args, [
    '--ultramodern-package-registry',
  ]);
  const aliasScope =
    getOptionValue(args, ['--ultramodern-package-scope']) ??
    (bleedingDevDefaults &&
    packageSourceStrategy === 'install' &&
    !explicitRegistry
      ? BLEEDINGDEV_PACKAGE_SCOPE
      : undefined);
  return {
    strategy: packageSourceStrategy,
    modernPackageVersion:
      getOptionValue(args, ['--ultramodern-package-version']) ??
      defaultPackageVersion,
    registry: explicitRegistry,
    aliasScope,
    aliasPackageNamePrefix:
      getOptionValue(args, ['--ultramodern-package-name-prefix']) ??
      (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined),
  };
}

function hasExplicitUltramodernPackageSource(
  args: string[],
  value?: UltramodernPackageSource['strategy'],
): boolean {
  const configuredValue = getOptionValue(args, [
    '--ultramodern-package-source',
  ]);
  return value ? configuredValue === value : configuredValue !== undefined;
}

function readBleedingDevFrameworkVersionFromRegistry(
  fallbackVersion: string,
): string {
  const envVersion = process.env[BLEEDINGDEV_FRAMEWORK_VERSION_ENV]?.trim();
  if (envVersion) {
    if (!semverPattern.test(envVersion)) {
      console.error(
        `${BLEEDINGDEV_FRAMEWORK_VERSION_ENV} must be a valid semver version`,
      );
      process.exit(1);
    }
    return envVersion;
  }

  try {
    const rawVersion = runSetupCommand(
      'npm',
      [
        'view',
        `${BLEEDINGDEV_CREATE_PACKAGE}@latest`,
        'ultramodern.frameworkVersion',
        '--json',
      ],
      { timeoutMs: REGISTRY_LOOKUP_TIMEOUT_MS },
    ).trim();
    const version = JSON.parse(rawVersion);
    if (typeof version === 'string' && semverPattern.test(version)) {
      return version;
    }
  } catch {
    // Fall through to the offline-safe fallback below.
  }

  console.warn(
    [
      `Could not resolve ${BLEEDINGDEV_CREATE_PACKAGE}@latest ultramodern.frameworkVersion from the npm registry.`,
      `Falling back to the packaged framework version ${fallbackVersion}.`,
      `Pass ${WORKSPACE_PROTOCOL_FLAG} to use local workspace protocol dependencies,`,
      'or pass --ultramodern-package-version with the exact BleedingDev framework cohort.',
    ].join(' '),
  );
  return fallbackVersion;
}

function resolveInstallBackedPackageSource(
  args: string[],
  createPackage: CreatePackageJson,
  packageSource: UltramodernPackageSource,
): UltramodernPackageSource {
  const explicitVersion = getOptionValue(args, [
    '--ultramodern-package-version',
  ]);
  const explicitRegistry = getOptionValue(args, [
    '--ultramodern-package-registry',
  ]);
  const aliasScope =
    getOptionValue(args, ['--ultramodern-package-scope']) ??
    packageSource.aliasScope ??
    (explicitRegistry ? undefined : BLEEDINGDEV_PACKAGE_SCOPE);

  return {
    ...packageSource,
    strategy: 'install',
    modernPackageVersion:
      explicitVersion ??
      (isBleedingDevCreatePackage(createPackage)
        ? packageSource.modernPackageVersion
        : readBleedingDevFrameworkVersionFromRegistry(
            packageSource.modernPackageVersion,
          )),
    aliasScope,
    aliasPackageNamePrefix:
      getOptionValue(args, ['--ultramodern-package-name-prefix']) ??
      packageSource.aliasPackageNamePrefix ??
      (aliasScope ? BLEEDINGDEV_PACKAGE_NAME_PREFIX : undefined),
  };
}

export function resolveWorkspacePackageSource(
  args: string[],
  createPackage: CreatePackageJson,
  packageSource: UltramodernPackageSource,
): UltramodernPackageSource {
  const workspaceProtocolRequested = args.includes(WORKSPACE_PROTOCOL_FLAG);
  if (
    workspaceProtocolRequested &&
    hasExplicitUltramodernPackageSource(args, 'install')
  ) {
    console.error(
      `${WORKSPACE_PROTOCOL_FLAG} conflicts with --ultramodern-package-source=install`,
    );
    process.exit(1);
  }

  if (
    isCreatePackageSourceCheckout() &&
    hasExplicitUltramodernPackageSource(args, 'install')
  ) {
    console.error(
      'A local @modern-js/create source checkout cannot satisfy an explicit install package source. Use workspace mode locally or run the packed published package with its authenticated release cohort projection.',
    );
    process.exit(1);
  }

  if (
    workspaceProtocolRequested ||
    hasExplicitUltramodernPackageSource(args, 'workspace') ||
    (isCreatePackageSourceCheckout() && packageSource.strategy === 'workspace')
  ) {
    return {
      ...packageSource,
      strategy: 'workspace',
      modernPackageVersion: WORKSPACE_PACKAGE_VERSION,
    };
  }

  return resolveInstallBackedPackageSource(args, createPackage, packageSource);
}
