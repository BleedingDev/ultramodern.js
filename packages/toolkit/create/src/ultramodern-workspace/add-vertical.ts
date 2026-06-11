import fs from 'node:fs';
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
  createShellHost,
  createVerticalDescriptor,
  effectApiPrefix,
  GENERATED_CONTRACT_PATH,
  remoteDependencyAlias,
  shellApp,
  zephyrRemoteDependency,
} from './descriptors';
import {
  createEffectSharedApiContract,
  createEffectSharedApiImports,
  createShellEffectClient,
  effectApiTopologyMetadata,
  verticalEffectApiExport,
} from './effect-api';
import {
  assertSafeRelativePath,
  ensureInsideRoot,
  readJsonFile,
  writeFileReplacing,
  writeJsonFile,
} from './fs-io';
import { createAppPublicLocaleMessages } from './locales';
import { createShellModuleFederationConfig } from './module-federation';
import {
  assertUniqueTailwindPrefixes,
  packageName,
  toEnvSegment,
  toKebabCase,
  toPackageScope,
  toPascalCase,
} from './naming';
import { createAppPackage, createRootPackageJson } from './package-json';
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
  UltramodernWorkspaceOptions,
  WorkspaceApp,
  WorkspaceEffectApi,
} from './types';
import { isRecord } from './types';
import { writeGeneratedWorkspaceScripts } from './workspace-scripts';
import { writeApp } from './write-workspace';

const FIRST_VERTICAL_PORT = 4101;

export function appendEffectSharedApiContract(targetDir: string, service) {
  const relativePath = 'packages/shared-effect-api/src/index.ts';
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing generated Effect API package: ${relativePath}`);
  }
  const current = fs.readFileSync(filePath, 'utf-8');
  const apiExport = verticalEffectApiExport(service);
  if (current.includes(`export const ${apiExport} =`)) {
    return;
  }
  const contentWithImports = current.includes(
    '@modern-js/plugin-bff/effect-client',
  )
    ? current.trimEnd()
    : `${createEffectSharedApiImports()}\n${current.trimEnd()}`;
  fs.writeFileSync(
    filePath,
    `${contentWithImports}\n\n${createEffectSharedApiContract(service)}`,
    'utf-8',
  );
}

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
  writeFileReplacing(
    workspaceRoot,
    `${shellApp.directory}/src/modern-app-env.d.ts`,
    createAppEnvDts(shellHost, remotes),
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

export function addUltramodernVertical(options: AddUltramodernVerticalOptions) {
  const name = assertValidVerticalName(options.name);
  const rootPackage = readJsonFile(
    path.join(options.workspaceRoot, 'package.json'),
  );
  const scope = toPackageScope(
    String(rootPackage.name ?? path.basename(options.workspaceRoot)),
  );
  const topologyPath = path.join(
    options.workspaceRoot,
    'topology/reference-topology.json',
  );
  const ownershipPath = path.join(
    options.workspaceRoot,
    'topology/ownership.json',
  );
  const overlayPath = path.join(
    options.workspaceRoot,
    'topology/local-overlays/development.json',
  );

  for (const requiredPath of [topologyPath, ownershipPath, overlayPath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Missing UltraModern workspace file: ${requiredPath}`);
    }
  }

  const topology = readJsonFile(topologyPath);
  const ownership = readJsonFile(ownershipPath);
  const overlay = readJsonFile(overlayPath);
  overlay.ports ??= {};
  const packageSource = existingPackageSource(
    options.workspaceRoot,
    options.modernVersion,
    options.packageSource,
  );
  const enableTailwind =
    options.enableTailwind ?? existingTailwindEnabled(options.workspaceRoot);
  const port = nextAvailablePort(overlay.ports);

  const vertical = createVerticalDescriptor(name, port);
  assertCanCreate(options.workspaceRoot, vertical.directory);
  if (
    (topology.verticals ?? []).some((entry: any) => entry.id === vertical.id)
  ) {
    throw new Error(`Topology already contains ${vertical.id}`);
  }
  if (Object.values(overlay.ports).includes(vertical.port)) {
    throw new Error(`Development port ${vertical.port} is already in use`);
  }

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
  const updatedVerticals = verticalsFromTopology(topology, overlay.ports);
  assertUniqueTailwindPrefixes([shellApp, ...updatedVerticals]);
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
}
