import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import {
  assertLocalPortsAvailable,
  launchBrowser,
  startServer,
  startWorkerdProof,
} from '../browser-smoke/bootstrap.mjs';
import { validateNoJavaScriptSsrTarget } from '../browser-smoke/browser-validate.mjs';
import { readSmokeContract } from '../browser-smoke/contract.mjs';
import {
  validateHttpTarget,
  waitForTarget,
} from '../browser-smoke/http-validate.mjs';
import { bindContractToReleaseIdentity } from '../browser-smoke/runtime-evidence.mjs';
import {
  createSmokeTargets,
  orderTargetsForLocalStartup,
} from '../browser-smoke/targets.mjs';
import {
  createAcceptancePackageManagerEnv,
  resolveExactPnpmExecutable,
  snapshotAcceptanceWorkspaceSource,
} from '../published-create-proof/acceptance-profile.mjs';
import { writeJsonFile } from '../published-create-proof/constants.mjs';
import {
  createPnpmDlxArgs,
  releasePackageScopePattern,
  resolveCreatePackage,
} from '../published-create-proof/package-cohort.mjs';
import { run } from '../published-create-proof/process.mjs';
import {
  assertAuthenticatedTractorCohort,
  assertExactModernDependencySpecifiers,
  assertNativeTanStackSearch,
  assertProtectedUiUnchanged,
  snapshotProtectedUi,
} from './contract.mjs';

const defaultOut =
  '.modern/production-readiness/tractor-downstream-acceptance.json';
const nodeBackendProofPath =
  '.codex/reports/node-backend-federation-proof/proof.json';
const requiredCommands = Object.freeze([
  Object.freeze(['pnpm', ['install', '--frozen-lockfile']]),
  Object.freeze(['pnpm', ['check']]),
  Object.freeze(['pnpm', ['build']]),
  Object.freeze(['pnpm', ['node:proof']]),
  Object.freeze(['pnpm', ['cloudflare:build']]),
]);
const requiredVisibleRuntimePlatforms = Object.freeze(['node', 'workerd']);

function createTractorPackageManagerContext({
  createPackage,
  expectedPnpmVersion,
  packageManagerRoot,
  registryUrl,
  resolveExactPnpmExecutableImpl = resolveExactPnpmExecutable,
  runImpl = run,
}) {
  const pnpmExecutable = resolveExactPnpmExecutableImpl(
    runImpl,
    expectedPnpmVersion,
    process.env,
    packageManagerRoot,
  );
  return {
    env: {
      ...createAcceptancePackageManagerEnv(
        packageManagerRoot,
        {
          npm_config_registry: registryUrl,
          pnpm_config_registry: registryUrl,
        },
        pnpmExecutable,
      ),
      pnpm_config_pm_on_fail: 'ignore',
      pnpm_config_minimum_release_age_exclude:
        releasePackageScopePattern(createPackage),
      pnpm_config_trust_policy_exclude:
        releasePackageScopePattern(createPackage),
    },
    pnpmExecutable,
  };
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set([
    '--manifest',
    '--out',
    '--registry-url',
    '--workspace',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!allowed.has(argument) || argument.includes('=')) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }
  for (const required of ['--manifest', '--workspace']) {
    if (!values.has(required)) {
      throw new Error(`${required} is required`);
    }
  }
  return {
    manifestPath: path.resolve(values.get('--manifest')),
    outPath: path.resolve(values.get('--out') ?? defaultOut),
    registryUrl: new URL(
      values.get('--registry-url') ?? 'https://registry.npmjs.org/',
    ).toString(),
    workspace: fs.realpathSync(path.resolve(values.get('--workspace'))),
  };
}

function assertCleanCheckout(workspace, runImpl) {
  const status = runImpl(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: workspace,
      stdio: 'pipe',
    },
  );
  if (status) {
    throw new Error(
      `Tractor downstream acceptance requires a clean disposable checkout, found: ${status}`,
    );
  }
  const revision = runImpl('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    stdio: 'pipe',
  }).toLowerCase();
  if (!/^[a-f\d]{40,64}$/u.test(revision)) {
    throw new Error(`Tractor checkout revision is invalid: ${revision}`);
  }
  return revision;
}

async function stopRuntimes(runtimes, message) {
  const results = await Promise.allSettled(
    runtimes.reverse().map(runtime => runtime.stop()),
  );
  const failures = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, message);
  }
}

function requirePassingAssertionTypes(assertions, requiredTypes, label) {
  if (!Array.isArray(assertions)) {
    throw new Error(`${label} did not return an assertion array`);
  }
  const assertionsByType = new Map();
  for (const assertion of assertions) {
    if (typeof assertion?.type !== 'string' || assertion.status !== 'pass') {
      throw new Error(`${label} returned malformed or failing evidence`);
    }
    assertionsByType.set(assertion.type, assertion);
  }
  for (const type of requiredTypes) {
    if (!assertionsByType.has(type)) {
      throw new Error(`${label} is missing required ${type} evidence`);
    }
  }
  return assertions.map(assertion => assertion.type);
}

async function proveNodeServerRenderedSsr({
  artifactDir,
  browser,
  fetchImpl = fetch,
  targets,
  validateHttpTargetImpl = validateHttpTarget,
  validateNoJavaScriptSsrTargetImpl = validateNoJavaScriptSsrTarget,
}) {
  const shells = targets.filter(target => target.app.kind === 'shell');
  if (shells.length !== 1) {
    throw new Error(
      'Tractor Node SSR acceptance requires exactly one shell target',
    );
  }
  const [shell] = shells;
  if (
    shell.routes.distributedSsr === shell.routes.ssr ||
    !Array.isArray(shell.app.moduleFederation?.verticalRefs) ||
    shell.app.moduleFederation.verticalRefs.length === 0
  ) {
    throw new Error(
      'Tractor Node SSR acceptance requires a dedicated distributed-SSR route with declared MicroVerticals',
    );
  }

  const results = [];
  for (const target of targets) {
    const httpAssertions = await validateHttpTargetImpl(target, { fetchImpl });
    const requiredHttpTypes = [
      'ssr-route',
      'ui-marker-html',
      'css-root-marker',
    ];
    if (target.app.api) {
      requiredHttpTypes.push('effect-readiness');
    }
    const httpAssertionTypes = requirePassingAssertionTypes(
      httpAssertions,
      requiredHttpTypes,
      `${target.app.id} Node HTTP SSR`,
    );

    const appArtifactDir = path.join(artifactDir, target.app.id);
    fs.mkdirSync(appArtifactDir, { recursive: true });
    const noJavaScriptAssertions = await validateNoJavaScriptSsrTargetImpl(
      target,
      browser,
      {
        appArtifactDir,
      },
    );
    const requiredNoJavaScriptTypes =
      target.app.kind === 'shell'
        ? [
            'no-js-distributed-ssr-route',
            'no-js-shell-composition-boundary',
            'no-js-ssr-css-root-marker',
            'no-js-ssr-failed-responses',
          ]
        : [
            'no-js-ssr-ui-marker',
            'no-js-ssr-css-root-marker',
            'no-js-ssr-failed-responses',
          ];
    const noJavaScriptAssertionTypes = requirePassingAssertionTypes(
      noJavaScriptAssertions,
      requiredNoJavaScriptTypes,
      `${target.app.id} Node no-JS SSR`,
    );
    results.push({
      appId: target.app.id,
      httpAssertions,
      httpAssertionTypes,
      noJavaScriptAssertions,
      noJavaScriptAssertionTypes,
    });
  }
  return {
    appCount: results.length,
    distributedSsrRoute: shell.routes.distributedSsr,
    results,
    status: 'pass',
  };
}

function loadWorkspacePlaywright(workspace) {
  const workspaceRequire = createRequire(path.join(workspace, 'package.json'));
  return workspaceRequire('@playwright/test');
}

function createReleaseBoundNodeSmokeTargets(
  { contract, projectDir },
  {
    bindContractToReleaseIdentityImpl = bindContractToReleaseIdentity,
    createSmokeTargetsImpl = createSmokeTargets,
  } = {},
) {
  const releaseBoundContract = bindContractToReleaseIdentityImpl({
    contract,
    platform: 'node',
    projectDir,
  });
  return createSmokeTargetsImpl(releaseBoundContract, { mode: 'local' });
}

async function startNodeProof(
  { artifactDir, projectDir, timeoutMs = 90_000 },
  {
    browserProvider,
    launchBrowserImpl = launchBrowser,
    proveNodeServerRenderedSsrImpl = proveNodeServerRenderedSsr,
  } = {},
) {
  const { contract } = readSmokeContract(projectDir);
  const { targets } = createReleaseBoundNodeSmokeTargets({
    contract,
    projectDir,
  });
  const startup = orderTargetsForLocalStartup(targets);
  if (startup.shells.length !== 1) {
    throw new Error(
      'Tractor Node browser acceptance requires exactly one shell target',
    );
  }
  await assertLocalPortsAvailable(startup.validation);
  const runtimes = [];
  try {
    for (const layer of startup.remoteLayers) {
      const layerRuntimes = layer.map(target => {
        const runtime = startServer(target, { artifactDir, projectDir });
        runtimes.push(runtime);
        return { runtime, target };
      });
      await Promise.all(
        layerRuntimes.map(({ runtime, target }) =>
          waitForTarget(target, {
            fetchImpl: fetch,
            requireManifest: true,
            serverExit: runtime.exited,
            serverLogPath: runtime.logPath,
            timeoutMs,
          }),
        ),
      );
    }
    const shellTarget = startup.shells[0];
    const shellRuntime = startServer(shellTarget, {
      artifactDir,
      projectDir,
    });
    runtimes.push(shellRuntime);
    await waitForTarget(shellTarget, {
      fetchImpl: fetch,
      serverExit: shellRuntime.exited,
      serverLogPath: shellRuntime.logPath,
      timeoutMs,
    });
    const browser = await launchBrowserImpl(
      browserProvider ?? loadWorkspacePlaywright(projectDir),
    );
    let ssrEvidence;
    try {
      ssrEvidence = await proveNodeServerRenderedSsrImpl({
        artifactDir,
        browser,
        targets: startup.validation,
      });
    } finally {
      await browser.close();
    }
    return {
      baseUrl: shellTarget.baseUrl,
      ssrEvidence,
      stop: () =>
        stopRuntimes(
          runtimes,
          'Failed to stop Tractor Node browser acceptance processes',
        ),
    };
  } catch (error) {
    try {
      await stopRuntimes(
        runtimes,
        'Failed to stop Tractor Node browser acceptance processes',
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Tractor Node browser acceptance and cleanup both failed',
      );
    }
    throw error;
  }
}

function runVisibleWorkflow({
  artifactDir,
  baseUrl,
  env,
  platform,
  runImpl,
  workspace,
}) {
  const browserEvidence = path.join(
    artifactDir,
    `tractor-visible-workflow-${platform}.json`,
  );
  runImpl(
    process.execPath,
    ['scripts/proof-public-workflow.mjs', '--out', browserEvidence],
    {
      cwd: workspace,
      env: {
        ...env,
        ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP: baseUrl,
      },
    },
  );
  const workflow = JSON.parse(fs.readFileSync(browserEvidence, 'utf8'));
  if (
    workflow.status !== 'pass' ||
    !Array.isArray(workflow.assertions) ||
    workflow.assertions.length < 5
  ) {
    throw new Error(
      `Tractor ${platform} visible shopping workflow evidence is incomplete`,
    );
  }
  return {
    assertionCount: workflow.assertions.length,
    platform,
    routes: workflow.assertions.map(assertion => assertion.route),
  };
}

function expectedNodeBackendAppIds(workspace) {
  const configPath = path.join(workspace, '.modernjs/ultramodern.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.topology?.apps)) {
    throw new Error(
      'Tractor compact config is missing the post-migration topology app set',
    );
  }
  const expected = config.topology.apps
    .filter(app => app?.kind === 'vertical' && app.api)
    .map(app => app.id);
  if (
    expected.length === 0 ||
    expected.some(id => typeof id !== 'string' || id.length === 0) ||
    new Set(expected).size !== expected.length
  ) {
    throw new Error(
      'Tractor post-migration topology must contain unique API-bearing MicroVertical ids',
    );
  }
  return expected.sort((left, right) => left.localeCompare(right));
}

function readPassingNodeBackendProof(workspace) {
  const evidencePath = path.join(workspace, nodeBackendProofPath);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const expectedAppIds = expectedNodeBackendAppIds(workspace);
  if (
    evidence.status !== 'pass' ||
    !Array.isArray(evidence.results) ||
    evidence.results.length === 0
  ) {
    throw new Error(
      'Tractor Node backend-federation proof was skipped or has no executed results',
    );
  }
  const actualAppIds = [];
  for (const result of evidence.results) {
    if (
      typeof result?.appId !== 'string' ||
      result.appId.length === 0 ||
      result.status !== 'pass' ||
      actualAppIds.includes(result.appId)
    ) {
      throw new Error(
        'Tractor Node backend-federation proof contains duplicate, malformed, or failing results',
      );
    }
    actualAppIds.push(result.appId);
  }
  actualAppIds.sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualAppIds) !== JSON.stringify(expectedAppIds)) {
    throw new Error(
      `Tractor Node backend-federation proof app set must exactly match API-bearing MicroVerticals: expected ${expectedAppIds.join(
        ', ',
      )}; found ${actualAppIds.join(', ')}`,
    );
  }
  return {
    appIds: actualAppIds,
    evidencePath: nodeBackendProofPath,
    resultCount: evidence.results.length,
    status: evidence.status,
  };
}

async function runTractorDownstreamAcceptance(
  options,
  {
    runImpl = run,
    startNodeProofImpl = startNodeProof,
    startWorkerdProofImpl = startWorkerdProof,
    now = Date,
  } = {},
) {
  const release = readReleaseManifest({
    manifestPath: options.manifestPath,
  });
  const createPackage = resolveCreatePackage(release);
  const packageManagerRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-tractor-downstream-'),
  );
  const packageManager = createTractorPackageManagerContext({
    createPackage,
    expectedPnpmVersion: release.tools?.pnpm,
    packageManagerRoot,
    registryUrl: options.registryUrl,
    runImpl,
  });
  const env = packageManager.env;
  const report = {
    schema: 'bleedingdev.ultramodern.tractor-downstream-acceptance',
    schemaVersion: 1,
    status: 'running',
    startedAt: new now().toISOString(),
    release: {
      cohortDigest: release.cohortDigest,
      manifestSha256: release.manifestSha256,
      sourceRevision: release.source.commit,
      version: release.release.version,
    },
    tractor: {},
    checks: [],
  };
  try {
    report.tractor.baselineRevision = assertCleanCheckout(
      options.workspace,
      runImpl,
    );
    const uiBefore = snapshotProtectedUi(options.workspace);
    report.checks.push({
      id: 'ui-baseline',
      status: 'passed',
      detail: {
        fileCount: uiBefore.fileCount,
        sha256: uiBefore.sha256,
      },
    });

    runImpl(
      packageManager.pnpmExecutable,
      createPnpmDlxArgs(createPackage, [
        'ultramodern',
        'migrate-strict-effect',
        '--version',
        release.release.version,
        '--registry',
        options.registryUrl,
      ]),
      { cwd: options.workspace, env: packageManager.env },
    );
    report.checks.push({
      id: 'exact-create-migration',
      status: 'passed',
      detail: {
        createPackage: createPackage.exactSpecifier,
        version: release.release.version,
      },
    });

    const generatedCohort = assertAuthenticatedTractorCohort(
      options.workspace,
      release,
    );
    const dependencyObservations = assertExactModernDependencySpecifiers(
      options.workspace,
      release,
    );
    report.checks.push({
      id: 'exact-cohort',
      status: 'passed',
      detail: {
        dependencyObservationCount: dependencyObservations.length,
        generatedCohort,
      },
    });

    const nativeSearch = assertNativeTanStackSearch(options.workspace);
    report.checks.push({
      id: 'native-tanstack-search',
      status: 'passed',
      detail: nativeSearch,
    });
    report.checks.push({
      id: 'migration-preserves-visible-ui-source',
      status: 'passed',
      detail: assertProtectedUiUnchanged(
        uiBefore,
        snapshotProtectedUi(options.workspace),
      ),
    });

    for (const [command, args] of requiredCommands) {
      if (args[0] === 'node:proof') {
        fs.rmSync(path.join(options.workspace, nodeBackendProofPath), {
          force: true,
        });
      }
      runImpl(command, args, { cwd: options.workspace, env });
      report.checks.push({
        id: args.join('-'),
        status: 'passed',
        detail: { command: [command, ...args].join(' ') },
      });
      if (args[0] === 'check') {
        const applicationSourceRevision = snapshotAcceptanceWorkspaceSource(
          options.workspace,
          env,
          runImpl,
        );
        report.tractor.applicationSourceRevision = applicationSourceRevision;
        report.checks.push({
          id: 'promotable-application-source',
          status: 'passed',
          detail: { applicationSourceRevision },
        });
      }
      if (args[0] === 'node:proof') {
        report.checks.push({
          id: 'node-backend-federation-executed',
          status: 'passed',
          detail: readPassingNodeBackendProof(options.workspace),
        });
        const nodeArtifactDir = path.join(
          options.workspace,
          '.codex/reports/tractor-downstream-node',
        );
        const nodeRuntime = await startNodeProofImpl({
          artifactDir: nodeArtifactDir,
          projectDir: options.workspace,
          timeoutMs: 90_000,
        });
        try {
          report.checks.push({
            id: 'node-server-rendered-ssr-executed',
            status: 'passed',
            detail: nodeRuntime.ssrEvidence,
          });
          report.checks.push({
            id: 'node-visible-tractor-workflow',
            status: 'passed',
            detail: runVisibleWorkflow({
              artifactDir: nodeArtifactDir,
              baseUrl: nodeRuntime.baseUrl,
              env,
              platform: 'node',
              runImpl,
              workspace: options.workspace,
            }),
          });
        } finally {
          await nodeRuntime.stop();
        }
      }
    }

    const artifactDir = path.join(
      options.workspace,
      '.codex/reports/tractor-downstream-workerd',
    );
    const workerd = await startWorkerdProofImpl({
      artifactDir,
      projectDir: options.workspace,
      timeoutMs: 90_000,
    });
    try {
      if (!workerd.baseUrl) {
        throw new Error(
          'Tractor generated workerd proof did not expose a shell URL',
        );
      }
      report.checks.push({
        id: 'workerd-visible-tractor-workflow',
        status: 'passed',
        detail: runVisibleWorkflow({
          artifactDir,
          baseUrl: workerd.baseUrl,
          env,
          platform: 'workerd',
          runImpl,
          workspace: options.workspace,
        }),
      });
    } finally {
      await workerd.stop();
    }

    report.checks.push({
      id: 'final-visible-ui-source',
      status: 'passed',
      detail: assertProtectedUiUnchanged(
        uiBefore,
        snapshotProtectedUi(options.workspace),
      ),
    });
    report.finishedAt = new now().toISOString();
    report.status = 'passed';
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.finishedAt = new now().toISOString();
    report.status = 'failed';
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      {
        tractorAcceptanceReport: report,
      },
    );
  } finally {
    fs.rmSync(packageManagerRoot, { recursive: true, force: true });
    writeJsonFile(options.outPath, report, { atomic: false });
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await runTractorDownstreamAcceptance(options);
  process.stdout.write(
    `Tractor downstream acceptance passed for ${report.release.version}: ${options.outPath}\n`,
  );
}

export {
  assertCleanCheckout,
  createReleaseBoundNodeSmokeTargets,
  createTractorPackageManagerContext,
  main,
  parseArgs,
  proveNodeServerRenderedSsr,
  readPassingNodeBackendProof,
  requiredCommands,
  requiredVisibleRuntimePlatforms,
  runTractorDownstreamAcceptance,
  runVisibleWorkflow,
  startNodeProof,
};
