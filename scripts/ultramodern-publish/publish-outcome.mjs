#!/usr/bin/env node
// Consumer: publish-bleedingdev.yml `record-publish-outcome` create command;
// exports also support fail-closed publish-outcome artifact discovery.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import validationKit from '../lib/validation-kit.js';
import { assertOperationalIndependenceEvidenceMatchesReceipt } from '../ultramodern-production-readiness/published-create-proof/acceptance-contract.mjs';
import { assertAcceptanceReceipt } from '../ultramodern-production-readiness/published-create-proof/acceptance-receipt.mjs';
import {
  assertVisibleTractorUiSummary,
  requiredTractorCheckIds,
  requiredVisibleRuntimePlatforms,
  tractorTopologiesByBaseline,
} from '../ultramodern-production-readiness/tractor-downstream/contract.mjs';
import { readReleaseManifest } from './lib/source-create-proof/release-manifest.mjs';

const { assertNonEmptyString: assertBaseNonEmptyString, assertPlainObject } =
  validationKit;

const requiredNodeHttpAssertionTypes = Object.freeze([
  'ssr-route',
  'ui-marker-html',
  'css-root-marker',
  'mf-manifest',
  'mf-manifest-json',
  'locale-json',
]);
const requiredNodeNoJavaScriptAssertionTypes = Object.freeze([
  'no-js-ssr-css-root-marker',
  'no-js-stylesheet-href-dedupe',
  'no-js-ssr-failed-responses',
]);
const publishOutcomeSchema = 'bleedingdev.ultramodern.publish-outcome';
const publishOutcomeSchemaVersion = 6;
const publishOutcomeArtifactPrefix = 'bleedingdev-publish-outcome';
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const sortedExpected = [...expected].sort((left, right) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${label} has unknown or missing fields: expected ${sortedExpected.join(
        ', ',
      )}; found ${actual.join(', ')}`,
    );
  }
}

function assertNonEmptyString(value, label) {
  assertBaseNonEmptyString(value, label);
  if (/\r|\n/u.test(value)) {
    throw new Error(`${label} must not contain line breaks`);
  }
}

function positiveInteger(value, label) {
  const normalized =
    typeof value === 'string' && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return normalized;
}

function runIdString(value, label = 'workflow run id') {
  const normalized = String(value);
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }
  return normalized;
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} must contain valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parsed;
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function hasPassingAssertionTypes(assertions, reportedTypes, requiredTypes) {
  if (
    !Array.isArray(assertions) ||
    !Array.isArray(reportedTypes) ||
    assertions.some(
      assertion =>
        typeof assertion?.type !== 'string' || assertion.status !== 'pass',
    ) ||
    !isDeepStrictEqual(
      reportedTypes,
      assertions.map(assertion => assertion.type),
    )
  ) {
    return false;
  }
  return requiredTypes.every(type => reportedTypes.includes(type));
}

function hasExactStringSet(values, expected) {
  return (
    Array.isArray(values) &&
    values.every(value => typeof value === 'string' && value.length > 0) &&
    new Set(values).size === values.length &&
    isDeepStrictEqual([...values].sort(), [...expected].sort())
  );
}

function hasShellCompositionEvidence(
  assertions,
  expectedRemoteIds,
  boundaryCandidatesByRemoteId,
) {
  const composition = assertions?.find(
    assertion => assertion?.type === 'no-js-shell-composition-boundary',
  );
  const matched = composition?.matchedRemoteBoundaries;
  const tried = composition?.triedRemoteBoundaries;
  const triedByRemoteId = new Map(
    tried?.map(boundary => [boundary?.remoteId, boundary]),
  );
  return (
    composition?.status === 'pass' &&
    hasExactStringSet(composition.declaredRemoteIds, expectedRemoteIds) &&
    hasExactStringSet(
      matched?.map(boundary => boundary?.remoteId),
      expectedRemoteIds,
    ) &&
    matched.every(boundary => {
      const triedBoundary = triedByRemoteId.get(boundary.remoteId);
      return (
        typeof boundary.boundaryId === 'string' &&
        boundary.boundaryId.length > 0 &&
        triedBoundary?.matchedBoundaryId === boundary.boundaryId &&
        triedBoundary.triedBoundaryIds?.includes(boundary.boundaryId)
      );
    }) &&
    hasExactStringSet(
      tried?.map(boundary => boundary?.remoteId),
      expectedRemoteIds,
    ) &&
    tried.every(
      boundary =>
        typeof boundary.matchedBoundaryId === 'string' &&
        boundary.matchedBoundaryId.length > 0 &&
        isDeepStrictEqual(
          boundary.triedBoundaryIds,
          boundaryCandidatesByRemoteId[boundary.remoteId],
        ) &&
        boundary.triedBoundaryIds.includes(boundary.matchedBoundaryId),
    )
  );
}

function hasStrictNodeSsrEvidence(
  detail,
  expectedVerticalIds,
  boundaryCandidatesByRemoteId,
) {
  if (
    detail?.status !== 'pass' ||
    !Number.isSafeInteger(detail.appCount) ||
    detail.appCount !== expectedVerticalIds.length + 1 ||
    typeof detail.distributedSsrRoute !== 'string' ||
    detail.distributedSsrRoute.trim().length === 0 ||
    !detail.distributedSsrRoute.startsWith('/') ||
    !Array.isArray(detail.results) ||
    detail.results.length !== detail.appCount
  ) {
    return false;
  }
  const appIds = detail.results.map(result => result?.appId);
  const expectedAppIds = ['shell-super-app', ...expectedVerticalIds];
  const shellResult = detail.results.find(
    result => result?.appId === 'shell-super-app',
  );
  const assertedDistributedSsrRoute = shellResult?.noJavaScriptAssertions?.find(
    assertion => assertion?.type === 'no-js-distributed-ssr-route',
  )?.route;
  return (
    hasExactStringSet(appIds, expectedAppIds) &&
    detail.distributedSsrRoute === assertedDistributedSsrRoute &&
    detail.results.every(result => {
      const requiredNoJavaScriptTypes = [
        ...requiredNodeNoJavaScriptAssertionTypes,
        ...(result.appId === 'shell-super-app'
          ? ['no-js-distributed-ssr-route', 'no-js-shell-composition-boundary']
          : ['no-js-ssr-ui-marker']),
      ];
      return (
        hasPassingAssertionTypes(
          result.httpAssertions,
          result.httpAssertionTypes,
          requiredNodeHttpAssertionTypes,
        ) &&
        hasPassingAssertionTypes(
          result.noJavaScriptAssertions,
          result.noJavaScriptAssertionTypes,
          requiredNoJavaScriptTypes,
        ) &&
        (result.appId !== 'shell-super-app' ||
          hasShellCompositionEvidence(
            result.noJavaScriptAssertions,
            expectedVerticalIds,
            boundaryCandidatesByRemoteId,
          ))
      );
    })
  );
}

function readTractorAcceptanceEvidence({
  baselineRevision,
  cohortDigest,
  expectedCreateSpecifier,
  expectedPackageCount,
  manifestSha256,
  reportPath,
  reportSha256,
  sourceCommit,
  version,
}) {
  if (
    reportPath === undefined &&
    baselineRevision === undefined &&
    reportSha256 === undefined
  ) {
    return null;
  }
  if (
    reportPath === undefined ||
    baselineRevision === undefined ||
    reportSha256 === undefined
  ) {
    throw new Error(
      'Tractor acceptance report, baseline revision, and SHA-256 must be provided together',
    );
  }
  assertSourceCommit(baselineRevision, 'Tractor baseline revision');
  assertDigest(reportSha256, 'Tractor report SHA-256');
  const actualSha256 = sha256File(reportPath);
  if (actualSha256 !== reportSha256) {
    throw new Error(
      'Tractor acceptance report SHA-256 does not match the workflow output',
    );
  }
  const report = readJson(reportPath, 'Tractor acceptance report');
  if (
    report.schema !== 'bleedingdev.ultramodern.tractor-downstream-acceptance' ||
    report.schemaVersion !== 1 ||
    report.status !== 'passed' ||
    report.release?.cohortDigest !== cohortDigest ||
    report.release?.manifestSha256 !== manifestSha256 ||
    report.release?.sourceRevision !== sourceCommit ||
    report.release?.version !== version ||
    report.tractor?.baselineRevision !== baselineRevision ||
    !Array.isArray(report.checks)
  ) {
    throw new Error(
      'Tractor acceptance report is not a passing report for the exact release and baseline',
    );
  }
  const checkIds = report.checks.map(check => check?.id);
  if (JSON.stringify(checkIds) !== JSON.stringify(requiredTractorCheckIds)) {
    throw new Error(
      'Tractor acceptance report must contain every required check exactly once and in contract order',
    );
  }
  const checksById = new Map();
  for (const check of report.checks) {
    if (
      typeof check?.id !== 'string' ||
      checksById.has(check.id) ||
      check.status !== 'passed'
    ) {
      throw new Error(
        'Tractor acceptance report contains duplicate, malformed, or failing checks',
      );
    }
    checksById.set(check.id, check);
  }
  const createMigration = checksById.get('exact-create-migration')?.detail;
  if (
    createMigration?.createPackage !== expectedCreateSpecifier ||
    createMigration?.version !== version
  ) {
    throw new Error(
      'Tractor acceptance report exact-create migration does not match the strict release manifest',
    );
  }
  const exactCohort = checksById.get('exact-cohort')?.detail;
  if (
    !Number.isSafeInteger(exactCohort?.dependencyObservationCount) ||
    exactCohort.dependencyObservationCount < 1 ||
    exactCohort.generatedCohort?.packageCount !== expectedPackageCount ||
    exactCohort.generatedCohort?.projectionSchema !==
      'bleedingdev.ultramodern.release-cohort' ||
    exactCohort.generatedCohort?.projectionSchemaVersion !== 1 ||
    exactCohort.generatedCohort?.version !== version
  ) {
    throw new Error(
      'Tractor acceptance report exact cohort does not match the strict release manifest',
    );
  }
  const reviewedTopology = tractorTopologiesByBaseline[baselineRevision];
  if (!reviewedTopology) {
    throw new Error(
      'Tractor acceptance baseline has no independently reviewed topology contract',
    );
  }
  for (const [id, platform] of [
    ['node-visible-tractor-workflow', 'node'],
    ['workerd-visible-tractor-workflow', 'workerd'],
  ]) {
    const detail = checksById.get(id)?.detail;
    if (
      detail?.platform !== platform ||
      !Number.isSafeInteger(detail.assertionCount) ||
      detail.assertionCount !==
        reviewedTopology.visibleWorkflowRoutePatterns.length ||
      !Array.isArray(detail.routes) ||
      detail.routes.length !== detail.assertionCount ||
      !detail.routes.every(
        (route, index) =>
          typeof route === 'string' &&
          new RegExp(
            reviewedTopology.visibleWorkflowRoutePatterns[index],
            'u',
          ).test(route),
      )
    ) {
      throw new Error(
        `Tractor acceptance report is missing executed ${platform} browser workflow evidence`,
      );
    }
  }
  const nodeBackend = checksById.get(
    'node-backend-federation-executed',
  )?.detail;
  if (
    nodeBackend?.status !== 'pass' ||
    !Number.isSafeInteger(nodeBackend.resultCount) ||
    nodeBackend.resultCount !== reviewedTopology.backendAppIds.length ||
    !hasExactStringSet(nodeBackend.appIds, reviewedTopology.backendAppIds)
  ) {
    throw new Error(
      'Tractor acceptance report is missing executed Node backend-federation evidence for the reviewed topology',
    );
  }
  const nodeSsr = checksById.get('node-server-rendered-ssr-executed')?.detail;
  if (
    !hasStrictNodeSsrEvidence(
      nodeSsr,
      reviewedTopology.ssrVerticalIds,
      reviewedTopology.shellRemoteBoundaryCandidates,
    )
  ) {
    throw new Error(
      'Tractor acceptance report is missing executed Node server-rendered SSR evidence',
    );
  }
  const visibleUi = checksById.get('visible-tractor-ui')?.detail;
  if (
    !visibleUi ||
    !hasExactStringSet(Object.keys(visibleUi), requiredVisibleRuntimePlatforms)
  ) {
    throw new Error(
      'Tractor acceptance report is missing exact visible UI platform evidence',
    );
  }
  for (const platform of requiredVisibleRuntimePlatforms) {
    const workflow = checksById.get(
      `${platform}-visible-tractor-workflow`,
    )?.detail;
    if (!isDeepStrictEqual(visibleUi[platform], workflow?.ui)) {
      throw new Error(
        `Tractor ${platform} visible UI summary differs from its executed browser workflow`,
      );
    }
    assertVisibleTractorUiSummary(workflow.ui);
  }
  return {
    baselineRevision,
    reportSha256: actualSha256,
  };
}

function publishOutcomeArtifactName({ runId, runAttempt }) {
  return `${publishOutcomeArtifactPrefix}-run-${runIdString(
    runId,
  )}-attempt-${positiveInteger(runAttempt, 'workflow run attempt')}`;
}

function assertRepository(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value)) {
    throw new Error(`${label} must be an owner/repository identity`);
  }
}

function assertSourceCommit(value, label) {
  if (typeof value !== 'string' || !commitPattern.test(value)) {
    throw new Error(`${label} must be a full lowercase Git object id`);
  }
}

function assertVersion(value, label) {
  if (typeof value !== 'string' || !semverPattern.test(value)) {
    throw new Error(`${label} must be an exact semantic version`);
  }
}

function readReleaseEvidence({
  cohortDigestPath,
  manifestDigestPath,
  manifestPath,
  operationalEvidencePath,
  publishedReceiptPath,
  receiptPath,
  repository,
  runIdentity,
  sourceCommit,
  tag,
  tractorBaselineRevision,
  tractorReportPath,
  tractorReportSha256,
  version,
}) {
  const manifest = readJson(manifestPath, 'Release manifest');
  assertExactKeys(
    manifest,
    [
      'aliases',
      'cohortDigest',
      'cohortProjection',
      'dependencyGraph',
      'packages',
      'publishOrder',
      'release',
      'schema',
      'schemaVersion',
      'sidecars',
      'source',
      'tools',
    ],
    'Release manifest',
  );
  assertExactKeys(manifest.source, ['commit', 'repository'], 'Release source');
  assertExactKeys(manifest.release, ['tag', 'version'], 'Release identity');
  if (
    manifest.schema !== 'bleedingdev.ultramodern.release-manifest' ||
    manifest.schemaVersion !== 3 ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0 ||
    !Array.isArray(manifest.publishOrder)
  ) {
    throw new Error('Release manifest must use the strict v3 release schema');
  }
  assertRepository(manifest.source.repository, 'Release source repository');
  assertSourceCommit(manifest.source.commit, 'Release source commit');
  assertVersion(manifest.release.version, 'Release version');
  assertNonEmptyString(manifest.release.tag, 'Release tag');
  assertDigest(manifest.cohortDigest, 'Release cohort digest');
  if (
    manifest.source.repository !== repository ||
    manifest.source.commit !== sourceCommit ||
    manifest.release.version !== version ||
    manifest.release.tag !== tag
  ) {
    throw new Error(
      'Release manifest does not match the expected source and version',
    );
  }

  const manifestSha256 = sha256File(manifestPath);
  const verifiedRelease = readReleaseManifest({ manifestPath });
  const detachedManifest = fs.readFileSync(manifestDigestPath, 'utf8');
  const detachedCohort = fs.readFileSync(cohortDigestPath, 'utf8');
  if (detachedManifest !== `${manifestSha256}  manifest.json\n`) {
    throw new Error('Detached release manifest digest is invalid');
  }
  if (detachedCohort !== `${manifest.cohortDigest}\n`) {
    throw new Error('Detached release cohort digest is invalid');
  }
  const acceptanceEvidence = (receiptFile, operationalFile, expectedMode) => {
    const receipt = readJson(receiptFile, `${expectedMode} acceptance receipt`);
    assertPlainObject(receipt, `${expectedMode} acceptance receipt`);
    assertAcceptanceReceipt(receipt, {
      expectedMode,
      profileId: 'erp-10',
      release: verifiedRelease,
      runIdentity,
    });
    if (
      receipt.mode !== expectedMode ||
      receipt.status !== 'passed' ||
      receipt.passed !== true ||
      receipt.error !== null ||
      receipt.binding?.source?.repository !== repository ||
      receipt.binding?.source?.commit !== sourceCommit ||
      receipt.binding?.release?.tag !== tag ||
      receipt.binding?.release?.version !== version ||
      receipt.binding?.runIdentity !== runIdentity ||
      receipt.binding?.manifest?.sha256 !== manifestSha256 ||
      receipt.binding?.manifest?.cohortDigest !== manifest.cohortDigest ||
      receipt.binding?.manifest?.packageCount !== manifest.packages.length
    ) {
      throw new Error(
        `${expectedMode} acceptance receipt is not a complete passing receipt for the exact release manifest`,
      );
    }
    // ACC-1: operational-independence evidence exists only in the source
    // lane; the published receipt contract excludes that result id.
    if (expectedMode !== 'source') {
      return {
        evidencePath: null,
        receiptPath: path.basename(receiptFile),
      };
    }
    const operationalEvidence = readJson(
      operationalFile,
      `${expectedMode} operational evidence`,
    );
    assertPlainObject(
      operationalEvidence,
      `${expectedMode} operational evidence`,
    );
    const operationalResult = receipt.results.find(
      result => result?.id === 'operational-independence',
    );
    assertOperationalIndependenceEvidenceMatchesReceipt({
      details: operationalResult.details,
      evidence: operationalEvidence,
    });
    if (
      operationalResult?.details?.artifactMode !== expectedMode ||
      path.basename(operationalResult?.details?.evidencePath ?? '') !==
        path.basename(operationalFile)
    ) {
      throw new Error(
        `${expectedMode} acceptance receipt is not bound to the exact operational evidence`,
      );
    }
    return {
      evidencePath: path.basename(operationalFile),
      receiptPath: path.basename(receiptFile),
    };
  };

  const prepublishAcceptance = acceptanceEvidence(
    receiptPath,
    operationalEvidencePath,
    'source',
  );
  const publishedAcceptance =
    publishedReceiptPath === undefined
      ? null
      : acceptanceEvidence(publishedReceiptPath, undefined, 'published');
  const tractorAcceptance = readTractorAcceptanceEvidence({
    baselineRevision: tractorBaselineRevision,
    cohortDigest: manifest.cohortDigest,
    expectedCreateSpecifier:
      verifiedRelease.packageChecks.create.exactSpecifier,
    expectedPackageCount: verifiedRelease.packages.length,
    manifestSha256,
    reportPath: tractorReportPath,
    reportSha256: tractorReportSha256,
    sourceCommit: manifest.source.commit,
    version: manifest.release.version,
  });

  return {
    cohortDigest: manifest.cohortDigest,
    manifestSha256,
    prepublishAcceptance,
    publishedAcceptance,
    tractorAcceptance,
  };
}

function expectedProducerIdentity({ repository, runAttempt, runId }) {
  return `github:${repository}:run:${runIdString(runId)}:attempt:${positiveInteger(
    runAttempt,
    'producer run attempt',
  )}`;
}

function validateProducer({
  artifactIdentity,
  publicationRunAttempt,
  repository,
  runAttempt,
  runId,
  runIdentity,
}) {
  const normalizedAttempt = positiveInteger(runAttempt, 'Producer run attempt');
  const normalizedPublicationAttempt = positiveInteger(
    publicationRunAttempt,
    'Publication run attempt',
  );
  const normalizedRunId = runIdString(runId);
  if (normalizedAttempt > normalizedPublicationAttempt) {
    throw new Error(
      'Producer run attempt must not follow publication run attempt',
    );
  }
  if (
    artifactIdentity !== `run-${normalizedRunId}-attempt-${normalizedAttempt}`
  ) {
    throw new Error(
      'Producer artifact identity does not match the producer run',
    );
  }
  if (
    runIdentity !==
    expectedProducerIdentity({
      repository,
      runAttempt: normalizedAttempt,
      runId: normalizedRunId,
    })
  ) {
    throw new Error(
      'Producer run identity does not match the authenticated source run',
    );
  }
  return normalizedAttempt;
}

function createPublishOutcome({
  cohortDigestPath,
  dryRun,
  manifestDigestPath,
  manifestPath,
  operationalEvidencePath,
  outPath,
  publicationRunAttempt,
  producerArtifactIdentity,
  producerRunAttempt,
  producerRunIdentity,
  publishedReceiptPath,
  receiptPath,
  repository,
  runAttempt,
  runId,
  sourceCommit,
  tag,
  tractorBaselineRevision,
  tractorReportPath,
  tractorReportSha256,
  version,
}) {
  assertRepository(repository, 'Expected repository');
  assertSourceCommit(sourceCommit, 'Expected source commit');
  assertVersion(version, 'Expected release version');
  assertNonEmptyString(tag, 'Expected release tag');
  if (typeof dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  const normalizedRunId = runIdString(runId);
  const normalizedRunAttempt = positiveInteger(
    runAttempt,
    'Workflow run attempt',
  );
  const normalizedPublicationAttempt = dryRun
    ? null
    : positiveInteger(publicationRunAttempt, 'Publication run attempt');
  if (
    normalizedPublicationAttempt !== null &&
    normalizedPublicationAttempt > normalizedRunAttempt
  ) {
    throw new Error(
      'Publication run attempt must not follow workflow outcome attempt',
    );
  }
  const expectedArtifactName = publishOutcomeArtifactName({
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
  const normalizedProducerAttempt = validateProducer({
    artifactIdentity: producerArtifactIdentity,
    publicationRunAttempt: normalizedPublicationAttempt ?? normalizedRunAttempt,
    repository,
    runAttempt: producerRunAttempt,
    runId: normalizedRunId,
    runIdentity: producerRunIdentity,
  });
  const evidence = readReleaseEvidence({
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    operationalEvidencePath,
    publishedReceiptPath,
    receiptPath,
    repository,
    runIdentity: producerRunIdentity,
    sourceCommit,
    tag,
    tractorBaselineRevision,
    tractorReportPath,
    tractorReportSha256,
    version,
  });
  if (
    (dryRun &&
      (evidence.publishedAcceptance !== null ||
        evidence.tractorAcceptance !== null)) ||
    (!dryRun &&
      (evidence.publishedAcceptance === null ||
        evidence.tractorAcceptance === null))
  ) {
    throw new Error(
      dryRun
        ? 'Dry-run publish outcome must not contain published or Tractor acceptance evidence'
        : 'Non-dry publish outcome requires published and Tractor acceptance evidence',
    );
  }
  const outcome = {
    schema: publishOutcomeSchema,
    schemaVersion: publishOutcomeSchemaVersion,
    artifactName: expectedArtifactName,
    dryRun,
    source: { commit: sourceCommit, repository },
    release: { tag, version },
    workflowRun: { attempt: normalizedRunAttempt, id: normalizedRunId },
    publication:
      normalizedPublicationAttempt === null
        ? null
        : { runAttempt: normalizedPublicationAttempt },
    producer: {
      artifactIdentity: producerArtifactIdentity,
      runAttempt: normalizedProducerAttempt,
      runIdentity: producerRunIdentity,
    },
    evidence,
  };
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(outcome, null, 2)}\n`);
  return outcome;
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return Date.parse(value);
}

function selectPublishOutcomeArtifact(
  pages,
  { completedAt, runAttempt, runId },
) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Artifact API response must contain at least one page');
  }
  const normalizedRunId = runIdString(runId);
  const normalizedRunAttempt = positiveInteger(
    runAttempt,
    'Workflow run attempt',
  );
  const expectedName = publishOutcomeArtifactName({
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
  const completedAtMilliseconds = parseTimestamp(
    completedAt,
    'Trigger completion time',
  );
  const seenIds = new Set();
  const outcomeArtifacts = [];
  for (const [pageIndex, page] of pages.entries()) {
    assertPlainObject(page, `Artifact API page ${pageIndex + 1}`);
    if (!Array.isArray(page.artifacts)) {
      throw new Error(
        `Artifact API page ${pageIndex + 1}.artifacts must be an array`,
      );
    }
    for (const [artifactIndex, artifact] of page.artifacts.entries()) {
      const label = `Artifact API page ${pageIndex + 1} artifact ${artifactIndex + 1}`;
      assertPlainObject(artifact, label);
      positiveInteger(artifact.id, `${label}.id`);
      assertNonEmptyString(artifact.name, `${label}.name`);
      if (typeof artifact.expired !== 'boolean') {
        throw new Error(`${label}.expired must be a boolean`);
      }
      parseTimestamp(artifact.created_at, `${label}.created_at`);
      if (seenIds.has(artifact.id)) {
        throw new Error(
          `Artifact API repeated artifact id ${artifact.id} across pages`,
        );
      }
      seenIds.add(artifact.id);
      if (artifact.name.startsWith(publishOutcomeArtifactPrefix)) {
        outcomeArtifacts.push(artifact);
      }
    }
  }

  const canonicalPattern = new RegExp(
    `^${publishOutcomeArtifactPrefix}-run-([1-9]\\d*)-attempt-([1-9]\\d*)$`,
    'u',
  );
  for (const artifact of outcomeArtifacts) {
    const match = canonicalPattern.exec(artifact.name);
    if (
      !match ||
      match[1] !== normalizedRunId ||
      Number(match[2]) > normalizedRunAttempt
    ) {
      throw new Error(`Publish outcome artifact name drift: ${artifact.name}`);
    }
  }
  const matches = outcomeArtifacts.filter(
    artifact => artifact.name === expectedName,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one publish outcome artifact named ${expectedName}, found ${matches.length}`,
    );
  }
  const [artifact] = matches;
  if (artifact.expired) {
    throw new Error(`Publish outcome artifact ${expectedName} is expired`);
  }
  if (Date.parse(artifact.created_at) > completedAtMilliseconds) {
    throw new Error(
      `Publish outcome artifact ${expectedName} was created after the triggering run completed`,
    );
  }
  return artifact;
}

function parseOptions(argv, allowed) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${name ?? '<missing>'}`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate argument: ${name}`);
    }
    values.set(name, value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function booleanValue(value, label) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function appendGithubOutputs(filePath, outputs) {
  if (!filePath) {
    return;
  }
  const lines = Object.entries(outputs).map(([name, value]) => {
    const normalized = String(value);
    assertNonEmptyString(normalized, `GitHub output ${name}`);
    return `${name}=${normalized}`;
  });
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`);
}

const evidenceOptions = new Set([
  '--cohort-digest',
  '--manifest',
  '--manifest-digest',
  '--operational-evidence',
  '--published-receipt',
  '--receipt',
  '--tractor-baseline-revision',
  '--tractor-report',
  '--tractor-report-sha256',
]);

function evidencePaths(values, { dryRun } = {}) {
  const publishedReceipt = values.get('--published-receipt');
  const tractorBaselineRevision = values.get('--tractor-baseline-revision');
  const tractorReport = values.get('--tractor-report');
  const tractorReportSha256 = values.get('--tractor-report-sha256');
  if (dryRun === false && publishedReceipt === undefined) {
    throw new Error('Non-dry publish outcome requires --published-receipt');
  }
  if (dryRun === true && publishedReceipt !== undefined) {
    throw new Error('Dry-run publish outcome must not bind published evidence');
  }
  const tractorValues = [
    tractorBaselineRevision,
    tractorReportSha256,
    tractorReport,
  ];
  if (
    tractorValues.some(value => value === undefined) &&
    tractorValues.some(value => value !== undefined)
  ) {
    throw new Error(
      '--tractor-baseline-revision, --tractor-report, and --tractor-report-sha256 must be provided together',
    );
  }
  if (dryRun === false && tractorReport === undefined) {
    throw new Error(
      'Non-dry publish outcome requires Tractor acceptance evidence',
    );
  }
  if (dryRun === true && tractorReport !== undefined) {
    throw new Error('Dry-run publish outcome must not bind Tractor evidence');
  }
  return {
    cohortDigestPath: path.resolve(required(values, '--cohort-digest')),
    manifestDigestPath: path.resolve(required(values, '--manifest-digest')),
    manifestPath: path.resolve(required(values, '--manifest')),
    operationalEvidencePath: path.resolve(
      required(values, '--operational-evidence'),
    ),
    publishedReceiptPath:
      publishedReceipt === undefined
        ? undefined
        : path.resolve(publishedReceipt),
    receiptPath: path.resolve(required(values, '--receipt')),
    tractorBaselineRevision,
    tractorReportPath:
      tractorReport === undefined ? undefined : path.resolve(tractorReport),
    tractorReportSha256,
  };
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'create') {
    const values = parseOptions(
      args,
      new Set([
        ...evidenceOptions,
        '--dry-run',
        '--github-output',
        '--out',
        '--publication-run-attempt',
        '--producer-artifact-identity',
        '--producer-run-attempt',
        '--producer-run-identity',
        '--repository',
        '--run-attempt',
        '--run-id',
        '--source-commit',
        '--tag',
        '--version',
      ]),
    );
    const dryRun = booleanValue(required(values, '--dry-run'), '--dry-run');
    const outcome = createPublishOutcome({
      ...evidencePaths(values, { dryRun }),
      dryRun,
      outPath: path.resolve(required(values, '--out')),
      publicationRunAttempt: dryRun
        ? undefined
        : required(values, '--publication-run-attempt'),
      producerArtifactIdentity: required(
        values,
        '--producer-artifact-identity',
      ),
      producerRunAttempt: required(values, '--producer-run-attempt'),
      producerRunIdentity: required(values, '--producer-run-identity'),
      repository: required(values, '--repository'),
      runAttempt: required(values, '--run-attempt'),
      runId: required(values, '--run-id'),
      sourceCommit: required(values, '--source-commit'),
      tag: required(values, '--tag'),
      version: required(values, '--version'),
    });
    appendGithubOutputs(values.get('--github-output'), {
      artifact_name: outcome.artifactName,
    });
    return 0;
  }
  throw new Error('Command must be create');
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  createPublishOutcome,
  main,
  publishOutcomeArtifactName,
  publishOutcomeArtifactPrefix,
  publishOutcomeSchema,
  publishOutcomeSchemaVersion,
  selectPublishOutcomeArtifact,
};
