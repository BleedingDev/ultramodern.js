import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseSync, transformFromAstSync, traverse, types } from '@babel/core';
import { runOperationalIndependence } from '../operational-independence.mjs';
import {
  assertApiAcceptance,
  assertBackendAcceptance,
  assertModuleFederationAcceptance,
  assertTopologyAcceptance,
  assertWorkspaceCheckContract,
  readWorkspaceAcceptanceArtifacts,
} from './acceptance-assertions.mjs';
import {
  assertReleaseAcceptanceProfile,
  assertRuntimeAcceptanceDimension,
  createOperationalIndependenceResultDetails,
  operationalIndependenceEvidencePath,
  operationalIndependenceResultId,
  runtimeAcceptanceDimensions,
  runtimeAcceptanceInvocation,
  runtimeAcceptancePlatforms,
  runtimeIdentityBinding,
} from './acceptance-contract.mjs';
import {
  assertAcceptanceReceipt,
  bindRuntimeIdentityEvidence,
  bindSupplyChainEvidence,
  createAcceptanceReceipt,
  finalizeAcceptanceReceipt,
  recordAcceptanceResult,
} from './acceptance-receipt.mjs';
import { runBrowserSmoke } from './browser-smoke.mjs';
import {
  browserSmokePlaywrightPackage,
  repoRoot,
  writeJsonFile,
} from './constants.mjs';
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
  YAML_NAME,
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
const operationalIndependenceChangedPaths = Object.freeze([
  'verticals/inventory/api/index.ts',
  'verticals/inventory/locales/en/inventory.json',
]);
const operationalIndependenceUiValue =
  'C1 operational independence: inventory UI and localization moved together.';
const operationalIndependenceApiValue =
  'Inventory C1 operational proof response';
const forbiddenDefaultOffRscDependencies = Object.freeze([
  'react-server-dom-rspack',
  'rsbuild-plugin-rsc',
]);

function assertDefaultOffRscInstall(projectDir, closureIdentities) {
  const forbiddenDependencies = forbiddenDefaultOffRscDependencies.filter(
    packageName =>
      closureIdentities.some(identity => identity.name === packageName),
  );
  if (forbiddenDependencies.length > 0) {
    throw new Error(
      `Default-off clean-room install contains forbidden RSC dependencies: ${forbiddenDependencies.join(', ')}`,
    );
  }

  const appsRoot = path.join(projectDir, 'apps');
  const appManifestPaths = fs
    .readdirSync(appsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(appsRoot, entry.name, 'package.json'))
    .filter(file => fs.existsSync(file))
    .sort();
  if (appManifestPaths.length === 0) {
    throw new Error('Default-off clean-room install has no generated app');
  }
  const appManifestPath = appManifestPaths[0];
  const appManifest = JSON.parse(fs.readFileSync(appManifestPath, 'utf8'));
  const runtimeEntry =
    createRequire(appManifestPath).resolve('@modern-js/runtime');
  const renderClient = createRequire(runtimeEntry).resolve(
    '@modern-js/render/client',
  );
  try {
    createRequire(renderClient).resolve(
      'react-server-dom-rspack/client.browser',
    );
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      return {
        appPackage: appManifest.name,
        forbiddenDependencyCount: 0,
        renderClient,
      };
    }
    throw error;
  }
  throw new Error(
    'Default-off clean-room install must not resolve react-server-dom-rspack/client.browser from @modern-js/render/client.',
  );
}

function startOwnedWorkDirGuardian(workDir) {
  const guardian = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./owned-workdir-guardian.mjs', import.meta.url)),
      String(process.pid),
      workDir,
    ],
    { detached: true, stdio: 'ignore' },
  );
  guardian.unref();
}

function currentTime(now) {
  return new now();
}

function createAcceptancePackageManagerEnv(
  workDir,
  registryEnv = {},
  pnpmExecutable,
) {
  const env = {
    ...createCleanPnpmDlxEnv(path.join(workDir, 'package-manager')),
    ...registryEnv,
    CI: 'true',
    npm_config_fetch_retries: '5',
    npm_config_fetch_timeout: '600000',
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: undefined,
    pnpm_config_fetch_retries: '5',
    pnpm_config_fetch_timeout: '600000',
    pnpm_config_network_concurrency: '8',
    ULTRAMODERN_CREATE_BIN: undefined,
    ZE_CI_TOKEN: undefined,
  };
  if (pnpmExecutable !== undefined) {
    if (!path.isAbsolute(pnpmExecutable)) {
      throw new Error(
        `Acceptance pnpm executable must be absolute: ${pnpmExecutable}`,
      );
    }
    env.PATH = [path.dirname(pnpmExecutable), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter);
  }
  // The clean room performs no Zephyr Cloud deploy, so ZE_CI_TOKEN is absent
  // and the generated build never engages Zephyr (it stays a registered but
  // inactive plugin). This tests "builds without a Zephyr Cloud account".
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
      name: YAML_NAME,
      version: YAML_VERSION,
      integrity: YAML_INTEGRITY,
    },
  };
}

function resolveExactPnpmExecutable(
  runImpl,
  expectedVersion,
  environment = process.env,
  verificationCwd = repoRoot,
) {
  if (
    typeof expectedVersion !== 'string' ||
    !/^[1-9]\d*\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(expectedVersion)
  ) {
    throw new Error(
      `Release manifest must bind an exact pnpm version, found ${String(expectedVersion)}`,
    );
  }
  const discoveryScript = `
    const fs = require('node:fs');
    const path = require('node:path');
    const names = process.platform === 'win32'
      ? ['pnpm.cmd', 'pnpm.exe', 'pnpm']
      : ['pnpm'];
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      for (const name of names) {
        const candidate = path.resolve(directory, name);
        try {
          fs.accessSync(
            candidate,
            process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
          );
          if (fs.statSync(candidate).isFile()) {
            process.stdout.write(candidate);
            process.exit(0);
          }
        } catch {}
      }
    }
    throw new Error('pnpm executable is absent from the exact pnpm exec PATH');
  `;
  const names =
    process.platform === 'win32' ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm'];
  const candidates = [];
  const provisionedExecutable = environment.ULTRAMODERN_PNPM_EXECUTABLE;
  if (provisionedExecutable !== undefined) {
    if (
      typeof provisionedExecutable !== 'string' ||
      !path.isAbsolute(provisionedExecutable)
    ) {
      throw new Error(
        `Provisioned acceptance pnpm executable must be absolute: ${String(provisionedExecutable)}`,
      );
    }
    candidates.push(provisionedExecutable);
  } else {
    try {
      const nestedExecutable = runImpl(
        'pnpm',
        ['exec', 'node', '-e', discoveryScript],
        {
          cwd: repoRoot,
          stdio: 'pipe',
        },
      );
      if (path.isAbsolute(nestedExecutable)) {
        candidates.push(nestedExecutable);
      }
    } catch {
      // mise can execute pnpm without exposing its shim in `pnpm exec` PATH.
      // Parent PATH discovery below covers that installation shape.
    }
  }
  for (const directory of (environment.PATH ?? '').split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      try {
        fs.accessSync(
          candidate,
          process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
        );
        if (fs.statSync(candidate).isFile()) {
          candidates.push(candidate);
        }
      } catch {
        // Continue exactly as executable lookup would for a missing PATH entry.
      }
    }
  }
  const observedVersions = new Set();
  for (const executable of new Set(candidates)) {
    let actualVersion;
    try {
      actualVersion = runImpl(executable, ['--version'], {
        cwd: verificationCwd,
        stdio: 'pipe',
      });
    } catch {
      continue;
    }
    if (actualVersion === expectedVersion) {
      return executable;
    }
    observedVersions.add(actualVersion);
  }
  if (observedVersions.size > 0) {
    throw new Error(
      `Exact pnpm discovery resolved ${[...observedVersions].join(', ')}, expected ${expectedVersion}`,
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      'pnpm executable is absent from the acceptance parent PATH',
    );
  }
  throw new Error(
    `No executable pnpm candidate could be verified as ${expectedVersion}`,
  );
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

function snapshotAcceptanceWorkspaceSource(projectDir, env, runImpl = run) {
  const git = (args, stdio = 'pipe') =>
    runImpl('git', args, { cwd: projectDir, env, stdio });

  git(['add', '-A'], 'inherit');
  const pending = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (pending) {
    git(
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=UltraModern Acceptance',
        '-c',
        'user.email=acceptance@ultramodern.local',
        'commit',
        '--no-verify',
        '-m',
        'test: snapshot generated ERP-10 application source',
      ],
      'inherit',
    );
  }

  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (dirty) {
    throw new Error(
      `Generated acceptance application source is dirty after snapshot commit: ${dirty}`,
    );
  }
  const revision = git(['rev-parse', 'HEAD']).toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) {
    throw new Error(
      `Generated acceptance application source revision is invalid: ${revision}`,
    );
  }
  return revision;
}

function isNamedObjectProperty(property, name) {
  return (
    types.isObjectProperty(property) &&
    !property.computed &&
    (types.isIdentifier(property.key, { name }) ||
      types.isStringLiteral(property.key, { value: name }))
  );
}

function setGeneratedInventoryApiTitle(apiPath, title) {
  const source = fs.readFileSync(apiPath, 'utf8');
  const ast = parseSync(source, {
    babelrc: false,
    configFile: false,
    filename: apiPath,
    parserOpts: {
      plugins: ['typescript'],
      sourceType: 'module',
    },
  });
  if (ast === null) {
    throw new Error('Inventory Effect API could not be parsed');
  }

  const titleProperties = [];
  traverse(ast, {
    ObjectExpression(objectPath) {
      const idProperty = objectPath.node.properties.find(property =>
        isNamedObjectProperty(property, 'id'),
      );
      if (
        !types.isObjectProperty(idProperty) ||
        !types.isStringLiteral(idProperty.value, {
          value: 'starter-inventory',
        })
      ) {
        return;
      }

      const titleProperty = objectPath.node.properties.find(property =>
        isNamedObjectProperty(property, 'title'),
      );
      if (
        !types.isObjectProperty(titleProperty) ||
        !types.isStringLiteral(titleProperty.value)
      ) {
        throw new Error(
          'Generated inventory API starter item must have one static title',
        );
      }
      titleProperties.push(titleProperty);
    },
  });
  if (titleProperties.length !== 1) {
    throw new Error(
      `Generated inventory API must have one starter item, found ${titleProperties.length}`,
    );
  }

  titleProperties[0].value = types.stringLiteral(title);
  const transformed = transformFromAstSync(ast, source, {
    ast: false,
    babelrc: false,
    cloneInputAst: false,
    code: true,
    configFile: false,
    filename: apiPath,
  });
  if (typeof transformed?.code !== 'string') {
    throw new Error('Inventory Effect API transformation produced no code');
  }
  fs.writeFileSync(apiPath, `${transformed.code}\n`);
}

function assertCleanApplicationGit(
  projectDir,
  expectedRevision,
  env,
  runImpl,
  label,
) {
  const revision = runImpl('git', ['rev-parse', 'HEAD'], {
    cwd: projectDir,
    env,
    stdio: 'pipe',
  }).toLowerCase();
  if (revision !== expectedRevision) {
    throw new Error(
      `${label} application HEAD must be ${expectedRevision}, found ${revision}`,
    );
  }
  const dirty = runImpl(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: projectDir, env, stdio: 'pipe' },
  );
  if (dirty) {
    throw new Error(`${label} application workspace is dirty: ${dirty}`);
  }
}

function createOperationalIndependenceCommit(
  projectDir,
  applicationSourceRevision,
  env,
  runImpl = run,
) {
  assertCleanApplicationGit(
    projectDir,
    applicationSourceRevision,
    env,
    runImpl,
    'C0',
  );
  const localePath = path.join(
    projectDir,
    'verticals/inventory/locales/en/inventory.json',
  );
  const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));
  if (locale?.inventory?.widgetBody !== 'Owns a vertical route surface.') {
    throw new Error(
      'Inventory C0 localization widgetBody does not match the generated ERP-10 contract',
    );
  }
  locale.inventory.widgetBody = operationalIndependenceUiValue;
  writeJsonFile(localePath, locale, { atomic: false });

  const apiPath = path.join(projectDir, 'verticals/inventory/api/index.ts');
  setGeneratedInventoryApiTitle(apiPath, operationalIndependenceApiValue);

  const changedBeforeCommit = runImpl(
    'git',
    ['diff', '--name-only', '--no-renames', '--'],
    { cwd: projectDir, env, stdio: 'pipe' },
  );
  const changedPaths = changedBeforeCommit
    .split('\n')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(changedPaths) !==
    JSON.stringify(operationalIndependenceChangedPaths)
  ) {
    throw new Error(
      `Operational-independence C1 must change only the inventory UI/localization and API response files; found ${changedPaths.join(', ')}`,
    );
  }

  runImpl('git', ['add', '--', ...operationalIndependenceChangedPaths], {
    cwd: projectDir,
    env,
    stdio: 'inherit',
  });
  runImpl(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--no-gpg-sign',
      '--no-verify',
      '-m',
      'test: rotate inventory operational identity',
    ],
    { cwd: projectDir, env, stdio: 'inherit' },
  );
  const changedRevision = runImpl('git', ['rev-parse', 'HEAD'], {
    cwd: projectDir,
    env,
    stdio: 'pipe',
  }).toLowerCase();
  const parentLine = runImpl(
    'git',
    ['rev-list', '--parents', '-n', '1', changedRevision],
    { cwd: projectDir, env, stdio: 'pipe' },
  ).split(/\s+/u);
  if (parentLine.length !== 2 || parentLine[1] !== applicationSourceRevision) {
    throw new Error(
      'Operational-independence C1 must be one clean commit directly on application C0',
    );
  }
  assertCleanApplicationGit(projectDir, changedRevision, env, runImpl, 'C1');
  return {
    applicationSourceRevision,
    changedPaths,
    changedRevision,
    mutations: {
      apiResponse: {
        path: operationalIndependenceChangedPaths[0],
        value: operationalIndependenceApiValue,
      },
      uiLocalization: {
        path: operationalIndependenceChangedPaths[1],
        value: operationalIndependenceUiValue,
      },
    },
  };
}

async function runOperationalIndependenceAcceptance({
  applicationSourceRevision,
  ephemeralWorkDir,
  mode,
  outPath,
  packageManagerEnv,
  projectDir,
  runImpl = run,
  runOperationalIndependenceImpl = runOperationalIndependence,
}) {
  const transition = createOperationalIndependenceCommit(
    projectDir,
    applicationSourceRevision,
    packageManagerEnv,
    runImpl,
  );
  const evidencePath = operationalIndependenceEvidencePath(outPath);
  if (ephemeralWorkDir) {
    const relativeEvidencePath = path.relative(
      path.resolve(ephemeralWorkDir),
      evidencePath,
    );
    if (
      relativeEvidencePath === '' ||
      (!relativeEvidencePath.startsWith('..') &&
        !path.isAbsolute(relativeEvidencePath))
    ) {
      throw new Error(
        `Operational-independence evidence path must survive ephemeral workspace cleanup: ${evidencePath}`,
      );
    }
  }
  const evidence = await runOperationalIndependenceImpl({
    baselineRef: transition.applicationSourceRevision,
    changedId: 'inventory',
    changedRef: transition.changedRevision,
    expectedApiValue: transition.mutations.apiResponse.value,
    expectedUiValue: transition.mutations.uiLocalization.value,
    out: evidencePath,
    packageManagerEnv,
    shellId: 'shell-super-app',
    siblingId: 'finance',
    workspace: projectDir,
  });
  if (!fs.existsSync(evidencePath)) {
    throw new Error(
      `Operational-independence runner did not write durable evidence at ${evidencePath}`,
    );
  }
  const details = createOperationalIndependenceResultDetails({
    applicationSourceRevision,
    changedRevision: transition.changedRevision,
    evidence,
    evidenceFileSha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(evidencePath))
      .digest('hex'),
    evidencePath,
    expectedApiValue: transition.mutations.apiResponse.value,
    expectedChangedPaths: transition.changedPaths,
    expectedUiValue: transition.mutations.uiLocalization.value,
    mode,
  });
  return {
    ...details,
    mutations: transition.mutations,
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
  runOperationalIndependenceImpl = runOperationalIndependence,
  now = Date,
  workDir: suppliedWorkDir,
}) {
  if (!['source', 'published'].includes(mode)) {
    throw new Error(
      `Acceptance mode must be source or published, found ${mode}`,
    );
  }
  assertReleaseAcceptanceProfile(options);

  const createPackage = resolveCreatePackage(release, options.createPackage);
  const workDir =
    suppliedWorkDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-release-acceptance-'));
  const ownsWorkDir = suppliedWorkDir === undefined;
  if (ownsWorkDir) {
    startOwnedWorkDirGuardian(workDir);
  }
  try {
    const projectDir = path.join(workDir, options.projectName);
    const runtime = runtimeVersions(runImpl, registryTool);
    const exactPnpmExecutable = resolveExactPnpmExecutable(
      runImpl,
      release.tools?.pnpm ?? runtime.pnpm,
      process.env,
      workDir,
    );
    const packageManagerEnv = createAcceptancePackageManagerEnv(
      workDir,
      registryEnv,
      exactPnpmExecutable,
    );
    const receipt = createAcceptanceReceipt({
      release,
      mode,
      profile: options.selectedProfile,
      createPackage,
      runtime,
      registry: registryReceiptMetadata({ mode, registryUrl }),
      runIdentity,
      now,
    });

    let failure;
    let audit;
    let artifacts;
    let applicationSourceRevision;
    const runtimeReports = new Map();
    const runtimeIdentityDetails = new Map();
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
          // The generated project is always-Zephyr by design (the zephyr-gating
          // policy forbids disabling it), and zephyr-agent requires git identity
          // and a remote origin to initialize a build — a hard requirement in CI.
          // A real consumer project has both; the create CLI already stamps an
          // initial commit, so the clean-room only needs to record a remote
          // origin (never fetched — Zephyr just parses the URL) to reproduce a
          // realistic, buildable repository. No Zephyr token is set, so nothing
          // is uploaded: this exercises "builds with Zephyr present, without a
          // Zephyr account".
          runImpl('git', ['config', 'user.name', 'UltraModern Acceptance'], {
            cwd: projectDir,
            env: packageManagerEnv,
          });
          runImpl(
            'git',
            ['config', 'user.email', 'acceptance@ultramodern.local'],
            { cwd: projectDir, env: packageManagerEnv },
          );
          runImpl(
            'git',
            [
              'remote',
              'add',
              'origin',
              'https://github.com/ultramodern-ci/acceptance-superapp.git',
            ],
            { cwd: projectDir, env: packageManagerEnv },
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
          const afterInstall = verifyStrictInstallInputs(projectDir, audit, {
            now: currentTime(now),
            phase: 'after-frozen-install',
          });
          return {
            command: 'pnpm install --frozen-lockfile',
            beforeInstall,
            afterInstall,
            defaultOffRsc: assertDefaultOffRscInstall(
              projectDir,
              audit.closureIdentities,
            ),
          };
        }),
      );

      await recordAcceptanceResult(receipt, 'pnpm-check', () =>
        withDuration(() => {
          runImpl('pnpm', requiredPnpmCommands.check, {
            cwd: projectDir,
            env: packageManagerEnv,
          });
          // A real first install materializes pinned generated-workspace assets
          // such as clone-backed agent skills. Snapshot only after lifecycle
          // scripts and the full workspace check have completed so the exact
          // committed source built below is clean and promotable.
          applicationSourceRevision = snapshotAcceptanceWorkspaceSource(
            projectDir,
            packageManagerEnv,
            runImpl,
          );
          return {
            command: 'pnpm check',
            applicationSourceRevision,
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

      // Cloudflare builds reuse each app's .output directory. Execute and cache
      // the strict Node report while the final Node deployment roots still
      // exist; the receipt loop below consumes this exact report in its normal
      // platform/dimension order.
      const nodeRuntimeReport = await browserSmokeImpl(projectDir, {
        ...runtimeAcceptanceInvocation(mode, 'node'),
        packageManagerEnv,
      });
      if (!nodeRuntimeReport || typeof nodeRuntimeReport !== 'object') {
        throw new Error('Node runtime acceptance did not produce a report');
      }
      runtimeReports.set('node', nodeRuntimeReport);

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
        withDuration(() =>
          assertBackendAcceptance(artifacts, options.verticals),
        ),
      );

      // The Cloudflare deploy replaces each app's final `.output` directory.
      // Capture every path-based Node artifact assertion first; the strict Node
      // browser report above and this backend-envelope assertion must describe
      // the same executed deployment roots, not the later Cloudflare staging.
      await recordAcceptanceResult(receipt, 'cloudflare-build', () =>
        withDuration(() => {
          runImpl('pnpm', requiredPnpmCommands.cloudflareBuild, {
            cwd: projectDir,
            env: packageManagerEnv,
          });
          return { command: 'pnpm cloudflare:build' };
        }),
      );
      for (const platform of runtimeAcceptancePlatforms) {
        for (const dimension of runtimeAcceptanceDimensions) {
          const resultId = `${platform}-${dimension}`;
          const details = await recordAcceptanceResult(receipt, resultId, () =>
            withDuration(async () => {
              let report = runtimeReports.get(platform);
              if (!report) {
                report = await browserSmokeImpl(projectDir, {
                  ...runtimeAcceptanceInvocation(mode, platform),
                  packageManagerEnv,
                });
                runtimeReports.set(platform, report);
              }
              return assertRuntimeAcceptanceDimension(report, {
                applicationSourceRevision,
                artifactBinding: receipt.binding.artifacts,
                dimension,
                mode,
                platform,
                release,
                verticals: options.verticals,
              });
            }),
          );
          if (dimension === 'release-identity') {
            runtimeIdentityDetails.set(platform, details);
          }
        }
      }
      bindRuntimeIdentityEvidence(
        receipt,
        runtimeIdentityBinding(
          runtimeIdentityDetails.get('node'),
          runtimeIdentityDetails.get('workerd'),
        ),
      );
      await recordAcceptanceResult(
        receipt,
        operationalIndependenceResultId,
        () =>
          withDuration(() =>
            runOperationalIndependenceAcceptance({
              applicationSourceRevision,
              ephemeralWorkDir: ownsWorkDir ? workDir : undefined,
              mode,
              outPath,
              packageManagerEnv,
              projectDir,
              runImpl,
              runOperationalIndependenceImpl,
            }),
          ),
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
    if (failure) {
      throw failure;
    }
    return receipt;
  } finally {
    if (ownsWorkDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

export {
  assertDefaultOffRscInstall,
  createAcceptancePackageManagerEnv,
  createOperationalIndependenceCommit,
  requiredPnpmCommands,
  resolveExactPnpmExecutable,
  runAcceptanceProfile,
  runOperationalIndependenceAcceptance,
  runtimeVersions,
  snapshotAcceptanceWorkspaceSource,
};
