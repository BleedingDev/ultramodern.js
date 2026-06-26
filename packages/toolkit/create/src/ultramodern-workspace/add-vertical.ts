import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_PACKAGE_VERSION } from '../ultramodern-package-source';
import {
  createAppEnvDts,
  createAppRuntimeConfig,
  createShellFrameComponent,
} from './app-files';
import { createGeneratedContract } from './contracts';
import {
  createShellPage,
  createShellRemoteComponents,
} from './demo-components';
import {
  appHasEffectApi,
  appI18nNamespace,
  createModuleFederationRemoteContracts,
  createNeutralOwnership,
  createRemoteManifestEnv,
  createShellHost,
  createVerticalDescriptor,
  effectApiPrefix,
  GENERATED_CONTRACT_PATH,
  remoteDependencyAlias,
  shellApp,
  zephyrRemoteDependency,
} from './descriptors';
import {
  createShellEffectClient,
  effectApiTopologyMetadata,
} from './effect-api';
import { readJsonFile, writeFileReplacing, writeJsonFile } from './fs-io';
import {
  createFileSnapshot,
  createGenerationResult,
  diffFileSnapshots,
} from './generation-result';
import { createAppPublicLocaleMessages } from './locales';
import { createShellModuleFederationConfig } from './module-federation';
import {
  assertUniqueTailwindPrefixes,
  normalizePath,
  packageName,
  toEnvSegment,
  toKebabCase,
  toPackageScope,
  toPascalCase,
} from './naming';
import { runCodeSmithOverlays } from './overlays';
import {
  createAppPackage,
  createAppTsConfig,
  createRootPackageJson,
  createRootTsConfig,
} from './package-json';
import { resolvePackageSource } from './package-source';
import { createCloudflareDeployContract } from './policy';
import {
  createPublicWebAppArtifacts,
  rewriteWorkspaceAssetsForApp,
} from './public-surface';
import type {
  AddUltramodernVerticalOptions,
  JsonValue,
  Ownership,
  ResolvedPackageSource,
  UltramodernGenerationResult,
  UltramodernJsonMutation,
  UltramodernShellDependencyChange,
  UltramodernVerticalPlan,
  UltramodernWorkspaceOptions,
  WorkspaceApp,
  WorkspaceEffectApi,
} from './types';
import { isRecord } from './types';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-workspace';

const FIRST_VERTICAL_PORT = 4101;
const TOPOLOGY_PATH = 'topology/reference-topology.json';
const OWNERSHIP_PATH = 'topology/ownership.json';
const DEVELOPMENT_OVERLAY_PATH = 'topology/local-overlays/development.json';
const PACKAGE_SOURCE_METADATA_PATH =
  '.modernjs/ultramodern-package-source.json';

export type AddUltramodernVerticalPreflight = {
  name: string;
  scope: string;
  topologyPath: string;
  ownershipPath: string;
  overlayPath: string;
  rootPackage: Record<string, any>;
  topology: Record<string, any>;
  ownership: Record<string, any>;
  overlay: Record<string, any>;
  packageSource: ResolvedPackageSource;
  enableTailwind: boolean;
  vertical: WorkspaceApp;
  updatedVerticals: WorkspaceApp[];
};

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

  const metadataPath = path.join(
    workspaceRoot,
    '.modernjs/ultramodern-package-source.json',
  );
  if (!fs.existsSync(metadataPath)) {
    return resolvePackageSource({
      targetDir: workspaceRoot,
      packageName: path.basename(workspaceRoot),
      modernVersion,
    });
  }

  const metadata = readJsonFile(metadataPath);
  const aliases = metadata.modernPackages?.aliases ?? {};
  const firstAlias = Object.values(aliases).find(
    (value): value is string => typeof value === 'string',
  );
  const firstPackage = Object.keys(aliases)[0];
  const aliasScope = firstAlias?.match(/^@([^/]+)\//)?.[1];
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
        : modernVersion,
    registry: metadata.modernPackages?.registry,
    aliasScope,
    aliasPackageNamePrefix,
  };
}

export function existingTailwindEnabled(workspaceRoot: string): boolean {
  const contractPath = path.join(workspaceRoot, GENERATED_CONTRACT_PATH);
  if (!fs.existsSync(contractPath)) {
    return true;
  }
  const contract = readJsonFile(contractPath);
  const apps =
    isRecord(contract) && Array.isArray(contract.apps) ? contract.apps : [];
  const shell = apps.find(
    (app: unknown): app is Record<string, JsonValue> =>
      isRecord(app) && app.id === shellApp.id,
  );
  return shell?.styling && isRecord(shell.styling)
    ? shell.styling.tailwind !== false
    : true;
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

export function updateRootWorkspaceScripts(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[],
) {
  const packagePath = path.join(workspaceRoot, 'package.json');
  const rootPackage = readJsonFile(packagePath);
  const generatedRootPackage = createRootPackageJson(
    scope,
    packageSource,
    remotes,
  ) as Record<string, any>;
  rootPackage.scripts = generatedRootPackage.scripts;
  writeJsonFile(packagePath, rootPackage as JsonValue);
}

export function rewriteShellAppFiles(
  workspaceRoot: string,
  scope: string,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[],
) {
  const shellHost = createShellHost(remotes);
  const publicWeb = createPublicWebAppArtifacts(shellHost);
  writeJsonFile(
    path.join(workspaceRoot, `${shellApp.directory}/package.json`),
    createAppPackage(scope, shellHost, packageSource, enableTailwind, remotes),
  );
  writeJsonFile(
    path.join(workspaceRoot, `${shellApp.directory}/tsconfig.json`),
    createAppTsConfig(shellHost, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(shellHost, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.jsonLdHelperFile.path,
    publicWeb.jsonLdHelperFile.content,
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.routeMetadataFile.path,
    publicWeb.routeMetadataFile.content,
  );
  writeFileReplacing(
    workspaceRoot,
    publicWeb.routeHeadFile.path,
    publicWeb.routeHeadFile.content,
  );
  for (const generatedFile of publicWeb.routeMetaFiles) {
    writeFileReplacing(
      workspaceRoot,
      generatedFile.path,
      generatedFile.content,
    );
  }
  rewriteWorkspaceAssetsForApp(workspaceRoot, shellHost);
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/modern.runtime.ts`,
    createAppRuntimeConfig(shellHost, scope, remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/en/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/en/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'en', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/cs/translation.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', remotes),
  );
  writeJsonFile(
    path.join(
      workspaceRoot,
      `${shellApp.directory}/locales/cs/${appI18nNamespace(shellHost)}.json`,
    ),
    createAppPublicLocaleMessages(shellHost, 'cs', remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/module-federation.config.ts`,
    createShellModuleFederationConfig(scope, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/[lang]/page.tsx`,
    createShellPage(remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/vertical-components.tsx`,
    createShellRemoteComponents(scope, remotes),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/routes/shell-frame.tsx`,
    createShellFrameComponent(),
  );
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/effect/vertical-clients.ts`,
    createShellEffectClient(scope, remotes),
  );
}

export function addShellZephyrDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage['zephyr:dependencies'] ??= {};
  shellPackage['zephyr:dependencies'][remoteDependencyAlias(remote)] =
    zephyrRemoteDependency(scope, remote);
  writeJsonFile(packagePath, shellPackage as JsonValue);
}

export function addShellWorkspaceDependency(
  workspaceRoot: string,
  scope: string,
  remote: WorkspaceApp,
) {
  if (!appHasEffectApi(remote)) {
    return;
  }

  const packagePath = path.join(
    workspaceRoot,
    shellApp.directory,
    'package.json',
  );
  const shellPackage = readJsonFile(packagePath);
  shellPackage.dependencies ??= {};
  shellPackage.dependencies[packageName(scope, remote.packageSuffix)] =
    WORKSPACE_PACKAGE_VERSION;
  writeJsonFile(packagePath, shellPackage as JsonValue);
}

export function verticalTopologyEntry(
  scope: string,
  vertical: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  return {
    id: vertical.id,
    kind: vertical.kind,
    domain: vertical.domain,
    package: packageName(scope, vertical.packageSuffix),
    path: vertical.directory,
    moduleFederation: {
      role: 'remote',
      name: vertical.mfName,
      manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
      exposes: Object.keys(vertical.exposes ?? {}),
      ...(vertical.verticalRefs?.length
        ? {
            verticalRefs: vertical.verticalRefs,
            remotes: createModuleFederationRemoteContracts(vertical, remotes),
          }
        : {}),
      ssr: true,
      fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    ...(effectApiTopologyMetadata(vertical)
      ? { api: effectApiTopologyMetadata(vertical) }
      : {}),
    cloudflare: createCloudflareDeployContract(scope, vertical),
    ownership: vertical.ownership,
  };
}

export function ownershipEntry(
  scope: string,
  owner: {
    id: string;
    packageSuffix: string;
    directory: string;
    ownership: Ownership;
  },
): JsonValue {
  return {
    id: owner.id,
    package: packageName(scope, owner.packageSuffix),
    path: owner.directory,
    ownership: owner.ownership,
  };
}

export function verticalsFromTopology(
  topology: Record<string, any>,
  ports: Record<string, unknown>,
) {
  return (topology.verticals ?? []).map((vertical: any) => {
    const domain = vertical.domain ?? String(vertical.id);
    const packageSuffix = vertical.package?.split('/').at(-1) ?? domain;
    const effectApi = vertical.api?.effect
      ? ({
          stem:
            typeof vertical.api.effect.basePath === 'string'
              ? (vertical.api.effect.basePath
                  .split('/')
                  .filter(Boolean)
                  .at(-1) ?? domain)
              : domain,
          prefix: vertical.api.effect.bff?.prefix ?? `/${domain}-api`,
          consumedBy: Array.isArray(vertical.api.effect.consumedBy)
            ? vertical.api.effect.consumedBy
            : [shellApp.id, vertical.id],
        } satisfies WorkspaceEffectApi)
      : undefined;

    return {
      id: vertical.id,
      directory:
        typeof vertical.path === 'string'
          ? vertical.path
          : `verticals/${domain}`,
      packageSuffix,
      displayName: vertical.displayName ?? `${toPascalCase(domain)} Vertical`,
      kind: 'vertical',
      domain,
      portEnv: `VERTICAL_${toEnvSegment(domain)}_PORT`,
      port: typeof ports[vertical.id] === 'number' ? ports[vertical.id] : 0,
      mfName:
        vertical.moduleFederation?.name ?? `vertical${toPascalCase(domain)}`,
      ...(Array.isArray(vertical.moduleFederation?.exposes)
        ? {
            exposes: Object.fromEntries(
              vertical.moduleFederation.exposes.map((expose: string) => [
                expose,
                expose === './Route'
                  ? './src/federation-entry.tsx'
                  : expose === './Widget'
                    ? `./src/components/${domain}-widget.tsx`
                    : '',
              ]),
            ),
          }
        : {}),
      ...(Array.isArray(vertical.moduleFederation?.verticalRefs)
        ? { verticalRefs: vertical.moduleFederation.verticalRefs }
        : Array.isArray(vertical.moduleFederation?.remotes)
          ? {
              verticalRefs: vertical.moduleFederation.remotes
                .map((entry: any) => entry.id)
                .filter((id: unknown): id is string => typeof id === 'string'),
            }
          : {}),
      ...(effectApi ? { effectApi } : {}),
      ownership: vertical.ownership ?? createNeutralOwnership(vertical.id),
    };
  }) as WorkspaceApp[];
}

export function prepareAddUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): AddUltramodernVerticalPreflight {
  const name = assertValidVerticalName(options.name);
  const topologyPath = path.join(options.workspaceRoot, TOPOLOGY_PATH);
  const ownershipPath = path.join(options.workspaceRoot, OWNERSHIP_PATH);
  const overlayPath = path.join(
    options.workspaceRoot,
    DEVELOPMENT_OVERLAY_PATH,
  );

  const rootPackage = readRequiredJsonObject(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const topology = readRequiredJsonObject(topologyPath);
  const ownership = readRequiredJsonObject(ownershipPath);
  const overlay = readRequiredJsonObject(overlayPath);
  readRequiredJsonObject(
    path.join(options.workspaceRoot, GENERATED_CONTRACT_PATH),
  );
  readRequiredJsonObject(
    path.join(options.workspaceRoot, PACKAGE_SOURCE_METADATA_PATH),
  );

  assertOptionalJsonObject(topology.shell, 'topology.shell', topologyPath);
  assertOptionalJsonArray(
    topology.verticals,
    'topology.verticals',
    topologyPath,
  );
  assertOptionalJsonArray(ownership.owners, 'ownership.owners', ownershipPath);
  assertOptionalJsonObject(overlay.ports, 'overlay.ports', overlayPath);
  assertOptionalJsonObject(overlay.manifests, 'overlay.manifests', overlayPath);
  assertOptionalJsonObject(overlay.apis, 'overlay.apis', overlayPath);

  overlay.ports ??= {};
  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );
  const packageSource = existingPackageSource(
    options.workspaceRoot,
    options.modernVersion,
    options.packageSource,
  );
  const enableTailwind =
    options.enableTailwind ?? existingTailwindEnabled(options.workspaceRoot);
  const existingVerticals = verticalsFromTopology(topology, overlay.ports);
  const port = nextAvailablePort(overlay.ports);
  const vertical = createVerticalDescriptor(name, port);
  const updatedVerticals = [...existingVerticals, vertical];
  const allApps = [shellApp, ...updatedVerticals];

  assertCanCreate(options.workspaceRoot, vertical.directory);
  validateWorkspaceAppDescriptors(allApps);
  validateUniqueWorkspaceAppDescriptors(allApps);
  assertUniqueTailwindPrefixes(allApps);

  return {
    name,
    scope,
    topologyPath,
    ownershipPath,
    overlayPath,
    rootPackage,
    topology,
    ownership,
    overlay,
    packageSource,
    enableTailwind,
    vertical,
    updatedVerticals,
  };
}

function readRequiredJsonObject(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing UltraModern workspace file: ${filePath}`);
  }

  const value = readJsonFile(filePath);
  if (!isRecord(value)) {
    throw new Error(
      `UltraModern workspace file must contain a JSON object: ${filePath}`,
    );
  }

  return value;
}

function assertOptionalJsonObject(
  value: JsonValue | undefined,
  label: string,
  filePath: string,
) {
  if (value !== undefined && !isRecord(value)) {
    throw new Error(`${label} in ${filePath} must be a JSON object`);
  }
}

function assertOptionalJsonArray(
  value: JsonValue | undefined,
  label: string,
  filePath: string,
) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${label} in ${filePath} must be a JSON array`);
  }
}

function validateWorkspaceAppDescriptors(apps: WorkspaceApp[]) {
  for (const app of apps) {
    const appLabel =
      typeof app.id === 'string' && app.id ? app.id : '<unknown>';
    assertNonEmptyString(app.id, `app id for ${appLabel}`);
    assertNonEmptyString(app.directory, `directory for ${appLabel}`);
    assertSafeOutputPath(app.directory, appLabel);
    assertNonEmptyString(app.packageSuffix, `package suffix for ${appLabel}`);
    assertNonEmptyString(app.displayName, `display name for ${appLabel}`);
    if (app.kind !== 'shell' && app.kind !== 'vertical') {
      throw new Error(`Invalid app kind for ${appLabel}: ${String(app.kind)}`);
    }
    assertNonEmptyString(app.portEnv, `port env for ${appLabel}`);
    if (
      typeof app.port !== 'number' ||
      !Number.isFinite(app.port) ||
      app.port <= 0
    ) {
      throw new Error(`Invalid development port for ${appLabel}`);
    }
    assertNonEmptyString(app.mfName, `Module Federation name for ${appLabel}`);
    if (app.effectApi) {
      assertNonEmptyString(
        app.effectApi.prefix,
        `Effect API prefix for ${appLabel}`,
      );
      if (!app.effectApi.prefix.startsWith('/')) {
        throw new Error(
          `Effect API prefix for ${appLabel} must start with "/"`,
        );
      }
    }
  }
}

function validateUniqueWorkspaceAppDescriptors(apps: WorkspaceApp[]) {
  assertUniqueAppField(apps, 'app id', app => app.id);
  assertUniqueAppField(apps, 'package suffix', app => app.packageSuffix);
  assertUniqueAppField(apps, 'output path', app =>
    normalizePath(app.directory),
  );
  assertUniqueAppField(apps, 'Module Federation name', app => app.mfName);
  assertUniqueAppField(apps, 'development port', app => String(app.port));
  assertUniqueAppField(apps, 'Effect API prefix', app => app.effectApi?.prefix);
  assertUniqueAppField(apps, 'manifest environment name', app =>
    app.kind === 'vertical' ? createRemoteManifestEnv(app) : undefined,
  );
}

function assertUniqueAppField(
  apps: WorkspaceApp[],
  label: string,
  readValue: (app: WorkspaceApp) => string | undefined,
) {
  const seen = new Map<string, string>();

  for (const app of apps) {
    const value = readValue(app);
    if (!value) {
      continue;
    }

    const previousId = seen.get(value);
    if (previousId) {
      throw new Error(
        `Duplicate ${label} "${value}" for ${previousId} and ${app.id}`,
      );
    }
    seen.set(value, app.id);
  }
}

function assertNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertSafeOutputPath(relativePath: string, appId: string) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/u).includes('..')
  ) {
    throw new Error(`Unsafe output path for ${appId}: ${relativePath}`);
  }
}

export function planUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernVerticalPlan {
  const preflight = prepareAddUltramodernVertical(options);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-vertical-plan-'));
  const copiedWorkspaceRoot = path.join(tempRoot, 'workspace');

  try {
    copyWorkspaceForPlan(options.workspaceRoot, copiedWorkspaceRoot);
    const plannedResult = addUltramodernVertical({
      ...options,
      workspaceRoot: copiedWorkspaceRoot,
      overlays: undefined,
    });

    return createVerticalPlan(preflight, {
      ...plannedResult,
      workspaceRoot: options.workspaceRoot,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function copyWorkspaceForPlan(
  workspaceRoot: string,
  copiedWorkspaceRoot: string,
) {
  const skippedDirectories = new Set([
    '.git',
    '.nx',
    '.output',
    'coverage',
    'dist',
    'node_modules',
  ]);

  fs.cpSync(workspaceRoot, copiedWorkspaceRoot, {
    recursive: true,
    filter: sourcePath => !skippedDirectories.has(path.basename(sourcePath)),
  });
}

function createVerticalPlan(
  preflight: AddUltramodernVerticalPreflight,
  result: UltramodernGenerationResult,
): UltramodernVerticalPlan {
  const { scope, vertical, updatedVerticals } = preflight;
  const manifestUrl = `http://localhost:${vertical.port}/mf-manifest.json`;

  return {
    ...result,
    dryRun: true,
    selectedPort: vertical.port,
    moduleFederationRemote: {
      id: vertical.id,
      name: vertical.mfName,
      manifestUrl,
    },
    ...(vertical.effectApi
      ? { effectApiPrefix: effectApiPrefix(vertical) }
      : {}),
    jsonMutations: createDryRunJsonMutations(preflight, manifestUrl),
    shellDependencyChanges: createShellDependencyChanges(scope, vertical),
    generatedContractChanges: [
      {
        path: GENERATED_CONTRACT_PATH,
        addedAppIds: [vertical.id],
        shellVerticalRefs: updatedVerticals.map(vertical => vertical.id),
      },
    ],
  };
}

function createDryRunJsonMutations(
  preflight: AddUltramodernVerticalPreflight,
  manifestUrl: string,
): UltramodernJsonMutation[] {
  const { scope, vertical } = preflight;
  const effectApiMutation: UltramodernJsonMutation[] = appHasEffectApi(vertical)
    ? [
        {
          path: DEVELOPMENT_OVERLAY_PATH,
          pointer: `/apis/${vertical.id}`,
          description: `Add local Effect API URL for ${vertical.id}`,
          value: `http://localhost:${vertical.port}${effectApiPrefix(vertical)}`,
        },
      ]
    : [];

  return [
    {
      path: TOPOLOGY_PATH,
      pointer: '/shell/verticalRefs/-',
      description: `Add ${vertical.id} to the shell vertical references`,
      value: vertical.id,
    },
    {
      path: TOPOLOGY_PATH,
      pointer: '/shell/moduleFederation/remotes/-',
      description: `Register ${vertical.id} as a Module Federation remote`,
      value: {
        id: vertical.id,
        name: vertical.mfName,
        manifestUrl,
      },
    },
    {
      path: TOPOLOGY_PATH,
      pointer: '/verticals/-',
      description: `Add topology entry for ${vertical.id}`,
      value: verticalTopologyEntry(scope, vertical),
    },
    {
      path: OWNERSHIP_PATH,
      pointer: '/owners/-',
      description: `Add ownership entry for ${vertical.id}`,
      value: ownershipEntry(scope, vertical),
    },
    {
      path: DEVELOPMENT_OVERLAY_PATH,
      pointer: `/ports/${vertical.id}`,
      description: `Reserve development port ${vertical.port}`,
      value: vertical.port,
    },
    {
      path: DEVELOPMENT_OVERLAY_PATH,
      pointer: `/manifests/${vertical.id}`,
      description: `Add local Module Federation manifest URL for ${vertical.id}`,
      value: manifestUrl,
    },
    ...effectApiMutation,
    {
      path: 'package.json',
      pointer: '/scripts',
      description: 'Regenerate workspace scripts for the new vertical set',
    },
    {
      path: `${shellApp.directory}/package.json`,
      pointer: '/dependencies',
      description: `Wire shell dependencies for ${vertical.id}`,
    },
    {
      path: 'tsconfig.json',
      pointer: '/references',
      description: `Add ${vertical.id} to the root TS-Go build graph`,
    },
    {
      path: `${shellApp.directory}/tsconfig.json`,
      pointer: '/references',
      description: `Add ${vertical.id} to the shell TS-Go project references`,
    },
    {
      path: GENERATED_CONTRACT_PATH,
      pointer: '/apps',
      description: `Regenerate contract with ${vertical.id}`,
    },
  ];
}

function createShellDependencyChanges(
  scope: string,
  vertical: WorkspaceApp,
): UltramodernShellDependencyChange[] {
  return [
    {
      path: `${shellApp.directory}/package.json`,
      section: 'zephyr:dependencies',
      packageName: remoteDependencyAlias(vertical),
      version: zephyrRemoteDependency(scope, vertical),
    },
    ...(appHasEffectApi(vertical)
      ? [
          {
            path: `${shellApp.directory}/package.json`,
            section: 'dependencies' as const,
            packageName: packageName(scope, vertical.packageSuffix),
            version: WORKSPACE_PACKAGE_VERSION,
          },
        ]
      : []),
  ];
}

export function addUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernGenerationResult {
  const beforeFiles = createFileSnapshot(options.workspaceRoot);
  const {
    scope,
    topologyPath,
    ownershipPath,
    overlayPath,
    topology,
    ownership,
    overlay,
    packageSource,
    enableTailwind,
    vertical,
    updatedVerticals,
  } = prepareAddUltramodernVertical(options);

  writeApp(
    options.workspaceRoot,
    scope,
    vertical,
    packageSource,
    enableTailwind,
  );
  topology.shell ??= {};
  topology.shell.verticalRefs ??= [];
  topology.shell.verticalRefs.push(vertical.id);
  topology.shell.moduleFederation ??= {};
  topology.shell.moduleFederation.remotes ??= [];
  topology.shell.moduleFederation.remotes.push({
    id: vertical.id,
    name: vertical.mfName,
    manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
  });
  topology.verticals ??= [];
  topology.verticals.push(verticalTopologyEntry(scope, vertical));
  ownership.owners ??= [];
  ownership.owners.push(ownershipEntry(scope, vertical));
  overlay.ports[vertical.id] = vertical.port;
  overlay.manifests ??= {};
  overlay.manifests[vertical.id] =
    `http://localhost:${vertical.port}/mf-manifest.json`;
  overlay.apis ??= {};
  overlay.apis[vertical.id] =
    `http://localhost:${vertical.port}${effectApiPrefix(vertical)}`;
  writeJsonFile(topologyPath, topology as JsonValue);
  writeJsonFile(ownershipPath, ownership as JsonValue);
  writeJsonFile(overlayPath, overlay as JsonValue);
  writeJsonFile(
    path.join(options.workspaceRoot, GENERATED_CONTRACT_PATH),
    createGeneratedContract(
      scope,
      [
        {
          ...shellApp,
          verticalRefs: updatedVerticals.map(vertical => vertical.id),
        },
        ...updatedVerticals,
      ],
      enableTailwind,
    ),
  );
  rewriteShellAppFiles(
    options.workspaceRoot,
    scope,
    packageSource,
    enableTailwind,
    updatedVerticals,
  );
  writeGeneratedWorkspaceScripts(
    options.workspaceRoot,
    scope,
    enableTailwind,
    updatedVerticals,
  );
  addShellZephyrDependency(options.workspaceRoot, scope, vertical);
  addShellWorkspaceDependency(options.workspaceRoot, scope, vertical);
  updateRootWorkspaceScripts(
    options.workspaceRoot,
    scope,
    packageSource,
    updatedVerticals,
  );
  writeJsonFile(
    path.join(options.workspaceRoot, 'tsconfig.json'),
    createRootTsConfig([
      {
        ...shellApp,
        verticalRefs: updatedVerticals.map(vertical => vertical.id),
      },
      ...updatedVerticals,
    ]),
  );
  const afterFiles = createFileSnapshot(options.workspaceRoot);
  const { createdPaths, rewrittenPaths } = diffFileSnapshots(
    beforeFiles,
    afterFiles,
  );

  const result = createGenerationResult({
    operation: 'vertical',
    workspaceRoot: options.workspaceRoot,
    packageScope: scope,
    packageSource,
    createdApps: [vertical],
    createdPaths,
    rewrittenPaths,
  });
  runCodeSmithOverlays({
    workspaceRoot: options.workspaceRoot,
    overlays: options.overlays,
    result,
  });
  return result;
}
