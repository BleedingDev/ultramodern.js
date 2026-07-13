import fs from 'node:fs';
import path from 'node:path';
import {
  RELEASE_COHORT_PROJECTION_PATH,
  readCreateReleaseCohort,
} from '../../ultramodern-release-cohort';
import { ULTRAMODERN_WORKSPACE_POLICY } from '../../ultramodern-workspace/policy';
import { createAdditionalShellConfigEntry } from '../../ultramodern-workspace/shells';
import type { WorkspaceApp } from '../../ultramodern-workspace/types';
import {
  createWorkspaceValidationScript,
  migratedWorkspaceScriptArtifacts,
} from '../../ultramodern-workspace/workspace-scripts';
import {
  additionalShellsFromToolingConfig,
  allWorkspaceAppsFromToolingConfig,
  normalizeCompactUltramodernConfig,
  synthesizeCompactUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import type { CommandContext } from './context';
import {
  reconcileCompactPackageSourceMetadata,
  reconcilePackageSourceMetadata,
  updateReferenceTopology,
  updateUltramodernConfig,
} from './migrate-strict-effect/api-metadata';
import {
  ensureGeneratedOxfmtIgnorePatterns,
  removeGeneratedFileIfExists,
  removeStaleBackendFederationArtifacts,
  updateGeneratedBackendFederationContractFiles,
  updateGeneratedBuildIdentityModules,
  updateGeneratedModernConfigs,
  updateGeneratedTypeScriptSurfaces,
  updateGeneratedZeropsArtifacts,
} from './migrate-strict-effect/generated-artifacts';
import { migrateStrictEffectHelp } from './migrate-strict-effect/help';
import { runPnpmLockfileRefresh } from './migrate-strict-effect/install';
import {
  createMigrationIo,
  listWorkspacePackageFiles,
  type MigrationIo,
  readJsonFile,
  writeJsonFile,
} from './migrate-strict-effect/io';
import {
  updateGeneratedPackageScripts,
  updateGeneratedToolingDependencies,
  updateModernDependencies,
} from './migrate-strict-effect/package-cohort';
import { createMigrationPackageSource } from './migrate-strict-effect/package-source';
import {
  ensureGeneratedDeclarationPatches,
  updateGeneratedPnpmWorkspacePolicy,
  validateGeneratedPnpmLockReleaseAgePolicy,
  workspaceUsesDependency,
} from './migrate-strict-effect/pnpm-policy';
import {
  updateGeneratedToolchainFiles,
  updateRootPackageToolchain,
} from './migrate-strict-effect/toolchain-pins';
import { hasFlag } from './options';

const retiredMetadataPaths = [
  '.modernjs/ultramodern-generated-contract.json',
  '.modernjs/ultramodern-package-source.json',
  '.modernjs/ultramodern-workspace-template-manifest.json',
] as const;

const rootPackageSourceOwnedKeys = [
  ...ULTRAMODERN_WORKSPACE_POLICY.metadata.packageSource.ownedKeys,
  'config',
] as const;

function requireRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

function reconcileRootPackageSourceMetadata(
  packageJson: Record<string, any>,
  packageSource: ReturnType<typeof createMigrationPackageSource>,
) {
  const modernjs =
    packageJson.modernjs === undefined
      ? {}
      : requireRecord(packageJson.modernjs, 'package.json modernjs');
  packageJson.modernjs = modernjs;
  modernjs.packageSource = reconcilePackageSourceMetadata(
    modernjs.packageSource,
    {
      canonical: {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern.json',
      },
      label: 'package.json modernjs.packageSource',
      ownedKeys: rootPackageSourceOwnedKeys,
    },
  );
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate identities.`);
  }
}

function deriveValidationContractInputs(
  workspaceRoot: string,
  migrated: ReturnType<typeof normalizeCompactUltramodernConfig>,
  migratedApps: WorkspaceApp[],
) {
  const rootPackage = readJsonFile(path.join(workspaceRoot, 'package.json'));
  const scope = requireString(rootPackage.name, 'Root package name');
  if (migrated.workspace.packageScope !== scope) {
    throw new Error(
      `Compact package scope ${migrated.workspace.packageScope} does not match root package ${scope}.`,
    );
  }

  const topologyPath = path.join(
    workspaceRoot,
    'topology/reference-topology.json',
  );
  if (!fs.existsSync(topologyPath)) {
    throw new Error(
      'Cannot render the migration validation contract without topology/reference-topology.json.',
    );
  }
  const topology = readJsonFile(topologyPath);
  const shell = requireRecord(topology.shell, 'Reference topology shell');
  if (!Array.isArray(topology.verticals)) {
    throw new Error('Reference topology verticals must be an array.');
  }
  const verticals: Record<string, any>[] = topology.verticals.map(
    (value: unknown, index: number) =>
      requireRecord(value, `Reference topology verticals[${index}]`),
  );
  const expectedApps = [
    {
      id: requireString(shell.id, 'Reference topology shell.id'),
      kind: 'shell',
      packageName: requireString(
        shell.package,
        'Reference topology shell.package',
      ),
      path: undefined,
      hasApi: false,
    },
    ...verticals.map((vertical, index) => ({
      id: requireString(
        vertical.id,
        `Reference topology verticals[${index}].id`,
      ),
      kind: 'vertical',
      packageName: requireString(
        vertical.package,
        `Reference topology verticals[${index}].package`,
      ),
      path: requireString(
        vertical.path,
        `Reference topology verticals[${index}].path`,
      ),
      hasApi: vertical.api !== undefined,
    })),
  ];
  assertUnique(
    expectedApps.map(app => app.id),
    'Reference topology app cohort',
  );
  assertUnique(
    expectedApps.map(app => app.packageName),
    'Reference topology package cohort',
  );

  const migratedById = new Map(migratedApps.map(app => [app.id, app] as const));
  assertUnique(
    migratedApps.map(app => app.id),
    'Compact topology app cohort',
  );
  const expectedIds = expectedApps.map(app => app.id).sort();
  const migratedIds = migratedApps.map(app => app.id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(migratedIds)) {
    throw new Error(
      `Compact topology app cohort ${migratedIds.join(', ')} does not match reference topology ${expectedIds.join(', ')}.`,
    );
  }

  const appPackageFiles = listWorkspacePackageFiles(workspaceRoot).filter(
    relativePath =>
      relativePath.startsWith('apps/') || relativePath.startsWith('verticals/'),
  );
  const manifests = appPackageFiles.map(relativePath => ({
    relativePath,
    packageJson: readJsonFile(path.join(workspaceRoot, relativePath)),
  }));
  const manifestsByName = new Map<string, (typeof manifests)[number]>();
  for (const manifest of manifests) {
    const name = requireString(
      manifest.packageJson.name,
      `${manifest.relativePath} name`,
    );
    if (manifestsByName.has(name)) {
      throw new Error(`Duplicate workspace app package name ${name}.`);
    }
    manifestsByName.set(name, manifest);
  }

  const tailwindStates: boolean[] = [];
  for (const expected of expectedApps) {
    const app = migratedById.get(expected.id);
    if (!app || app.kind !== expected.kind) {
      throw new Error(
        `Compact topology app ${expected.id} does not match reference kind ${expected.kind}.`,
      );
    }
    if (Boolean(app.api) !== expected.hasApi) {
      throw new Error(
        `Compact topology app ${expected.id} API presence does not match reference topology.`,
      );
    }

    const manifest = manifestsByName.get(expected.packageName);
    if (!manifest) {
      throw new Error(
        `Reference topology package ${expected.packageName} has no workspace manifest.`,
      );
    }
    const expectedManifestPath = `${app.directory}/package.json`;
    if (manifest.relativePath !== expectedManifestPath) {
      throw new Error(
        `${expected.packageName} is at ${manifest.relativePath}, expected ${expectedManifestPath}.`,
      );
    }
    if (expected.path && expected.path !== app.directory) {
      throw new Error(
        `Compact topology app ${expected.id} path ${app.directory} does not match reference path ${expected.path}.`,
      );
    }
    tailwindStates.push(
      Object.hasOwn(
        requireRecord(
          manifest.packageJson.devDependencies ?? {},
          `${manifest.relativePath} devDependencies`,
        ),
        '@rsbuild/plugin-tailwindcss',
      ),
    );
  }

  if (new Set(tailwindStates).size !== 1) {
    throw new Error(
      'Generated app package manifests disagree on the Tailwind feature state.',
    );
  }
  const enableTailwind = tailwindStates[0] ?? false;
  if (migrated.features.tailwind !== enableTailwind) {
    throw new Error(
      `Compact Tailwind state ${migrated.features.tailwind} does not match package manifests ${enableTailwind}.`,
    );
  }

  return {
    scope,
    enableTailwind,
    remotes: migratedApps.filter(app => app.kind !== 'shell'),
    primaryShell: migratedApps.find(app => app.kind === 'shell'),
    additionalShells: additionalShellsFromToolingConfig(migrated),
  };
}

/**
 * G28 shell records were initially emitted without the owner and complete
 * Module Federation projections. Reconcile those additive records before the
 * rest of migration derives artifacts, while retaining unknown consumer-owned
 * fields on each record. This also keeps an existing Delivery Unit marker
 * stable when it is already stamped.
 */
function reconcileAdditionalShellConfig(
  raw: Record<string, any>,
  migrated: ReturnType<typeof normalizeCompactUltramodernConfig>,
  migratedApps: WorkspaceApp[],
  io: ReturnType<typeof createMigrationIo>,
) {
  const additionalShells = additionalShellsFromToolingConfig(migrated);
  if (additionalShells.length === 0) {
    return migrated;
  }

  const existingShells = new Map(
    (Array.isArray(raw.shells) ? raw.shells : [])
      .filter(
        (entry: unknown): entry is Record<string, any> =>
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof entry.id === 'string',
      )
      .map((entry: Record<string, any>) => [entry.id, entry] as const),
  );
  const remotes = migratedApps.filter(app => app.kind !== 'shell');
  raw.shells = additionalShells.map(shell => ({
    ...existingShells.get(shell.id),
    ...createAdditionalShellConfigEntry(
      migrated.workspace.packageScope,
      shell,
      remotes,
    ),
  }));
  writeJsonFile(
    io,
    path.join(io.workspaceRoot, '.modernjs/ultramodern.json'),
    raw,
  );

  return normalizeCompactUltramodernConfig(io.workspaceRoot, raw);
}

function migrateStrictEffect(
  args: string[],
  context: CommandContext,
  io: MigrationIo,
  dryRun: boolean,
  skipInstall: boolean,
) {
  const compactPath = path.join(io.workspaceRoot, '.modernjs/ultramodern.json');
  let raw: Record<string, any>;
  if (fs.existsSync(compactPath)) {
    raw = readJsonFile(compactPath);
  } else {
    const synthesized = synthesizeCompactUltramodernConfig(io.workspaceRoot);
    if (!synthesized) {
      throw new Error(
        'Missing .modernjs/ultramodern.json and no legacy UltraModern metadata ' +
          '(.modernjs/ultramodern-generated-contract.json) was found to synthesize it from.',
      );
    }
    raw = synthesized.compact;
    io.log(
      `Synthesized .modernjs/ultramodern.json from legacy metadata: ${synthesized.sources.join(', ')}.`,
    );
    if (synthesized.missing.length > 0) {
      io.log(
        `Legacy metadata not found (using defaults): ${synthesized.missing.join(', ')}.`,
      );
    }
  }

  const current = normalizeCompactUltramodernConfig(io.workspaceRoot, raw);
  const packageSource = createMigrationPackageSource(args, current);
  const result = (status: number) => ({
    status,
    version: packageSource.modernPackageVersion,
  });
  const releaseCohort =
    packageSource.strategy === 'install'
      ? readCreateReleaseCohort()
      : undefined;

  // Establish both metadata shapes in memory before the first write. Invalid
  // structural input must not leave a partially cleaned workspace behind.
  reconcileCompactPackageSourceMetadata(raw.packageSource, packageSource);
  reconcileRootPackageSourceMetadata(
    readJsonFile(path.join(io.workspaceRoot, 'package.json')),
    packageSource,
  );

  // Parse and reconcile into a dry-run IO before any migration writes. A
  // structurally ambiguous policy must fail atomically instead of leaving a
  // partially migrated workspace behind.
  updateGeneratedPnpmWorkspacePolicy(
    createMigrationIo(io.workspaceRoot, true),
    packageSource,
    { releaseCohort },
  );

  updateUltramodernConfig(io, raw, packageSource);
  if (releaseCohort) {
    io.write(
      path.join(io.workspaceRoot, RELEASE_COHORT_PROJECTION_PATH),
      `${JSON.stringify(releaseCohort, null, 2)}\n`,
    );
  }
  updateReferenceTopology(io);
  let migrated = normalizeCompactUltramodernConfig(io.workspaceRoot, raw);
  let migratedApps = workspaceAppsFromToolingConfig(migrated);
  migrated = reconcileAdditionalShellConfig(raw, migrated, migratedApps, io);
  migratedApps = workspaceAppsFromToolingConfig(migrated);
  const allMigratedApps = allWorkspaceAppsFromToolingConfig(migrated);
  const validationContractInputs = deriveValidationContractInputs(
    io.workspaceRoot,
    migrated,
    migratedApps,
  );
  // Two independent gates (never conflate them): a BACKEND surface exists
  // only when some unit ships an API; DELIVERY UNITS exist whenever any
  // vertical exists at all — ui-only and horizontal-remote units still deploy
  // through Zerops even though they have no backend-federation surface.
  const verticalApps = migrated.topology.apps.filter(
    app => app.kind !== 'shell',
  );
  const hasBackendSurface = verticalApps.some(app => app.api);
  const shellOnly = verticalApps.length === 0;

  if (shellOnly) {
    io.log(
      'Shell-only workspace: skipping backend-federation and Zerops runtime stages.',
    );
    // Shell-only workspaces have no backend/Zerops surfaces, so strip any
    // backend-federation wrappers and Zerops runtime artifacts a prior scaffold
    // may have emitted. This keeps the end state coherent with the gated
    // validator contract and prevents dangling script references.
    for (const relativePath of [
      'scripts/generate-node-backend-federation.mts',
      'scripts/generate-node-backend-federation.mjs',
      'scripts/proof-node-backend-federation.mts',
      'scripts/proof-node-backend-federation.mjs',
      'scripts/materialize-zerops-runtime.mjs',
      'zerops.yaml',
    ]) {
      removeGeneratedFileIfExists(io, relativePath);
    }
  } else {
    if (hasBackendSurface) {
      removeStaleBackendFederationArtifacts(io, migrated);
      updateGeneratedBackendFederationContractFiles(io, migrated);
    } else {
      // No backend surface: strip backend-federation wrappers, keep deploys.
      for (const relativePath of [
        'scripts/generate-node-backend-federation.mts',
        'scripts/generate-node-backend-federation.mjs',
        'scripts/proof-node-backend-federation.mts',
        'scripts/proof-node-backend-federation.mjs',
      ]) {
        removeGeneratedFileIfExists(io, relativePath);
      }
    }
    updateGeneratedZeropsArtifacts(io, migrated);
  }

  // Materialize the full workspace-owned script/wrapper set migrate must
  // converge to (agent skills bootstrap, reference-repo installer, i18n/api
  // boundary checks, performance-readiness config, and every tool wrapper),
  // gated on shell-only just like fresh scaffolds and the validator contract.
  // Previously migrate only refreshed tool wrappers, leaving legacy .mjs
  // agent/i18n scripts un-migrated and the stock contract:check unsatisfiable.
  for (const artifact of migratedWorkspaceScriptArtifacts({
    shellOnly,
    hasBackendSurface,
  })) {
    if (
      artifact.relativePath === 'scripts/validate-ultramodern-workspace.mts'
    ) {
      continue;
    }
    if (artifact.legacyPath) {
      io.remove(path.join(io.workspaceRoot, artifact.legacyPath));
    }
    io.write(
      path.join(io.workspaceRoot, artifact.relativePath),
      artifact.content,
    );
  }
  io.write(
    path.join(io.workspaceRoot, 'scripts/validate-ultramodern-workspace.mts'),
    createWorkspaceValidationScript(
      validationContractInputs.scope,
      validationContractInputs.enableTailwind,
      validationContractInputs.remotes,
      releaseCohort,
      validationContractInputs.additionalShells,
      validationContractInputs.primaryShell,
    ),
  );

  for (const relativePath of retiredMetadataPaths) {
    io.remove(path.join(io.workspaceRoot, relativePath));
  }

  updateGeneratedBuildIdentityModules(io, migrated);
  updateGeneratedTypeScriptSurfaces(io, migrated);
  updateGeneratedModernConfigs(io, migrated);

  for (const relativePackageFile of listWorkspacePackageFiles(
    io.workspaceRoot,
  )) {
    const packageFile = path.join(io.workspaceRoot, relativePackageFile);
    const packageJson = readJsonFile(packageFile);

    if (relativePackageFile === 'package.json') {
      reconcileRootPackageSourceMetadata(packageJson, packageSource);
      updateRootPackageToolchain(packageJson);
    }

    updateModernDependencies(packageJson, packageSource);
    updateGeneratedToolingDependencies(packageJson);
    updateGeneratedPackageScripts(packageJson, {
      relativePackageFile,
      apps: allMigratedApps,
      shellOnly,
    });

    writeJsonFile(io, packageFile, packageJson);
  }

  updateGeneratedPnpmWorkspacePolicy(io, packageSource, { releaseCohort });
  updateGeneratedToolchainFiles(io);
  ensureGeneratedDeclarationPatches(io, {
    includeDrizzleOrmPatch: workspaceUsesDependency(
      io.workspaceRoot,
      'drizzle-orm',
    ),
  });
  ensureGeneratedOxfmtIgnorePatterns(io);

  if (!skipInstall) {
    return io.withStagedWorkspace(stagedWorkspaceRoot => {
      const status = runPnpmLockfileRefresh({
        ...context,
        workspaceRoot: stagedWorkspaceRoot,
      });
      if (status !== 0) {
        return result(status);
      }
      return validateGeneratedPnpmLockReleaseAgePolicy(
        stagedWorkspaceRoot,
        packageSource,
        { releaseCohort },
      ).then(() => {
        io.write(
          path.join(io.workspaceRoot, 'pnpm-lock.yaml'),
          fs.readFileSync(
            path.join(stagedWorkspaceRoot, 'pnpm-lock.yaml'),
            'utf-8',
          ),
        );
        return result(0);
      });
    });
  }

  if (dryRun) {
    for (const line of io.plan) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(
      `[dry-run] migrate-strict-effect would migrate UltraModern strict Effect metadata to ${packageSource.modernPackageVersion}.\n`,
    );
  }

  return result(0);
}

export function runMigrateStrictEffect(
  args: string[],
  context: CommandContext,
) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(migrateStrictEffectHelp);
    return 0;
  }

  const dryRun = hasFlag(args, '--dry-run');
  const skipInstall = dryRun || hasFlag(args, '--skip-install');
  const io = createMigrationIo(context.workspaceRoot, dryRun);
  const migration = io.transaction(
    () => migrateStrictEffect(args, context, io, dryRun, skipInstall),
    { commitWhen: migrationResult => migrationResult.status === 0 },
  );

  const report = (migrationResult: Awaited<typeof migration>) => {
    if (migrationResult.status === 0 && !dryRun) {
      process.stdout.write(
        `UltraModern strict Effect metadata migrated to ${migrationResult.version}. ` +
          'Run pnpm api:check && pnpm contract:check next.\n',
      );
    }
    return migrationResult.status;
  };

  if (migration instanceof Promise) {
    return migration.then(report);
  }
  return report(migration);
}
