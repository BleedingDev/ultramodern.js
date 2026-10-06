import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { assertCleanCommittedSource } from '../../ultramodern-publish/lib/release-source-state.mjs';
import { appPortEnv, readSmokeContract } from '../browser-smoke/contract.mjs';
import {
  assembleOperationalEvidence,
  captureOperationalBaseline,
  proveOperationalTarget,
  readAndVerifyEnvelope,
} from '../operational-independence.mjs';
import { createAcceptedNodeProofEnvironment } from '../run-browser-smoke.mjs';
import {
  assertApiAcceptance,
  assertBackendAcceptance,
  assertModuleFederationAcceptance,
  assertTopologyAcceptance,
  readWorkspaceAcceptanceArtifacts,
} from './acceptance-assertions.mjs';
import {
  assertOperationalIndependenceResultDetails,
  assertReleaseAcceptanceProfile,
  assertRuntimeAcceptanceDimension,
  createOperationalIndependenceResultDetails,
  createReleaseArtifactBinding,
  operationalIndependenceEvidencePath,
  operationalIndependenceResultId,
  releaseIdentityCoherence,
  rendererReleaseCoherence,
  runtimeAcceptanceDimensions,
  runtimeAcceptanceInvocation,
  runtimeIdentityBinding,
} from './acceptance-contract.mjs';
import {
  finalizeAcceptanceReceipt,
  recordAcceptanceResult,
  verifyAcceptanceReceiptOperationalEvidence,
} from './acceptance-receipt.mjs';
import { repoRoot, writeJsonFile } from './constants.mjs';
import { assertGeneratedCohort } from './package-cohort.mjs';
import { roundDurationMs, run } from './process.mjs';
import {
  parsePriorCloudflareBuildAttribution,
  parsePriorNodeBuildAttribution,
  readPriorCloudflareBuildAttribution,
  readPriorNodeBuildAttribution,
} from './source-node-attribution.mjs';

const acceptanceContinuationSchema =
  'bleedingdev.ultramodern.release-acceptance-continuation';
const continuationResultIds = Object.freeze([
  'topology',
  'module-federation',
  'api',
  'backend',
  ...runtimeAcceptanceDimensions.map(dimension => `node-${dimension}`),
  'cloudflare-build',
  ...runtimeAcceptanceDimensions.map(dimension => `workerd-${dimension}`),
  operationalIndependenceResultId,
]);

function requiredContinuationResultIds(cursor) {
  assertCondition(
    ['source-node', 'source-workerd'].includes(cursor),
    'Unsupported acceptance continuation cursor',
  );
  return cursor === 'source-node'
    ? continuationResultIds
    : continuationResultIds.map(id =>
        id === 'cloudflare-build' ? 'cloudflare-output' : id,
      );
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readRegularFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  assertCondition(
    stat.isFile() && !stat.isSymbolicLink(),
    `${label} must be an ordinary file: ${resolved}`,
  );
  const bytes = fs.readFileSync(resolved);
  return {
    path: resolved,
    byteLength: bytes.byteLength,
    sha256: digest(bytes),
    text: bytes.toString('utf8'),
  };
}

function readJson(filePath, label) {
  return JSON.parse(readRegularFile(filePath, label).text);
}

function readRuntimeReport(filePath, provenance) {
  return { ...readRegularFile(filePath, 'Runtime report'), provenance };
}

function reportValue(descriptor, platform, projectDirectory, appIds) {
  assertCondition(
    descriptor &&
      path.isAbsolute(descriptor.path) &&
      ['executed-here', 'external-report'].includes(descriptor.provenance) &&
      typeof descriptor.text === 'string' &&
      Buffer.byteLength(descriptor.text) === descriptor.byteLength &&
      digest(descriptor.text) === descriptor.sha256,
    `${platform} runtime report reference is invalid`,
  );
  const report = JSON.parse(descriptor.text);
  assertCondition(
    report.projectDir === projectDirectory &&
      report.mode === 'local' &&
      report.schemaVersion === 1 &&
      Array.isArray(report.results) &&
      isDeepStrictEqual(
        report.results.map(result => result.appId).sort(),
        [...appIds].sort(),
      ) &&
      report.results.every(
        result =>
          result.status === 'pass' &&
          Array.isArray(result.assertions) &&
          result.assertions.length > 0 &&
          result.assertions.every(assertion => assertion.status === 'pass'),
      ),
    `${platform} runtime report must prove all retained targets at the same project`,
  );
  return report;
}

function releaseBinding(release) {
  return {
    source: { ...release.source },
    release: { ...release.release },
    manifest: {
      sha256: release.manifestSha256,
      cohortDigest: release.cohortDigest,
      packageCount: release.packages.length,
    },
    artifacts: createReleaseArtifactBinding(release),
  };
}

function createRuntimeArtifactBinding(artifactBinding) {
  // Packed SDK build tools belong to the artifact cohort. Executed app surface
  // identities attest the runtime package declared by that application.
  const moduleFederation = artifactBinding.moduleFederation.filter(
    item => item.packageName === '@module-federation/runtime',
  );
  assertCondition(
    moduleFederation.length === 1,
    'Acceptance continuation requires one exact Module Federation runtime in its verified artifact cohort',
  );
  return { ...artifactBinding, moduleFederation };
}

function assertNativeOutputSnapshots(
  outputs,
  applicationSourceRevision,
  target,
) {
  const label = target === 'node' ? 'Node' : 'Cloudflare';
  assertCondition(
    Array.isArray(outputs) &&
      outputs.length === 11 &&
      new Set(outputs.map(output => output.appId)).size === 11,
    `Continuation must retain eleven distinct ${label} output contracts`,
  );
  for (const output of outputs) {
    const manifest = output.rendererManifest;
    const envelope = output.releaseEnvelope;
    assertCondition(
      typeof output.appId === 'string' &&
        typeof output.path === 'string' &&
        !path.isAbsolute(output.path) &&
        !output.path.split(/[\\/]/u).includes('..') &&
        output.rendererManifestPath ===
          (target === 'cloudflare'
            ? 'public/renderer-build.json'
            : 'renderer-build.json') &&
        manifest?.schema === 'ultramodern-renderer-build' &&
        manifest.version === 1 &&
        manifest.promotable === true &&
        manifest.cacheAllowed === true &&
        manifest.sourceRevision === applicationSourceRevision &&
        /^[a-f0-9]{64}$/u.test(manifest.buildMarker) &&
        Object.values(manifest.identities ?? {}).length > 0 &&
        Object.values(manifest.identities).every(
          identity =>
            identity.appId === output.appId &&
            identity.buildId === manifest.buildMarker,
        ) &&
        envelope?.schemaVersion === 5 &&
        envelope.target === target &&
        envelope.identity?.sourceRevision === applicationSourceRevision &&
        envelope.identity?.buildMarker === manifest.buildMarker &&
        envelope.identity?.unitId === output.identity?.unitId &&
        envelope.identity?.releaseVersion === output.identity?.releaseVersion &&
        output.identity?.sourceRevision === applicationSourceRevision &&
        output.identity?.buildMarker === manifest.buildMarker,
      `${output.appId} retained ${label} output conflicts with finalized native identity`,
    );
    const ui = envelope.ui;
    assertCondition(
      ui &&
        isDeepStrictEqual(
          ui.rendererIdentity,
          manifest.identities[ui.rendererIdentity?.entryName],
        ) &&
        isDeepStrictEqual(ui.routerBindings, manifest.routerBindings) &&
        isDeepStrictEqual(ui.rendererProfile, {
          renderer: manifest.profile?.renderer,
          protocolVersion: manifest.profile?.protocolVersion,
          compiler: manifest.profile?.compiler,
          hydration: manifest.profile?.hydration,
          router: manifest.profile?.router,
        }),
      `${output.appId} ${label} renderer tuple differs from its native manifest`,
    );
  }
}

function assertNodeOutputSnapshots(outputs, applicationSourceRevision) {
  return assertNativeOutputSnapshots(
    outputs,
    applicationSourceRevision,
    'node',
  );
}

function assertReportOutputBinding(report, outputs, platform) {
  const label = platform === 'node' ? 'Node' : 'Workerd';
  for (const output of outputs) {
    const result = report.results.find(
      candidate => candidate.appId === output.appId,
    );
    assertCondition(
      report.targetRuntimes?.[output.appId] === platform &&
        ['ui-marker-html', 'browser-ui-marker', 'no-js-ssr-ui-marker'].every(
          type => {
            const assertions = result?.assertions.filter(
              assertion => assertion.type === type,
            );
            return (
              assertions?.length === 1 &&
              assertions[0].status === 'pass' &&
              assertions[0].actual === output.identity.buildMarker &&
              assertions[0].expected === output.identity.buildMarker
            );
          },
        ),
      `${output.appId} ${label} HTTP/browser evidence differs from its retained native output`,
    );
  }
}

function assertNativeTargetCoherence(nodeOutputs, cloudflareOutputs) {
  assertCondition(
    isDeepStrictEqual(
      nodeOutputs.map(output => output.appId).sort(),
      cloudflareOutputs.map(output => output.appId).sort(),
    ),
    'Native target outputs must cover the same apps',
  );
  for (const node of nodeOutputs) {
    const cloudflare = cloudflareOutputs.find(
      output => output.appId === node.appId,
    );
    assertCondition(
      isDeepStrictEqual(
        releaseIdentityCoherence(node.identity),
        releaseIdentityCoherence(cloudflare.identity),
      ) &&
        isDeepStrictEqual(
          rendererReleaseCoherence(node.releaseEnvelope.ui),
          rendererReleaseCoherence(cloudflare.releaseEnvelope.ui),
        ),
      `${node.appId} Node and Cloudflare release/renderer coherence differs`,
    );
  }
}

function captureNativeOutputs(
  projectDir,
  contract,
  directory,
  target,
  applicationSourceRevision,
) {
  const outputs = contract.apps.map(app => {
    const appRoot = path.join(projectDir, app.path);
    const ownerRequire = createRequire(path.join(appRoot, 'package.json'));
    const sdk = ownerRequire('@modern-js/ultramodern-app-tools');
    const source = readJson(
      path.join(appRoot, 'shared/ultramodern-build.json'),
      'Authored build contract',
    );
    const renderer = source.surfaces.ui.rendererIdentity.renderer;
    const outputRoot = path.join(appRoot, directory);
    const rendererManifestPath =
      target === 'cloudflare'
        ? 'public/renderer-build.json'
        : 'renderer-build.json';
    const rendererManifest = sdk.validateRendererBuildManifest(
      readJson(
        path.join(outputRoot, rendererManifestPath),
        'Native renderer manifest',
      ),
      sdk.resolveRendererProfile(renderer),
    );
    const entryName = source.surfaces.ui.rendererIdentity.entryName;
    const identity = rendererManifest.identities[entryName];
    assertCondition(
      identity,
      `${app.id} native renderer primary entry is missing`,
    );
    const verified = readAndVerifyEnvelope(outputRoot, target, {
      expectedAppId: app.id,
      expectedRendererIdentity: identity,
      expectedRendererProfile: {
        renderer: rendererManifest.profile.renderer,
        protocolVersion: rendererManifest.profile.protocolVersion,
        compiler: rendererManifest.profile.compiler,
        hydration: rendererManifest.profile.hydration,
        router: rendererManifest.profile.router,
      },
    });
    assertCondition(verified, `${app.id} native ${target} envelope is missing`);
    const releaseEnvelope = readJson(
      path.join(outputRoot, 'release/microvertical-release-envelope.json'),
      'Native release envelope',
    );
    return {
      appId: app.id,
      path: app.path,
      directory,
      rendererManifestPath,
      identity: releaseEnvelope.identity,
      rendererManifest,
      releaseEnvelope,
    };
  });
  assertNativeOutputSnapshots(outputs, applicationSourceRevision, target);
  return outputs;
}

const shellFinalizationActions = Object.freeze([
  'createRunOptions',
  'createNativeConfigLoad',
  'createCli.init(deploy --skip-build)',
  'emitFrameworkMicroVerticalReleaseEnvelope',
  'verifyBuildOutputReleaseEnvelope',
  'createCloudflarePreset.prepare',
  'createCloudflarePreset.writeOutput',
  'createCloudflarePreset.genEntry',
  'verifyCloudflareOutput',
  'verifyCloudflareReleaseEnvelopeStaging',
  'onBeforeExit',
  'createCli.dispose',
]);

function assertShellFinalization(record, release) {
  const reused = record.reusedEvidence;
  const descriptor = reused.cloudflare?.shellFinalization;
  assertCondition(
    descriptor?.provenance === 'external-report' &&
      path.isAbsolute(descriptor.path) &&
      typeof descriptor.text === 'string' &&
      Buffer.byteLength(descriptor.text) === descriptor.byteLength &&
      digest(descriptor.text) === descriptor.sha256,
    'Shell finalization report reference is invalid',
  );
  const result = JSON.parse(descriptor.text);
  const shell = record.runtimeOutputs.workerd.find(
    output => output.appId === 'shell-super-app',
  );
  const appDirectory = path.join(reused.projectDirectory, shell.path);
  const distDirectory = path.join(appDirectory, 'dist-cloudflare');
  const outputDirectory = path.join(appDirectory, '.output');
  assertCondition(
    result.schemaVersion === 1 &&
      result.kind === 'ultramodern-cloudflare-shell-finalization' &&
      result.status === 'pass' &&
      result.appId === shell.appId &&
      result.target === 'cloudflare' &&
      result.projectDirectory === reused.projectDirectory &&
      result.appDirectory === appDirectory &&
      result.distDirectory === distDirectory &&
      result.outputDirectory === outputDirectory &&
      result.originalBuildSucceeded === false &&
      result.compilerReplayed === false &&
      isDeepStrictEqual(result.identity, shell.identity) &&
      isDeepStrictEqual(result.inputCandidate, {
        sourceRevision: release.source.commit,
        cohortDigest: release.cohortDigest,
        manifestSha256: release.manifestSha256,
      }) &&
      path.isAbsolute(result.command?.executable) &&
      Array.isArray(result.command.argv) &&
      result.command.argv.every(value => typeof value === 'string') &&
      isDeepStrictEqual(result.command.actions, shellFinalizationActions),
    'Shell finalization differs from the candidate/native output or actual public stage contract',
  );
  const pins = result.descriptors;
  const expectedPaths = {
    priorNodeReport: record.runtimeReports.node.path,
    originalCloudflareLog: reused.cloudflare.priorRunLog.path,
    rendererBuild: path.join(distDirectory, 'renderer-build.json'),
    sourceEnvelope: path.join(
      distDirectory,
      'release/microvertical-release-envelope.json',
    ),
    outputEnvelope: path.join(
      outputDirectory,
      'release/microvertical-release-envelope.json',
    ),
    workerManifest: path.join(
      outputDirectory,
      'server/modern-worker-manifest.json',
    ),
    workerEntry: path.join(outputDirectory, 'server/index.mjs'),
    wrangler: path.join(outputDirectory, 'wrangler.json'),
  };
  assertCondition(
    pins &&
      ['candidateManifest', ...Object.keys(expectedPaths)].every(key => {
        const pin = pins[key];
        return (
          pin &&
          path.isAbsolute(pin.path) &&
          Number.isSafeInteger(pin.byteLength) &&
          pin.byteLength > 0 &&
          /^[a-f0-9]{64}$/u.test(pin.sha256) &&
          (key === 'candidateManifest' || pin.path === expectedPaths[key])
        );
      }) &&
      pins.candidateManifest.sha256 === release.manifestSha256 &&
      ['path', 'byteLength', 'sha256'].every(
        key =>
          pins.priorNodeReport[key] === record.runtimeReports.node[key] &&
          pins.originalCloudflareLog[key] ===
            reused.cloudflare.priorRunLog[key],
      ),
    'Shell finalization input/output descriptors differ from the genuine candidate/prior evidence',
  );
  assertCondition(
    result.stageOwner?.packageName === '@modern-js/app-tools-extensions' &&
      typeof result.stageOwner.version === 'string' &&
      result.stageOwner.version.length > 0 &&
      path.isAbsolute(result.stageOwner.packageDirectory) &&
      Array.isArray(result.stageOwner.modules) &&
      result.stageOwner.modules.length === 3 &&
      result.stageOwner.modules.every(
        pin =>
          pin &&
          path.isAbsolute(pin.path) &&
          Number.isSafeInteger(pin.byteLength) &&
          pin.byteLength > 0 &&
          /^[a-f0-9]{64}$/u.test(pin.sha256),
      ) &&
      path.isAbsolute(result.configLoad?.configFile) &&
      Array.isArray(result.configLoad.plugins) &&
      ['cliEntry', 'nativeLoadEntry', 'pluginEntry'].every(
        key =>
          result.configLoad[key] &&
          path.isAbsolute(result.configLoad[key].path) &&
          /^[a-f0-9]{64}$/u.test(result.configLoad[key].sha256),
      ) &&
      result.cleanup?.nativeOnBeforeExit === 'fulfilled' &&
      result.cleanup.cliDisposed === true &&
      result.cleanup.environmentRestored === true &&
      result.cleanup.preservedCallerWork === true,
    'Shell finalization must record native configuration, owning modules, and successful cleanup',
  );
  return result;
}

function assertAcceptanceContinuation(
  record,
  { release, runIdentity, requirePassed = true, expectedArtifactBinding } = {},
) {
  assertCondition(
    record?.schema === acceptanceContinuationSchema &&
      record.schemaVersion === 1 &&
      record.mode === 'source' &&
      ['source-node', 'source-workerd'].includes(record.cursor),
    'Unsupported acceptance continuation contract',
  );
  const expected = releaseBinding(release);
  for (const key of Object.keys(expected)) {
    assertCondition(
      isDeepStrictEqual(record.binding?.[key], expected[key]),
      `Acceptance continuation ${key} differs from the current release`,
    );
  }
  if (expectedArtifactBinding !== undefined) {
    assertCondition(
      isDeepStrictEqual(record.binding.artifacts, expectedArtifactBinding),
      'Acceptance continuation artifact binding differs from its consumer',
    );
  }
  assertCondition(
    typeof record.binding.runIdentity === 'string' &&
      record.binding.runIdentity.trim() === record.binding.runIdentity &&
      record.binding.runIdentity.length >= 3 &&
      (runIdentity === undefined ||
        record.binding.runIdentity === runIdentity) &&
      record.binding.profile?.id === 'erp-10' &&
      record.binding.profile?.version === 1 &&
      /^[a-f0-9]{40}$/u.test(record.binding.applicationSourceRevision),
    'Acceptance continuation run/profile/application binding is invalid',
  );
  const reused = record.reusedEvidence;
  const installedCohort = reused?.installedCohort;
  const observedSourceNames = installedCohort?.observedSourceNames;
  const releaseSourceNames = new Set(
    release.packages.map(item => item.sourceName),
  );
  assertCondition(
    reused &&
      path.isAbsolute(reused.projectDirectory) &&
      reused.applicationSourceRevision ===
        record.binding.applicationSourceRevision &&
      reused.priorRunLog?.attribution?.applicationSourceRevision ===
        record.binding.applicationSourceRevision &&
      reused.priorRunLog?.attribution?.projectDirectory ===
        reused.projectDirectory &&
      reused.priorRunLog?.attribution?.commands?.length === 11 &&
      installedCohort?.expectedPackageCount === release.packages.length &&
      installedCohort.expectedPackageCount > 0 &&
      Number.isInteger(installedCohort.observedPackageCount) &&
      installedCohort.observedPackageCount > 0 &&
      installedCohort.observedPackageCount <=
        installedCohort.expectedPackageCount &&
      Array.isArray(observedSourceNames) &&
      observedSourceNames.length === installedCohort.observedPackageCount &&
      new Set(observedSourceNames).size === observedSourceNames.length &&
      observedSourceNames.every(sourceName =>
        releaseSourceNames.has(sourceName),
      ),
    'Acceptance continuation prior evidence attribution is incomplete',
  );
  assertNodeOutputSnapshots(
    reused.nodeOutputs,
    record.binding.applicationSourceRevision,
  );
  if (record.cursor === 'source-workerd') {
    const cloudflare = reused.cloudflare;
    const attribution = cloudflare?.priorRunLog?.attribution;
    const completedBuild = attribution?.rootCompletion !== undefined;
    assertCondition(
      completedBuild
        ? attribution.commands?.length === 11 &&
            attribution.shellAttempt === undefined &&
            cloudflare.shellFinalization === undefined
        : attribution?.commands?.length === 10 && attribution.shellAttempt,
      'Workerd continuation must attribute the completed build or ten completed remotes and the failed shell attempt',
    );
    const priorCloudflare = cloudflare.priorRunLog;
    assertCondition(
      path.isAbsolute(priorCloudflare.path) &&
        typeof priorCloudflare.text === 'string' &&
        Buffer.byteLength(priorCloudflare.text) ===
          priorCloudflare.byteLength &&
        digest(priorCloudflare.text) === priorCloudflare.sha256 &&
        isDeepStrictEqual(
          parsePriorCloudflareBuildAttribution(priorCloudflare.text, {
            projectDir: reused.projectDirectory,
            applicationSourceRevision: record.binding.applicationSourceRevision,
            rootBuildScript: priorCloudflare.attribution.rootBuild.command,
            apps: reused.nodeOutputs.map(output => ({
              id: output.appId,
              path: output.path,
              kind: output.appId === 'shell-super-app' ? 'shell' : 'vertical',
              buildScript:
                output.appId === 'shell-super-app' && !completedBuild
                  ? priorCloudflare.attribution.shellAttempt.command
                  : priorCloudflare.attribution.commands.find(
                      command => command.appId === output.appId,
                    )?.command,
            })),
          }),
          priorCloudflare.attribution,
        ),
      'Workerd continuation Cloudflare command attribution differs from original evidence',
    );
    assertCondition(
      isDeepStrictEqual(cloudflare.outputs, record.runtimeOutputs?.workerd),
      'Workerd reused Cloudflare outputs differ from verified target outputs',
    );
    assertCondition(
      record.results?.find(result => result.id === 'cloudflare-output')?.details
        ?.originalAggregateBuildSucceeded === completedBuild,
      'Workerd continuation aggregate build outcome differs from original command evidence',
    );
    if (!completedBuild) assertShellFinalization(record, release);
  }
  const prior = reused.priorRunLog;
  assertCondition(
    path.isAbsolute(prior.path) &&
      typeof prior.text === 'string' &&
      Buffer.byteLength(prior.text) === prior.byteLength &&
      digest(prior.text) === prior.sha256 &&
      isDeepStrictEqual(
        parsePriorNodeBuildAttribution(prior.text, {
          projectDir: reused.projectDirectory,
          applicationSourceRevision: record.binding.applicationSourceRevision,
          rootBuildScript: prior.attribution.rootBuild?.command,
          apps: reused.nodeOutputs.map(output => ({
            id: output.appId,
            path: output.path,
            kind: output.appId === 'shell-super-app' ? 'shell' : 'vertical',
            buildScript: prior.attribution.commands.find(
              command => command.appId === output.appId,
            )?.command,
          })),
        }),
        prior.attribution,
      ),
    'Acceptance continuation prior command attribution differs from original evidence',
  );
  assertCondition(
    Array.isArray(record.results) &&
      isDeepStrictEqual(
        record.results.map(result => result.id),
        requiredContinuationResultIds(record.cursor),
      ),
    'Continuation results must contain only its twenty remaining stages',
  );
  if (!requirePassed) return record;
  assertNativeOutputSnapshots(
    record.runtimeOutputs?.workerd,
    record.binding.applicationSourceRevision,
    'cloudflare',
  );
  assertNativeTargetCoherence(
    reused.nodeOutputs,
    record.runtimeOutputs.workerd,
  );
  assertCondition(
    record.status === 'passed' &&
      record.passed === true &&
      record.error === null &&
      record.results.every(
        result =>
          result.status === 'pass' &&
          result.details &&
          Number.isFinite(result.details.durationMs) &&
          result.details.durationMs >= 0,
      ),
    'Acceptance continuation has incomplete or failed stages',
  );
  const appIds = reused.nodeOutputs.map(output => output.appId);
  const verticals = appIds.filter(appId => appId !== 'shell-super-app');
  const identities = new Map();
  for (const platform of ['node', 'workerd']) {
    const report = reportValue(
      record.runtimeReports?.[platform],
      platform,
      reused.projectDirectory,
      appIds,
    );
    const outputs =
      platform === 'node' ? reused.nodeOutputs : record.runtimeOutputs.workerd;
    assertReportOutputBinding(report, outputs, platform);
    for (const dimension of runtimeAcceptanceDimensions) {
      const result = record.results.find(
        candidate => candidate.id === `${platform}-${dimension}`,
      );
      const expectedDetails = assertRuntimeAcceptanceDimension(report, {
        applicationSourceRevision: record.binding.applicationSourceRevision,
        artifactBinding: createRuntimeArtifactBinding(record.binding.artifacts),
        dimension,
        mode: 'source',
        platform,
        release,
        verticals,
      });
      const { durationMs: _durationMs, ...details } = result.details;
      assertCondition(
        isDeepStrictEqual(details, expectedDetails),
        `${platform}-${dimension} differs from its actual runtime report`,
      );
      if (dimension === 'release-identity') {
        assertCondition(
          expectedDetails.apps.every(app => {
            const output = outputs.find(
              candidate => candidate.appId === app.appId,
            );
            return (
              output &&
              app.buildMarker === output.identity.buildMarker &&
              app.sourceRevision === output.identity.sourceRevision &&
              app.releaseVersion === output.identity.releaseVersion
            );
          }),
          `${platform} native release identity differs from its verified target outputs`,
        );
      }
      if (dimension === 'release-identity')
        identities.set(platform, expectedDetails);
    }
  }
  assertCondition(
    isDeepStrictEqual(
      record.binding.runtimeIdentity,
      runtimeIdentityBinding(identities.get('node'), identities.get('workerd')),
    ),
    'Continuation runtime identity binding differs from native proof',
  );
  assertOperationalIndependenceResultDetails(
    record.results.find(result => result.id === operationalIndependenceResultId)
      .details,
    'source',
  );
  return record;
}

function verifyAcceptanceContinuationOperationalEvidence({
  receiptPath,
  receipt,
  release,
}) {
  assertAcceptanceContinuation(receipt, {
    release,
    runIdentity: receipt.binding?.runIdentity,
  });
  return verifyAcceptanceReceiptOperationalEvidence(receipt, receiptPath);
}

function readInstalledPolicyEnvironment(projectDir, environment = {}) {
  return createAcceptedNodeProofEnvironment(projectDir, environment);
}

async function runAcceptanceContinuation({
  release,
  options,
  outPath,
  runIdentity,
  workDir,
  storeDir,
  priorRunLogPath,
  nodeReportPath,
  cursor = 'source-node',
  cloudflareRunLogPath,
  shellFinalizationPath,
  environment = process.env,
  runImpl = run,
}) {
  assertReleaseAcceptanceProfile(options);
  const stat = fs.lstatSync(workDir);
  assertCondition(
    path.isAbsolute(workDir) &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      fs.realpathSync(workDir) === workDir &&
      (typeof process.getuid !== 'function' || stat.uid === process.getuid()),
    'Continuation requires an existing physical caller-owned work directory',
  );
  assertCondition(
    !fs.existsSync(outPath),
    'Continuation requires a fresh execution record path',
  );
  const projectDir = path.join(workDir, options.projectName);
  const applicationSourceRevision = assertCleanCommittedSource(projectDir);
  const installedCohort = assertGeneratedCohort(projectDir, release);
  const artifacts = readWorkspaceAcceptanceArtifacts(projectDir);
  const { contract } = readSmokeContract(projectDir);
  const nodeOutputs = captureNativeOutputs(
    projectDir,
    contract,
    cursor === 'source-workerd' ? 'dist' : '.output',
    'node',
    applicationSourceRevision,
  );
  const rootPackage = readJson(
    path.join(projectDir, 'package.json'),
    'Workspace manifest',
  );
  const priorRunLog = readPriorNodeBuildAttribution(priorRunLogPath, {
    projectDir,
    applicationSourceRevision,
    rootBuildScript: rootPackage.scripts.build,
    apps: artifacts.apps.map(app => ({
      id: app.id,
      path: app.path,
      kind: app.kind,
      buildScript: readJson(
        path.join(projectDir, app.path, 'package.json'),
        'App manifest',
      ).scripts.build,
    })),
  });
  const record = {
    schema: acceptanceContinuationSchema,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'source',
    cursor,
    status: 'running',
    passed: false,
    binding: {
      ...releaseBinding(release),
      profile: { id: 'erp-10', version: 1 },
      runIdentity,
      applicationSourceRevision,
      runtimeIdentity: null,
    },
    reusedEvidence: {
      projectDirectory: projectDir,
      applicationSourceRevision,
      priorRunLog,
      installedCohort,
      nodeOutputs,
    },
    runtimeReports: {},
    runtimeOutputs: {},
    results: requiredContinuationResultIds(cursor).map(id => ({
      id,
      status: 'pending',
    })),
    error: null,
  };
  const save = () => writeJsonFile(outPath, record);
  const stage = async (id, action) => {
    const start = performance.now();
    try {
      return await recordAcceptanceResult(record, id, async () => ({
        ...(await action()),
        durationMs: roundDurationMs(performance.now() - start),
      }));
    } finally {
      save();
    }
  };
  save();
  let failure;
  try {
    const {
      createAcceptanceBuildEnv,
      createAcceptanceDeploymentEnv,
      createAcceptanceRuntimeContext,
      createOperationalIndependenceCommit,
      operationalIndependenceIds,
      requiredPnpmCommands,
    } = await import('./acceptance-profile.mjs');
    const { runBrowserSmoke } = await import('./browser-smoke.mjs');
    const runtime = createAcceptanceRuntimeContext({
      expectedPnpmVersion: release.tools?.pnpm,
      workDir,
      storeDir,
      environment,
      runImpl,
    });
    const artifactRoot = `${outPath}.runtime`;
    record.runtimeReports.node = readRuntimeReport(
      nodeReportPath ??
        path.join(
          repoRoot,
          '.modern/production-readiness/browser-smoke/source-node-summary.json',
        ),
      'external-report',
    );
    const nodeReport = reportValue(
      record.runtimeReports.node,
      'node',
      projectDir,
      nodeOutputs.map(output => output.appId),
    );
    assertReportOutputBinding(nodeReport, nodeOutputs, 'node');
    const portEnv = Object.fromEntries(
      contract.apps.map(app => {
        const result = nodeReport.results.find(
          candidate => candidate.appId === app.id,
        );
        const url = new URL(result.baseUrl);
        assertCondition(
          url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
            Number(url.port) > 0,
          `${app.id} retained Node report has no local target port`,
        );
        return [appPortEnv(app), url.port];
      }),
    );
    const deploymentEnv = createAcceptanceDeploymentEnv(contract, {
      ...readInstalledPolicyEnvironment(projectDir, runtime.env),
      ...portEnv,
    });
    await stage('topology', () =>
      assertTopologyAcceptance(artifacts, options.verticals),
    );
    await stage('module-federation', () =>
      assertModuleFederationAcceptance(artifacts, options.verticals),
    );
    await stage('api', () => assertApiAcceptance(artifacts, options.verticals));
    await stage('backend', () => {
      if (cursor === 'source-node')
        return assertBackendAcceptance(artifacts, options.verticals);
      const envelopes = options.verticals.map(appId => {
        const output = nodeOutputs.find(candidate => candidate.appId === appId);
        assertCondition(
          output?.releaseEnvelope.surfaces?.backendFederation &&
            output.releaseEnvelope.surfaces.apiBackend?.length > 0,
          `${appId} original Node native output requires API/backend contracts`,
        );
        return {
          appId,
          envelopeDigest: output.releaseEnvelope.envelopeDigest,
          envelopePath: path.join(
            projectDir,
            output.path,
            output.directory,
            'release/microvertical-release-envelope.json',
          ),
        };
      });
      return {
        backendCount: envelopes.length,
        target: 'node',
        appIds: options.verticals,
        envelopes,
      };
    });
    const identityDetails = new Map();
    const recordRuntime = async (platform, report) => {
      for (const dimension of runtimeAcceptanceDimensions) {
        const details = await stage(`${platform}-${dimension}`, () =>
          assertRuntimeAcceptanceDimension(report, {
            applicationSourceRevision,
            artifactBinding: createRuntimeArtifactBinding(
              record.binding.artifacts,
            ),
            dimension,
            mode: 'source',
            platform,
            release,
            verticals: options.verticals,
          }),
        );
        if (dimension === 'release-identity')
          identityDetails.set(platform, details);
      }
    };
    await recordRuntime('node', nodeReport);
    assertCondition(
      identityDetails.get('node').apps.every(app => {
        const output = nodeOutputs.find(
          candidate => candidate.appId === app.appId,
        );
        return (
          output &&
          app.buildMarker === output.identity.buildMarker &&
          app.sourceRevision === output.identity.sourceRevision &&
          app.releaseVersion === output.identity.releaseVersion
        );
      }),
      'Node native release identity differs from the reused deployment outputs',
    );
    assertCleanCommittedSource(projectDir, {
      expectedCommit: applicationSourceRevision,
    });
    if (cursor === 'source-node') {
      await stage('cloudflare-build', () => {
        runImpl('pnpm', requiredPnpmCommands.cloudflareBuild, {
          cwd: projectDir,
          env: createAcceptanceBuildEnv(deploymentEnv),
        });
        record.runtimeOutputs.workerd = captureNativeOutputs(
          projectDir,
          contract,
          '.output',
          'cloudflare',
          applicationSourceRevision,
        );
        return { command: 'pnpm cloudflare:build' };
      });
    } else {
      await stage('cloudflare-output', () => {
        const priorCloudflareRunLog = readPriorCloudflareBuildAttribution(
          cloudflareRunLogPath,
          {
            projectDir,
            applicationSourceRevision,
            rootBuildScript: rootPackage.scripts['cloudflare:build'],
            apps: artifacts.apps.map(app => ({
              id: app.id,
              path: app.path,
              kind: app.kind,
              buildScript: readJson(
                path.join(projectDir, app.path, 'package.json'),
                'App manifest',
              ).scripts['cloudflare:build'],
            })),
          },
        );
        record.runtimeOutputs.workerd = captureNativeOutputs(
          projectDir,
          contract,
          '.output',
          'cloudflare',
          applicationSourceRevision,
        );
        record.reusedEvidence.cloudflare = {
          priorRunLog: priorCloudflareRunLog,
          outputs: record.runtimeOutputs.workerd,
        };
        const completedBuild =
          priorCloudflareRunLog.attribution.rootCompletion !== undefined;
        if (completedBuild) {
          assertCondition(
            shellFinalizationPath === undefined,
            'Completed Cloudflare build evidence must not claim separate shell finalization',
          );
        } else {
          assertCondition(
            typeof shellFinalizationPath === 'string',
            'Failed Cloudflare shell build requires separate public shell finalization',
          );
          record.reusedEvidence.cloudflare.shellFinalization =
            readRuntimeReport(shellFinalizationPath, 'external-report');
          assertShellFinalization(record, release);
          for (const [key, pin] of Object.entries(
            JSON.parse(record.reusedEvidence.cloudflare.shellFinalization.text)
              .descriptors,
          )) {
            const actual = readRegularFile(
              pin.path,
              `Shell finalization ${key}`,
            );
            assertCondition(
              actual.byteLength === pin.byteLength &&
                actual.sha256 === pin.sha256,
              `Shell finalization ${key} bytes changed before continuation`,
            );
          }
        }
        return {
          target: 'cloudflare',
          appIds: contract.apps.map(app => app.id),
          originalAggregateBuildSucceeded: completedBuild,
        };
      });
    }
    assertNativeTargetCoherence(nodeOutputs, record.runtimeOutputs.workerd);
    await runBrowserSmoke(projectDir, {
      ...runtimeAcceptanceInvocation('source', 'workerd'),
      artifactRoot,
      packageManagerEnv: deploymentEnv,
    });
    record.runtimeReports.workerd = readRuntimeReport(
      path.join(artifactRoot, 'source-workerd-summary.json'),
      'executed-here',
    );
    const workerdReport = reportValue(
      record.runtimeReports.workerd,
      'workerd',
      projectDir,
      nodeOutputs.map(output => output.appId),
    );
    assertReportOutputBinding(
      workerdReport,
      record.runtimeOutputs.workerd,
      'workerd',
    );
    await recordRuntime('workerd', workerdReport);
    record.binding.runtimeIdentity = runtimeIdentityBinding(
      identityDetails.get('node'),
      identityDetails.get('workerd'),
    );
    // The operational proof reuses C0 target builds instead of rebuilding
    // them. Every app's `.output` now holds the Cloudflare C0 build, so prove
    // Cloudflare first, then rebuild Node C0 once and prove Node against it.
    await stage(operationalIndependenceResultId, async () => {
      const baseline = target =>
        captureOperationalBaseline({
          workspace: projectDir,
          target,
          ids: operationalIndependenceIds,
          packageManagerEnv: deploymentEnv,
        });
      const cloudflareBaseline = baseline('cloudflare');
      const transition = createOperationalIndependenceCommit(
        projectDir,
        applicationSourceRevision,
        deploymentEnv,
        runImpl,
      );
      const proofInput = {
        changedRef: transition.changedRevision,
        expectedApiValue: transition.mutations.apiResponse.value,
        expectedUiValue: transition.mutations.uiLocalization.value,
        packageManagerEnv: deploymentEnv,
      };
      const cloudflare = await proveOperationalTarget({
        baseline: cloudflareBaseline,
        ...proofInput,
      });
      runImpl('pnpm', requiredPnpmCommands.build, {
        cwd: projectDir,
        env: createAcceptanceBuildEnv(deploymentEnv),
      });
      const node = await proveOperationalTarget({
        baseline: baseline('node'),
        ...proofInput,
      });
      const evidencePath = operationalIndependenceEvidencePath(outPath);
      return createOperationalIndependenceResultDetails({
        applicationSourceRevision,
        changedRevision: transition.changedRevision,
        evidence: assembleOperationalEvidence({
          node,
          cloudflare,
          out: evidencePath,
        }),
        evidencePath,
        expectedApiValue: transition.mutations.apiResponse.value,
        expectedChangedPaths: transition.changedPaths,
        expectedUiValue: transition.mutations.uiLocalization.value,
        mode: 'source',
      });
    });
  } catch (error) {
    failure = error;
  }
  finalizeAcceptanceReceipt(record, failure);
  if (!failure) {
    try {
      assertAcceptanceContinuation(record, { release, runIdentity });
      verifyAcceptanceReceiptOperationalEvidence(record, outPath);
    } catch (error) {
      failure = error;
      record.status = 'failed';
      record.passed = false;
      record.error = error instanceof Error ? error.message : String(error);
    }
  }
  save();
  if (failure) throw failure;
  return record;
}

export {
  acceptanceContinuationSchema,
  assertAcceptanceContinuation,
  assertNodeOutputSnapshots,
  continuationResultIds,
  createRuntimeArtifactBinding,
  readInstalledPolicyEnvironment,
  reportValue,
  requiredContinuationResultIds,
  runAcceptanceContinuation,
  verifyAcceptanceContinuationOperationalEvidence,
};
