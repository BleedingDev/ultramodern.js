import fs from 'node:fs';
import path from 'node:path';
import { migratedWorkspaceScriptArtifacts } from '../../ultramodern-workspace/workspace-scripts';
import {
  normalizeCompactUltramodernConfig,
  synthesizeCompactUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from '../config';
import type { CommandContext } from './context';
import {
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
  workspaceUsesDependency,
} from './migrate-strict-effect/pnpm-policy';
import {
  updateGeneratedToolchainFiles,
  updateRootPackageToolchain,
} from './migrate-strict-effect/toolchain-pins';
import { hasFlag } from './options';

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
    io.write(compactPath, `${JSON.stringify(raw, null, 2)}\n`);
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

  updateUltramodernConfig(io, raw, packageSource);
  updateReferenceTopology(io);
  const migrated = normalizeCompactUltramodernConfig(io.workspaceRoot, raw);
  const migratedApps = workspaceAppsFromToolingConfig(migrated);
  const shellOnly = !migrated.topology.apps.some(app => app.api);

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
    removeStaleBackendFederationArtifacts(io, migrated);
    updateGeneratedZeropsArtifacts(io, migrated);
    updateGeneratedBackendFederationContractFiles(io, migrated);
  }

  // Materialize the full workspace-owned script/wrapper set migrate must
  // converge to (agent skills bootstrap, reference-repo installer, i18n/api
  // boundary checks, performance-readiness config, and every tool wrapper),
  // gated on shell-only just like fresh scaffolds and the validator contract.
  // Previously migrate only refreshed tool wrappers, leaving legacy .mjs
  // agent/i18n scripts un-migrated and the stock contract:check unsatisfiable.
  for (const artifact of migratedWorkspaceScriptArtifacts({ shellOnly })) {
    if (artifact.legacyPath) {
      io.remove(path.join(io.workspaceRoot, artifact.legacyPath));
    }
    io.write(
      path.join(io.workspaceRoot, artifact.relativePath),
      artifact.content,
    );
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
      packageJson.modernjs ??= {};
      packageJson.modernjs.packageSource = {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern.json',
      };
      updateRootPackageToolchain(packageJson);
    }

    updateModernDependencies(packageJson, packageSource);
    updateGeneratedToolingDependencies(packageJson);
    updateGeneratedPackageScripts(packageJson, {
      relativePackageFile,
      apps: migratedApps,
      shellOnly,
    });

    writeJsonFile(io, packageFile, packageJson);
  }

  updateGeneratedPnpmWorkspacePolicy(io);
  updateGeneratedToolchainFiles(io);
  ensureGeneratedDeclarationPatches(io, {
    includeDrizzleOrmPatch: workspaceUsesDependency(
      io.workspaceRoot,
      'drizzle-orm',
    ),
  });
  ensureGeneratedOxfmtIgnorePatterns(io);

  if (!skipInstall) {
    const status = runPnpmLockfileRefresh(context);
    if (status !== 0) {
      return status;
    }
  }

  if (dryRun) {
    for (const line of io.plan) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(
      `[dry-run] migrate-strict-effect would migrate UltraModern strict Effect metadata to ${packageSource.modernPackageVersion}.\n`,
    );
    return 0;
  }

  process.stdout.write(
    `UltraModern strict Effect metadata migrated to ${packageSource.modernPackageVersion}. Run pnpm api:check && pnpm contract:check next.\n`,
  );
  return 0;
}
