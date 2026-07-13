import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  assertApiAcceptance,
  assertBackendAcceptance,
  assertBrowserRuntimeAcceptance,
  assertModuleFederationAcceptance,
  assertTopologyAcceptance,
  assertWorkspaceCheckContract,
  readWorkspaceAcceptanceArtifacts,
} from './acceptance-assertions.mjs';
import {
  assertAcceptanceReceipt,
  bindSupplyChainEvidence,
  createAcceptanceReceipt,
  finalizeAcceptanceReceipt,
  recordAcceptanceResult,
} from './acceptance-receipt.mjs';
import { runBrowserSmoke } from './browser-smoke.mjs';
import { browserSmokePlaywrightPackage, writeJsonFile } from './constants.mjs';
import {
  assertGeneratedCohort,
  resolveCreatePackage,
} from './package-cohort.mjs';
import { createCleanPnpmDlxEnv, roundDurationMs, run } from './process.mjs';
import { verifyRegistryCohort } from './registry-cohort.mjs';
import {
  auditReleaseAgePolicy,
  verifyStrictInstallInputs,
  YAML_INTEGRITY,
  YAML_VERSION,
} from './release-age-audit.mjs';
import { addVertical, createWorkspace } from './workspace.mjs';

const requiredPnpmCommands = Object.freeze({
  // Resolve the dependency closure into a native lockfile without installing
  // node_modules. `@modern-js/create` intentionally does not install (it tells
  // the user to run pnpm install), so acceptance materializes the lock here —
  // against the controlled release registry — before the release-age audit
  // reads it and before the frozen install re-verifies it.
  lockfileOnly: Object.freeze([
    'install',
    '--lockfile-only',
    '--ignore-scripts',
  ]),
  install: Object.freeze(['install', '--frozen-lockfile']),
  check: Object.freeze(['check']),
  build: Object.freeze(['build']),
  cloudflareBuild: Object.freeze(['cloudflare:build']),
});

function currentTime(now) {
  return new now();
}

function createAcceptancePackageManagerEnv(workDir, registryEnv = {}) {
  const env = {
    ...createCleanPnpmDlxEnv(path.join(workDir, 'package-manager')),
    ...registryEnv,
    CI: 'true',
  };
  delete env.MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION;
  return env;
}

async function withDuration(action) {
  const startedAt = performance.now();
  const details = await action();
  return {
    ...details,
    durationMs: roundDurationMs(performance.now() - startedAt),
  };
}

function normalizedRegistryTool(registryTool) {
  return {
    name: registryTool?.name ?? 'npm-registry',
    version: registryTool?.version ?? null,
    integrity: registryTool?.integrity ?? null,
  };
}

function runtimeVersions(runImpl, registryTool) {
  return {
    node: process.version,
    npm: runImpl('npm', ['--version'], { stdio: 'pipe' }),
    pnpm: runImpl('pnpm', ['--version'], { stdio: 'pipe' }),
    playwright: browserSmokePlaywrightPackage,
    platform: process.platform,
    arch: process.arch,
    registry: normalizedRegistryTool(registryTool),
    yaml: {
      name: 'yaml',
      version: YAML_VERSION,
      integrity: YAML_INTEGRITY,
    },
  };
}

function registryReceiptMetadata({ mode, registryUrl }) {
  return {
    url: registryUrl,
    resolution: 'package-manager-registry',
    cohortPackages: 'registry-only-exact-name-and-version',
    externalDependencies:
      mode === 'source' ? 'explicit-npmjs-proxy' : 'selected-registry',
  };
}

function receiptFailure(receipt, error) {
  receipt.status = 'failed';
  receipt.passed = false;
  receipt.error = error instanceof Error ? error.message : String(error);
}

async function runAcceptanceProfile({
  mode,
  release,
  registryUrl,
  registryEnv = {},
  registryTool,
  options,
  outPath,
  runIdentity,
  releaseAgePolicyPath,
  runImpl = run,
  browserSmokeImpl = runBrowserSmoke,
  auditReleaseAgePolicyImpl = auditReleaseAgePolicy,
  now = Date,
  workDir: suppliedWorkDir,
  keepWorkDir = false,
}) {
  if (!['source', 'published'].includes(mode)) {
    throw new Error(
      `Acceptance mode must be source or published, found ${mode}`,
    );
  }
  if (options.selectedProfile.id !== 'erp-10') {
    throw new Error(
      `Release acceptance requires profile erp-10, found ${options.selectedProfile.id}`,
    );
  }
  if (options.verticals.length !== 10) {
    throw new Error('ERP-10 acceptance must generate exactly 10 verticals');
  }
  if (options.deployCloudflare) {
    throw new Error(
      'Cloudflare deployment is outside exact-artifact ERP-10 acceptance',
    );
  }

  const createPackage = resolveCreatePackage(release, options.createPackage);
  const workDir =
    suppliedWorkDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-release-acceptance-'));
  const ownsWorkDir = suppliedWorkDir === undefined;
  const projectDir = path.join(workDir, options.projectName);
  const packageManagerEnv = createAcceptancePackageManagerEnv(
    workDir,
    registryEnv,
  );
  const receipt = createAcceptanceReceipt({
    release,
    mode,
    profile: options.selectedProfile,
    createPackage,
    runtime: runtimeVersions(runImpl, registryTool),
    registry: registryReceiptMetadata({ mode, registryUrl }),
    runIdentity,
    now,
  });

  let failure;
  let audit;
  let artifacts;
  try {
    await recordAcceptanceResult(receipt, 'registry-cohort-integrity', () =>
      withDuration(() =>
        verifyRegistryCohort({
          release,
          registryUrl,
          env: packageManagerEnv,
          workDir,
          runImpl,
        }),
      ),
    );

    await recordAcceptanceResult(receipt, 'native-create', () =>
      withDuration(() => {
        createWorkspace(
          workDir,
          options.projectName,
          createPackage,
          packageManagerEnv,
          runImpl,
        );
        return {
          runner: 'pnpm dlx',
          exactSpecifier: createPackage.exactSpecifier,
          projectName: options.projectName,
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'vertical-additions', () =>
      withDuration(() => {
        for (const vertical of options.verticals) {
          addVertical(
            projectDir,
            vertical,
            createPackage,
            packageManagerEnv,
            runImpl,
          );
        }
        const cohort = assertGeneratedCohort(projectDir, release, {
          registryUrl,
        });
        return {
          count: options.verticals.length,
          verticals: options.verticals,
          frameworkVersion: createPackage.frameworkVersion,
          cohort,
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'generate-lockfile', () =>
      withDuration(() => {
        runImpl('pnpm', requiredPnpmCommands.lockfileOnly, {
          cwd: projectDir,
          env: packageManagerEnv,
        });
        return {
          command: 'pnpm install --lockfile-only --ignore-scripts',
          lockfile: 'pnpm-lock.yaml',
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'dependency-closure-audit', () =>
      withDuration(async () => {
        audit = await auditReleaseAgePolicyImpl({
          projectDir,
          release,
          registryUrl,
          policyPath: releaseAgePolicyPath,
          runImpl,
          now: currentTime(now),
        });
        bindSupplyChainEvidence(receipt, audit.digests);
        return {
          approvals: audit.approvals,
          candidateDiscovery: audit.candidateDiscovery,
          closureCount: audit.closureCount,
          digests: audit.digests,
          exactExclusionCount: audit.exactExclusions.length,
          importerCount: audit.importerCount,
          lockfileVersion: audit.lockfileVersion,
          matureCount: audit.matureCount,
          policyEntryCount: audit.policyEntryCount,
          registryMetadataCount: audit.registryMetadataCount,
          workspacePolicySha256: audit.workspacePolicySha256,
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'install', () =>
      withDuration(() => {
        const beforeInstall = verifyStrictInstallInputs(projectDir, audit, {
          now: currentTime(now),
          phase: 'before-frozen-install',
        });
        runImpl('pnpm', requiredPnpmCommands.install, {
          cwd: projectDir,
          env: packageManagerEnv,
        });
        return {
          command: 'pnpm install --frozen-lockfile',
          beforeInstall,
          afterInstall: verifyStrictInstallInputs(projectDir, audit, {
            now: currentTime(now),
            phase: 'after-frozen-install',
          }),
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'pnpm-check', () =>
      withDuration(() => {
        runImpl('pnpm', requiredPnpmCommands.check, {
          cwd: projectDir,
          env: packageManagerEnv,
        });
        return {
          command: 'pnpm check',
          ...assertWorkspaceCheckContract(projectDir),
        };
      }),
    );

    await recordAcceptanceResult(receipt, 'build', () =>
      withDuration(() => {
        runImpl('pnpm', requiredPnpmCommands.build, {
          cwd: projectDir,
          env: packageManagerEnv,
        });
        return { command: 'pnpm build' };
      }),
    );

    await recordAcceptanceResult(receipt, 'cloudflare-build', () =>
      withDuration(() => {
        runImpl('pnpm', requiredPnpmCommands.cloudflareBuild, {
          cwd: projectDir,
          env: packageManagerEnv,
        });
        return { command: 'pnpm cloudflare:build' };
      }),
    );

    await recordAcceptanceResult(receipt, 'topology', () =>
      withDuration(() => {
        artifacts = readWorkspaceAcceptanceArtifacts(projectDir);
        return assertTopologyAcceptance(artifacts, options.verticals);
      }),
    );
    await recordAcceptanceResult(receipt, 'module-federation', () =>
      withDuration(() =>
        assertModuleFederationAcceptance(artifacts, options.verticals),
      ),
    );
    await recordAcceptanceResult(receipt, 'api', () =>
      withDuration(() => assertApiAcceptance(artifacts, options.verticals)),
    );
    await recordAcceptanceResult(receipt, 'backend', () =>
      withDuration(() => assertBackendAcceptance(artifacts, options.verticals)),
    );
    await recordAcceptanceResult(receipt, 'browser-runtime', () =>
      withDuration(async () => {
        const report = await browserSmokeImpl(projectDir, { mode: 'local' });
        return assertBrowserRuntimeAcceptance(report, options.verticals);
      }),
    );
  } catch (error) {
    failure = error;
  }

  finalizeAcceptanceReceipt(receipt, failure);
  if (!failure) {
    try {
      assertAcceptanceReceipt(receipt, {
        release,
        profileId: options.selectedProfile.id,
        runIdentity,
        expectedMode: mode,
      });
    } catch (error) {
      failure = error;
      receiptFailure(receipt, error);
    }
  }
  writeJsonFile(outPath, receipt, { atomic: false });
  if (ownsWorkDir && !keepWorkDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  if (failure) {
    throw failure;
  }
  return receipt;
}

export {
  createAcceptancePackageManagerEnv,
  requiredPnpmCommands,
  runAcceptanceProfile,
  runtimeVersions,
};
