#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalPortsAvailable,
  startServer,
  startWorkerdProof,
} from './browser-smoke/bootstrap.mjs';
import { readSmokeContract } from './browser-smoke/contract.mjs';
import {
  extractUiMarker,
  fetchText,
  joinUrl,
  parseMaybeJson,
  waitForTarget,
} from './browser-smoke/http-validate.mjs';
import { bindContractToExpectedReleaseIdentities } from './browser-smoke/runtime-evidence.mjs';
import {
  createSmokeTargets,
  orderTargetsForLocalStartup,
} from './browser-smoke/targets.mjs';

const EVIDENCE_SCHEMA_VERSION = 1;
const ENVELOPE_RELATIVE_PATH = 'release/microvertical-release-envelope.json';
const ENVELOPE_KIND = 'ultramodern-target-microvertical-release-envelope';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SURFACE_NAMES = ['uiClient', 'ssr', 'apiBackend', 'backendFederation'];
const WIDGET_EXPOSE = './Widget';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalSerialize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Canonical evidence values must be finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
    .join(',')}}`;
}

function digestCanonical(value) {
  return sha256(Buffer.from(canonicalSerialize(value), 'utf8'));
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (canonicalSerialize(actual) !== canonicalSerialize(sortedExpected)) {
    throw new Error(
      `${label} must contain exactly ${sortedExpected.join(', ')}; received ${actual.join(', ')}.`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function normalizeLogicalPath(value, label) {
  const logicalPath = assertNonEmptyString(value, label);
  if (
    logicalPath.includes('\\') ||
    path.posix.isAbsolute(logicalPath) ||
    path.posix.normalize(logicalPath) !== logicalPath ||
    logicalPath === '.' ||
    logicalPath.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a normalized relative POSIX path.`);
  }
  return logicalPath;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function resolveContainedPath(root, logicalPath, label) {
  const absoluteRoot = fs.realpathSync(root);
  const lexicalPath = path.resolve(
    absoluteRoot,
    ...normalizeLogicalPath(logicalPath, label).split('/'),
  );
  if (!isPathInside(absoluteRoot, lexicalPath) || !fs.existsSync(lexicalPath)) {
    throw new Error(`${label} does not resolve to an existing contained file.`);
  }
  const realPath = fs.realpathSync(lexicalPath);
  if (
    !isPathInside(absoluteRoot, realPath) ||
    !fs.statSync(realPath).isFile()
  ) {
    throw new Error(`${label} must resolve to a contained regular file.`);
  }
  return realPath;
}

function readAndVerifyReleaseArtifact(outputRoot, value, index) {
  const label = `envelope.artifacts[${index}]`;
  const artifact = assertRecord(value, label);
  const kind = assertNonEmptyString(artifact.kind, `${label}.kind`);
  const expectedKeys =
    kind === 'file'
      ? ['kind', 'logicalPath', 'runtime', 'byteLength', 'sha256']
      : kind === 'symbolic-link'
        ? [
            'kind',
            'logicalPath',
            'runtime',
            'linkTarget',
            'targetKind',
            'targetLogicalPath',
          ]
        : undefined;
  if (!expectedKeys) {
    throw new Error(`${label}.kind must be "file" or "symbolic-link".`);
  }
  assertExactKeys(artifact, expectedKeys, label);

  const logicalPath = normalizeLogicalPath(
    artifact.logicalPath,
    `${label}.logicalPath`,
  );
  const runtime = assertNonEmptyString(artifact.runtime, `${label}.runtime`);
  const realRoot = fs.realpathSync(outputRoot);
  const lexicalPath = path.resolve(realRoot, ...logicalPath.split('/'));
  if (!isPathInside(realRoot, lexicalPath)) {
    throw new Error(`${label}.logicalPath resolves outside artifactRoot.`);
  }
  let lexicalStat;
  try {
    lexicalStat = fs.lstatSync(lexicalPath);
  } catch {
    throw new Error(`${label}.logicalPath does not exist.`);
  }

  if (kind === 'file') {
    if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) {
      throw new Error(
        `File artifact "${logicalPath}" must be a non-symlink regular file.`,
      );
    }
    let ancestor = realRoot;
    for (const segment of logicalPath.split('/').slice(0, -1)) {
      ancestor = path.join(ancestor, segment);
      if (fs.lstatSync(ancestor).isSymbolicLink()) {
        throw new Error(
          `File artifact "${logicalPath}" has a symbolic-link ancestor.`,
        );
      }
    }
    const realPath = fs.realpathSync(lexicalPath);
    if (!isPathInside(realRoot, realPath)) {
      throw new Error(`File artifact "${logicalPath}" escapes artifactRoot.`);
    }
    const byteLength = artifact.byteLength;
    if (
      typeof byteLength !== 'number' ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    ) {
      throw new Error(`${label}.byteLength must be a non-negative integer.`);
    }
    const artifactDigest = assertNonEmptyString(
      artifact.sha256,
      `${label}.sha256`,
    );
    if (!SHA256_PATTERN.test(artifactDigest)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
    }
    const bytes = fs.readFileSync(lexicalPath);
    if (bytes.byteLength !== byteLength || sha256(bytes) !== artifactDigest) {
      throw new Error(
        `Artifact "${logicalPath}" digest does not match final bytes.`,
      );
    }
    return {
      kind,
      logicalPath,
      runtime,
      byteLength,
      sha256: artifactDigest,
    };
  }

  if (!lexicalStat.isSymbolicLink()) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" must remain a symbolic link.`,
    );
  }
  if (
    typeof artifact.linkTarget !== 'string' ||
    artifact.linkTarget.length === 0
  ) {
    throw new Error(`${label}.linkTarget must be a non-empty string.`);
  }
  const linkTarget = fs.readlinkSync(lexicalPath);
  if (linkTarget !== artifact.linkTarget) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" linkTarget does not match final output.`,
    );
  }
  const targetKind =
    artifact.targetKind === 'file' || artifact.targetKind === 'directory'
      ? artifact.targetKind
      : undefined;
  if (!targetKind) {
    throw new Error(`${label}.targetKind must be "file" or "directory".`);
  }
  const targetLogicalPath = normalizeLogicalPath(
    artifact.targetLogicalPath,
    `${label}.targetLogicalPath`,
  );
  let realTarget;
  try {
    realTarget = fs.realpathSync(lexicalPath);
  } catch {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" cannot be resolved.`,
    );
  }
  if (!isPathInside(realRoot, realTarget)) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" resolves outside artifactRoot.`,
    );
  }
  const actualTargetLogicalPath = path
    .relative(realRoot, realTarget)
    .split(path.sep)
    .join('/');
  if (actualTargetLogicalPath !== targetLogicalPath) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" targetLogicalPath does not match final output.`,
    );
  }
  if (
    actualTargetLogicalPath === 'release' ||
    actualTargetLogicalPath.startsWith('release/')
  ) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" targets private release metadata.`,
    );
  }
  const targetStat = fs.statSync(realTarget);
  const actualTargetKind = targetStat.isFile()
    ? 'file'
    : targetStat.isDirectory()
      ? 'directory'
      : undefined;
  if (actualTargetKind !== targetKind) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" targetKind does not match final output.`,
    );
  }
  const realParent = fs.realpathSync(path.dirname(lexicalPath));
  if (!isPathInside(realRoot, realParent)) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" is stored outside artifactRoot.`,
    );
  }
  if (targetKind === 'directory' && isPathInside(realTarget, realParent)) {
    throw new Error(
      `Symbolic-link artifact "${logicalPath}" targets an ancestor directory.`,
    );
  }
  return {
    kind,
    logicalPath,
    runtime,
    linkTarget: artifact.linkTarget,
    targetKind,
    targetLogicalPath,
  };
}

function createTreeSnapshot(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Expected final output directory at ${root}.`);
  }
  const entries = [];
  const visit = (directory, prefix = '') => {
    const names = fs
      .readdirSync(directory)
      .sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const absolutePath = path.join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(absolutePath);
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolutePath);
        const bytes = Buffer.from(target, 'utf8');
        entries.push({
          path: relativePath,
          type: 'symlink',
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
          target,
        });
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(absolutePath);
        entries.push({
          path: relativePath,
          type: 'file',
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        });
      } else {
        throw new Error(
          `Unsupported final output entry type at ${absolutePath}.`,
        );
      }
    }
  };
  visit(root);
  if (entries.length === 0) {
    throw new Error(`Final output directory is empty: ${root}.`);
  }
  return {
    entryCount: entries.length,
    entries,
    treeDigest: digestCanonical(entries),
  };
}

function assertIdentity(value, label = 'envelope.identity') {
  const identity = assertRecord(value, label);
  assertExactKeys(
    identity,
    ['unitId', 'buildMarker', 'sourceRevision', 'releaseVersion'],
    label,
  );
  const sourceRevision = assertNonEmptyString(
    identity.sourceRevision,
    `${label}.sourceRevision`,
  );
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new Error(
      `${label}.sourceRevision must be an exact lowercase Git object ID.`,
    );
  }
  return {
    unitId: assertNonEmptyString(identity.unitId, `${label}.unitId`),
    buildMarker: assertNonEmptyString(
      identity.buildMarker,
      `${label}.buildMarker`,
    ),
    sourceRevision,
    releaseVersion: assertNonEmptyString(
      identity.releaseVersion,
      `${label}.releaseVersion`,
    ),
  };
}

function assertSortedUniquePaths(paths, label) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${label} must contain at least one artifact path.`);
  }
  const normalized = paths.map((item, index) =>
    normalizeLogicalPath(item, `${label}[${index}]`),
  );
  const sorted = [...normalized].sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalSerialize(normalized) !== canonicalSerialize(sorted)) {
    throw new Error(`${label} must be sorted.`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicate paths.`);
  }
  return normalized;
}

function readAndVerifyEnvelope(outputRoot, expectedTarget, options = {}) {
  const envelopePath = path.join(outputRoot, ENVELOPE_RELATIVE_PATH);
  if (!fs.existsSync(envelopePath)) {
    return undefined;
  }
  const envelopeBytes = fs.readFileSync(envelopePath);
  const envelope = assertRecord(
    JSON.parse(envelopeBytes.toString('utf8')),
    'envelope',
  );
  assertExactKeys(
    envelope,
    [
      'schemaVersion',
      'kind',
      'target',
      'identity',
      'artifacts',
      'surfaces',
      'envelopeDigest',
    ],
    'envelope',
  );
  if (envelope.schemaVersion !== 3 || envelope.kind !== ENVELOPE_KIND) {
    throw new Error('Final output has an unsupported release envelope.');
  }
  if (envelope.target !== expectedTarget) {
    throw new Error(
      `Expected ${expectedTarget} release envelope; received ${String(envelope.target)}.`,
    );
  }
  const identity = assertIdentity(envelope.identity);
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length === 0) {
    throw new Error('envelope.artifacts must contain at least one artifact.');
  }
  const artifacts = envelope.artifacts.map((value, index) =>
    readAndVerifyReleaseArtifact(outputRoot, value, index),
  );
  const artifactPaths = artifacts.map(artifact => artifact.logicalPath);
  const sortedArtifactPaths = [...artifactPaths].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    canonicalSerialize(artifactPaths) !==
      canonicalSerialize(sortedArtifactPaths) ||
    new Set(artifactPaths).size !== artifactPaths.length
  ) {
    throw new Error(
      'envelope.artifacts must have unique entries sorted by logicalPath.',
    );
  }

  const surfaces = assertRecord(envelope.surfaces, 'envelope.surfaces');
  assertExactKeys(
    surfaces,
    ['uiClient', 'ssr', 'apiBackend', 'backendFederation'],
    'envelope.surfaces',
  );
  const backendFederation = assertRecord(
    surfaces.backendFederation,
    'envelope.surfaces.backendFederation',
  );
  assertExactKeys(
    backendFederation,
    ['manifest', 'container'],
    'envelope.surfaces.backendFederation',
  );
  const normalizedSurfaces = {
    uiClient: assertSortedUniquePaths(
      surfaces.uiClient,
      'envelope.surfaces.uiClient',
    ),
    ssr: assertSortedUniquePaths(surfaces.ssr, 'envelope.surfaces.ssr'),
    apiBackend: assertSortedUniquePaths(
      surfaces.apiBackend,
      'envelope.surfaces.apiBackend',
    ),
    backendFederation: {
      manifest: normalizeLogicalPath(
        backendFederation.manifest,
        'envelope.surfaces.backendFederation.manifest',
      ),
      container: normalizeLogicalPath(
        backendFederation.container,
        'envelope.surfaces.backendFederation.container',
      ),
    },
  };
  const artifactByPath = new Map(
    artifacts.map(artifact => [artifact.logicalPath, artifact]),
  );
  const surfacePaths = {
    uiClient: normalizedSurfaces.uiClient,
    ssr: normalizedSurfaces.ssr,
    apiBackend: normalizedSurfaces.apiBackend,
    backendFederation: [
      normalizedSurfaces.backendFederation.manifest,
      normalizedSurfaces.backendFederation.container,
    ],
  };
  const surfaceEvidence = {};
  for (const [surfaceName, paths] of Object.entries(surfacePaths)) {
    const surfaceArtifacts = paths.map(logicalPath => {
      const artifact = artifactByPath.get(logicalPath);
      if (!artifact) {
        throw new Error(
          `${surfaceName} references unbound artifact "${logicalPath}".`,
        );
      }
      if (artifact.kind !== 'file') {
        throw new Error(
          `${surfaceName} references symbolic-link artifact "${logicalPath}" instead of a file artifact.`,
        );
      }
      return artifact;
    });
    const compiledArtifacts = surfaceArtifacts.filter(artifact =>
      /\.(?:c|m)?js$/u.test(artifact.logicalPath),
    );
    if (compiledArtifacts.length === 0) {
      throw new Error(
        `${surfaceName} has no compiled release-identity artifact.`,
      );
    }
    const carrierPaths = [];
    for (const artifact of compiledArtifacts) {
      const source = fs.readFileSync(
        resolveContainedPath(
          outputRoot,
          artifact.logicalPath,
          `${surfaceName} identity carrier`,
        ),
        'utf8',
      );
      const identityParts = [
        identity.buildMarker,
        identity.sourceRevision,
        identity.releaseVersion,
      ];
      if (
        options.forbiddenIdentity &&
        [
          options.forbiddenIdentity.buildMarker,
          options.forbiddenIdentity.sourceRevision,
        ]
          .filter(
            part =>
              typeof part === 'string' &&
              part !== identity.buildMarker &&
              part !== identity.sourceRevision,
          )
          .some(part => source.includes(part))
      ) {
        throw new Error(
          `${surfaceName} compiled artifact "${artifact.logicalPath}" retains prior release identity residue.`,
        );
      }
      const presentIdentityParts = identityParts.filter(part =>
        source.includes(part),
      );
      const isNeutralDeploymentLauncher =
        surfaceName === 'ssr' &&
        ((expectedTarget === 'node' && artifact.logicalPath === 'index.js') ||
          (expectedTarget === 'cloudflare' &&
            artifact.logicalPath === 'server/index.mjs'));
      // Modern's final Node index.js and Cloudflare server/index.mjs are
      // generic deployment launchers, not Rspack SSR execution modules. They
      // can legitimately contain the current framework releaseVersion without
      // carrying the per-build marker and revision. The framework envelope
      // verifier makes these same narrow exclusions while requiring every
      // route-referenced and compiled SSR/workerd module to carry identity.
      // Keep hash-binding launchers through the envelope and scanning them for
      // forbidden prior identity above, but do not classify them as carriers.
      if (isNeutralDeploymentLauncher) {
        continue;
      }
      if (presentIdentityParts.length !== identityParts.length) {
        throw new Error(
          `${surfaceName} compiled artifact "${artifact.logicalPath}" does not carry the exact release identity.`,
        );
      }
      carrierPaths.push(artifact.logicalPath);
    }
    if (carrierPaths.length === 0) {
      throw new Error(
        `${surfaceName} has no compiled artifact carrying the exact release identity.`,
      );
    }
    if (surfaceName === 'backendFederation') {
      const manifestSource = fs.readFileSync(
        resolveContainedPath(
          outputRoot,
          normalizedSurfaces.backendFederation.manifest,
          'backendFederation manifest identity',
        ),
        'utf8',
      );
      if (
        ![
          identity.buildMarker,
          identity.sourceRevision,
          identity.releaseVersion,
        ].every(part => manifestSource.includes(part))
      ) {
        throw new Error(
          'backendFederation manifest does not carry the exact release identity.',
        );
      }
    }
    surfaceEvidence[surfaceName] = {
      artifactCount: surfaceArtifacts.length,
      artifacts: surfaceArtifacts,
      carrierPaths,
      compiledArtifactCount: compiledArtifacts.length,
      digest: digestCanonical(surfaceArtifacts),
      identity,
    };
  }

  const payload = {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity,
    artifacts,
    surfaces: normalizedSurfaces,
  };
  const envelopeDigest = assertNonEmptyString(
    envelope.envelopeDigest,
    'envelope.envelopeDigest',
  );
  if (
    !SHA256_PATTERN.test(envelopeDigest) ||
    digestCanonical(payload) !== envelopeDigest
  ) {
    throw new Error(
      'envelope.envelopeDigest does not match the canonical payload.',
    );
  }
  return {
    artifactCount: artifacts.length,
    artifacts,
    envelopeDigest,
    envelopeFile: {
      byteLength: envelopeBytes.byteLength,
      sha256: sha256(envelopeBytes),
    },
    identity,
    surfaces: surfaceEvidence,
    target: expectedTarget,
  };
}

function captureAppOutput(workspace, app, target, forbiddenIdentity) {
  const outputRoot = path.join(workspace, app.path, '.output');
  const tree = createTreeSnapshot(outputRoot);
  const envelope = readAndVerifyEnvelope(outputRoot, target, {
    forbiddenIdentity,
  });
  if (app.kind === 'vertical' && !envelope) {
    throw new Error(
      `Full-stack MicroVertical ${app.id} is missing ${ENVELOPE_RELATIVE_PATH}.`,
    );
  }
  return {
    app: {
      id: app.id,
      kind: app.kind,
      package: app.package,
      path: app.path,
    },
    artifactRoot: path
      .relative(workspace, outputRoot)
      .split(path.sep)
      .join('/'),
    envelope: envelope ?? { present: false },
    tree,
  };
}

function assertIdentityAtRevision(output, revision, label) {
  if (!output.envelope || output.envelope.present === false) {
    return;
  }
  if (output.envelope.identity.sourceRevision !== revision) {
    throw new Error(
      `${label} sourceRevision must be ${revision}; received ${output.envelope.identity.sourceRevision}.`,
    );
  }
}

function assertByteIdentical(before, after, label) {
  if (
    canonicalSerialize(before.tree.entries) !==
    canonicalSerialize(after.tree.entries)
  ) {
    throw new Error(`${label} final output bytes changed unexpectedly.`);
  }
  const beforeEnvelope = before.envelope;
  const afterEnvelope = after.envelope;
  if (
    (beforeEnvelope.present === false) !==
    (afterEnvelope.present === false)
  ) {
    throw new Error(`${label} release-envelope presence changed unexpectedly.`);
  }
  if (
    beforeEnvelope.present !== false &&
    (beforeEnvelope.envelopeFile.sha256 !== afterEnvelope.envelopeFile.sha256 ||
      beforeEnvelope.envelopeDigest !== afterEnvelope.envelopeDigest)
  ) {
    throw new Error(`${label} release envelope changed unexpectedly.`);
  }
  return {
    byteIdentical: true,
    envelopeIdentical: true,
    treeDigest: before.tree.treeDigest,
    ...(beforeEnvelope.present === false
      ? {}
      : { envelopeDigest: beforeEnvelope.envelopeDigest }),
  };
}

function assertChangedVerticalRotated(before, after, revisions, label) {
  const beforeEnvelope = before.envelope;
  const afterEnvelope = after.envelope;
  if (beforeEnvelope.present === false || afterEnvelope.present === false) {
    throw new Error(`${label} must have release envelopes in both builds.`);
  }
  if (before.tree.treeDigest === after.tree.treeDigest) {
    throw new Error(`${label} final output did not change.`);
  }
  if (
    beforeEnvelope.identity.sourceRevision !== revisions.baseline ||
    afterEnvelope.identity.sourceRevision !== revisions.changed
  ) {
    throw new Error(`${label} did not move exactly from C0 to C1.`);
  }
  if (
    beforeEnvelope.identity.buildMarker === afterEnvelope.identity.buildMarker
  ) {
    throw new Error(`${label} buildMarker did not rotate.`);
  }
  for (const field of ['unitId', 'releaseVersion']) {
    if (beforeEnvelope.identity[field] !== afterEnvelope.identity[field]) {
      throw new Error(`${label} identity.${field} changed unexpectedly.`);
    }
  }
  const surfaces = {};
  for (const surfaceName of SURFACE_NAMES) {
    const beforeSurface = beforeEnvelope.surfaces[surfaceName];
    const afterSurface = afterEnvelope.surfaces[surfaceName];
    if (beforeSurface.digest === afterSurface.digest) {
      throw new Error(`${label} ${surfaceName} surface did not rotate.`);
    }
    if (
      canonicalSerialize(afterSurface.identity) !==
      canonicalSerialize(afterEnvelope.identity)
    ) {
      throw new Error(
        `${label} ${surfaceName} has mixed release identity evidence.`,
      );
    }
    surfaces[surfaceName] = {
      changed: true,
      beforeDigest: beforeSurface.digest,
      afterDigest: afterSurface.digest,
      carrierPaths: afterSurface.carrierPaths,
    };
  }
  return {
    changed: true,
    beforeTreeDigest: before.tree.treeDigest,
    afterTreeDigest: after.tree.treeDigest,
    beforeIdentity: beforeEnvelope.identity,
    afterIdentity: afterEnvelope.identity,
    surfaces,
  };
}

function compareTargetSnapshots({
  target,
  baseline,
  changed,
  apps,
  revisions,
}) {
  for (const app of Object.values(apps)) {
    assertIdentityAtRevision(
      baseline[app.id],
      revisions.baseline,
      `${target} C0 ${app.id}`,
    );
  }
  assertIdentityAtRevision(
    changed[apps.changed.id],
    revisions.changed,
    `${target} C1 ${apps.changed.id}`,
  );
  return {
    target,
    changed: assertChangedVerticalRotated(
      baseline[apps.changed.id],
      changed[apps.changed.id],
      revisions,
      `${target} ${apps.changed.id}`,
    ),
    shell: assertByteIdentical(
      baseline[apps.shell.id],
      changed[apps.shell.id],
      `${target} ${apps.shell.id}`,
    ),
    sibling: assertByteIdentical(
      baseline[apps.sibling.id],
      changed[apps.sibling.id],
      `${target} ${apps.sibling.id}`,
    ),
  };
}

function assertCrossTargetIdentity(nodeChanged, cloudflareChanged) {
  const nodeIdentity = nodeChanged.envelope.identity;
  const cloudflareIdentity = cloudflareChanged.envelope.identity;
  if (
    canonicalSerialize(nodeIdentity) !== canonicalSerialize(cloudflareIdentity)
  ) {
    throw new Error(
      'Changed MicroVertical Node and Cloudflare identities do not match.',
    );
  }
  return {
    equal: true,
    identity: nodeIdentity,
    nodeEnvelopeDigest: nodeChanged.envelope.envelopeDigest,
    cloudflareEnvelopeDigest: cloudflareChanged.envelope.envelopeDigest,
  };
}

function visibleHtmlText(html) {
  return html
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function assertRuntimeMarker(marker, identity, label) {
  const runtimeMarker = assertRecord(marker, `${label} API marker`);
  const expectedFields = {
    build: identity.buildMarker,
    buildMarker: identity.buildMarker,
    sourceRevision: identity.sourceRevision,
    unitId: identity.unitId,
    version: identity.releaseVersion,
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (runtimeMarker[field] !== expected) {
      throw new Error(
        `${label} API marker ${field} does not match the C1 release identity.`,
      );
    }
  }
  return expectedFields;
}

async function verifyServedBehavior({
  app,
  baseUrl,
  expectedApiValue,
  expectedUiValue,
  fetchImpl = fetch,
  identity,
  platform,
  uiBaseUrl,
}) {
  const label = `${platform} ${app.id} C1`;
  const api = assertRecord(app.api, `${label} API contract`);
  const apiPrefix = assertNonEmptyString(api.prefix, `${label} API prefix`);
  const apiStem = assertNonEmptyString(api.stem, `${label} API stem`);
  const ssrRoute = '/en';
  const uiRoute = '/en';
  const apiRoute = `${apiPrefix.replace(/\/$/u, '')}/${apiStem}`;
  const boundaryId = assertNonEmptyString(
    app.moduleFederation?.name,
    `${label} Module Federation name`,
  );

  const [ssr, ui, apiResponse] = await Promise.all([
    fetchText(joinUrl(baseUrl, ssrRoute), fetchImpl),
    fetchText(joinUrl(uiBaseUrl, uiRoute), fetchImpl),
    fetchText(joinUrl(baseUrl, apiRoute), fetchImpl),
  ]);
  for (const [surface, response] of Object.entries({
    api: apiResponse,
    ssr,
    ui,
  })) {
    if (!response.ok) {
      throw new Error(
        `${label} ${surface} returned HTTP ${response.status} from the executed C1 deployment.`,
      );
    }
  }

  const uiMarker = extractUiMarker(ssr.body);
  if (uiMarker !== identity.buildMarker) {
    throw new Error(
      `${label} SSR UI marker does not match the C1 release identity.`,
    );
  }
  if (
    !ui.body.includes(`data-modern-boundary-id="${boundaryId}"`) ||
    !ui.body.includes(`data-modern-mf-expose="${WIDGET_EXPOSE}"`)
  ) {
    throw new Error(
      `${label} shell did not SSR the native federated ${WIDGET_EXPOSE} boundary.`,
    );
  }
  const renderedText = visibleHtmlText(ui.body);
  if (!renderedText.includes(expectedUiValue)) {
    throw new Error(
      `${label} did not visibly render the exact expected C1 UI value.`,
    );
  }

  const apiBody = parseMaybeJson(apiResponse.body);
  const firstItem = apiBody?.items?.[0];
  if (firstItem?.title !== expectedApiValue) {
    throw new Error(`${label} did not serve the exact expected C1 API value.`);
  }
  const marker = assertRuntimeMarker(firstItem.marker, identity, label);

  return {
    platform,
    appId: app.id,
    baseUrls: {
      app: baseUrl,
      shell: uiBaseUrl,
    },
    routes: {
      api: apiRoute,
      ssr: ssrRoute,
      ui: uiRoute,
    },
    responses: {
      api: {
        bodySha256: sha256(Buffer.from(apiResponse.body, 'utf8')),
        contentType: apiResponse.contentType,
        status: apiResponse.status,
        value: firstItem.title,
      },
      ssr: {
        bodySha256: sha256(Buffer.from(ssr.body, 'utf8')),
        buildMarker: uiMarker,
        contentType: ssr.contentType,
        status: ssr.status,
      },
      ui: {
        bodySha256: sha256(Buffer.from(ui.body, 'utf8')),
        boundaryId,
        contentType: ui.contentType,
        expose: WIDGET_EXPOSE,
        status: ui.status,
        value: expectedUiValue,
        visiblyRendered: true,
      },
    },
    identity: marker,
    result: 'pass',
  };
}

function operationalSourceRevisions(
  contract,
  { baselineRevision, changedAppId, changedRevision },
) {
  return Object.fromEntries(
    contract.apps.map(app => [
      app.id,
      app.id === changedAppId ? changedRevision : baselineRevision,
    ]),
  );
}

function smokeTargets(
  workspace,
  { baselineRevision, changedAppId, changedRevision, platform },
) {
  const { contract: sourceContract } = readSmokeContract(workspace);
  const contract = bindContractToExpectedReleaseIdentities({
    contract: sourceContract,
    expectedSourceRevisions: operationalSourceRevisions(sourceContract, {
      baselineRevision,
      changedAppId,
      changedRevision,
    }),
    platform,
    projectDir: workspace,
  });
  const { targets } = createSmokeTargets(contract, { mode: 'local' });
  return targets;
}

function requiredSmokeTarget(targets, appId) {
  const target = targets.find(candidate => candidate.app.id === appId);
  if (!target) {
    throw new Error(`Browser-smoke contract is missing app ${appId}.`);
  }
  return target;
}

async function startNodeTargetsInDependencyOrder({
  artifactDir,
  fetchImpl = fetch,
  processEnv,
  projectDir,
  servers,
  startServerImpl = startServer,
  startup,
  timeoutMs = 60_000,
  waitForTargetImpl = waitForTarget,
}) {
  const startAndWait = async (targets, requireManifest) => {
    for (const target of targets) {
      const server = startServerImpl(target, {
        artifactDir,
        processEnv,
        projectDir,
      });
      const record = { server, target };
      servers.push(record);
      await waitForTargetImpl(target, {
        fetchImpl,
        requireManifest,
        serverExit: server.exited,
        serverLogPath: server.logPath,
        timeoutMs,
      });
    }
  };

  for (const layer of startup.remoteLayers) {
    await startAndWait(layer, true);
  }
  await startAndWait(startup.shells, false);
}

async function runNodeServedBehavior({
  apps,
  artifactDir,
  baselineRevision,
  changedRevision,
  expectedApiValue,
  expectedUiValue,
  identity,
  processEnv,
  workspace,
}) {
  const targets = smokeTargets(workspace, {
    baselineRevision,
    changedAppId: apps.changed.id,
    changedRevision,
    platform: 'node',
  });
  const changedTarget = requiredSmokeTarget(targets, apps.changed.id);
  requiredSmokeTarget(targets, apps.sibling.id);
  const shellTarget = requiredSmokeTarget(targets, apps.shell.id);
  const startup = orderTargetsForLocalStartup(targets);
  await assertLocalPortsAvailable(startup.validation);
  const servers = [];
  let result;
  let failure;
  try {
    await startNodeTargetsInDependencyOrder({
      artifactDir,
      processEnv,
      projectDir: workspace,
      servers,
      startup,
    });
    result = await verifyServedBehavior({
      app: changedTarget.app,
      baseUrl: changedTarget.baseUrl,
      expectedApiValue,
      expectedUiValue,
      identity,
      platform: 'node',
      uiBaseUrl: shellTarget.baseUrl,
    });
  } catch (error) {
    failure = error;
  }
  const stopResults = await Promise.allSettled(
    servers.reverse().map(({ server }) => server.stop()),
  );
  const stopFailures = stopResults.flatMap(stopResult =>
    stopResult.status === 'rejected' ? [stopResult.reason] : [],
  );
  if (stopFailures.length > 0) {
    failure = failure
      ? new AggregateError(
          [failure, ...stopFailures],
          'Node behavior proof and server cleanup both failed.',
        )
      : new AggregateError(
          stopFailures,
          'Failed to stop Node operational-independence servers.',
        );
  }
  if (failure) {
    throw failure;
  }
  return result;
}

function servedBehaviorAppIds(apps) {
  const appId = apps?.changed?.id;
  const shellId = apps?.shell?.id;
  if (
    typeof appId !== 'string' ||
    appId.length === 0 ||
    typeof shellId !== 'string' ||
    shellId.length === 0 ||
    appId === shellId
  ) {
    throw new Error(
      'Served-behavior proof requires distinct changed-MicroVertical and shell app ids.',
    );
  }
  return { appId, shellId };
}

async function runWorkerdServedBehavior({
  apps,
  artifactDir,
  baselineRevision,
  changedRevision,
  expectedApiValue,
  expectedUiValue,
  identity,
  processEnv,
  workspace,
}) {
  const { appId, shellId } = servedBehaviorAppIds(apps);
  const targets = smokeTargets(workspace, {
    baselineRevision,
    changedAppId: apps.changed.id,
    changedRevision,
    platform: 'workerd',
  });
  const target = requiredSmokeTarget(targets, appId);
  const server = await startWorkerdProof({
    artifactDir,
    processEnv,
    projectDir: workspace,
    requireTargetUrls: true,
    timeoutMs: 60_000,
  });
  let result;
  let failure;
  try {
    const baseUrl = server.targetUrls?.[appId];
    const uiBaseUrl = server.targetUrls?.[shellId];
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new Error(
        `Generated workerd proof did not publish a target URL for ${appId}.`,
      );
    }
    if (typeof uiBaseUrl !== 'string' || uiBaseUrl.length === 0) {
      throw new Error(
        `Generated workerd proof did not publish a target URL for ${shellId}.`,
      );
    }
    const workerdTarget = { ...target, baseUrl };
    await waitForTarget(workerdTarget, {
      fetchImpl: fetch,
      serverExit: server.exited,
      serverLogPath: server.logPath,
      timeoutMs: 60_000,
    });
    result = await verifyServedBehavior({
      app: target.app,
      baseUrl,
      expectedApiValue,
      expectedUiValue,
      identity,
      platform: 'workerd',
      uiBaseUrl,
    });
  } catch (error) {
    failure = error;
  }
  try {
    await server.stop();
  } catch (stopError) {
    failure = failure
      ? new AggregateError(
          [failure, stopError],
          'Workerd behavior proof and server cleanup both failed.',
        )
      : stopError;
  }
  if (failure) {
    throw failure;
  }
  return result;
}

function assertChangedPathsOwnedBy(changedPaths, appPath) {
  const normalizedOwner = normalizeLogicalPath(appPath, 'changed app path');
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error('C1 must change at least one tracked file.');
  }
  const unexpected = changedPaths.filter(changedPath => {
    const normalized = normalizeLogicalPath(changedPath, 'changed Git path');
    return (
      normalized !== normalizedOwner &&
      !normalized.startsWith(`${normalizedOwner}/`)
    );
  });
  if (unexpected.length > 0) {
    throw new Error(
      `C1 changes files outside ${normalizedOwner}: ${unexpected.join(', ')}`,
    );
  }
  return [...changedPaths];
}

function createBuildCommand(packageName, target) {
  if (target !== 'node' && target !== 'cloudflare') {
    throw new Error(`Unsupported build target: ${String(target)}.`);
  }
  return {
    command: 'pnpm',
    args: [
      '--filter',
      assertNonEmptyString(packageName, 'package name'),
      'run',
      target === 'node' ? 'build' : 'cloudflare:build',
    ],
  };
}

function createWorkspaceBuildCommand(target) {
  if (target !== 'node' && target !== 'cloudflare') {
    throw new Error(`Unsupported build target: ${String(target)}.`);
  }
  return {
    command: 'pnpm',
    args: ['run', target === 'node' ? 'build' : 'cloudflare:build'],
  };
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    env: options.env ?? process.env,
    stdio: options.capture ? 'pipe' : ['ignore', 2, 2],
  });
  if (result.error) {
    throw result.error;
  }
  const allowedExitCodes = options.allowedExitCodes ?? [0];
  if (!allowedExitCodes.includes(result.status)) {
    const detail = options.capture
      ? `\n${String(result.stderr || result.stdout).trim()}`
      : '';
    throw new Error(
      `Command failed (${String(result.status)}): ${[command, ...args].join(' ')}${detail}`,
    );
  }
  return {
    exitCode: result.status,
    stdout: options.capture ? result.stdout.trim() : '',
  };
}

function createOperationalProcessEnv(packageManagerEnv = {}) {
  const env = { ...process.env, ...packageManagerEnv };
  delete env.ULTRAMODERN_SOURCE_REVISION;
  delete env.MODERNJS_DEPLOY;
  return env;
}

function git(workspace, args, options = {}) {
  return runProcess('git', args, {
    cwd: workspace,
    capture: true,
    env: options.env,
    allowedExitCodes: options.allowedExitCodes,
  });
}

function assertCleanGitWorkspace(workspace, expectedHead, label, env) {
  const head = git(workspace, ['rev-parse', 'HEAD'], { env }).stdout;
  if (head !== expectedHead) {
    throw new Error(`${label} HEAD must be ${expectedHead}; received ${head}.`);
  }
  const status = git(
    workspace,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { env },
  ).stdout;
  if (status !== '') {
    throw new Error(`${label} Git workspace is dirty:\n${status}`);
  }
}

function readTopologyApps(workspace, ids) {
  const configPath = path.join(workspace, '.modernjs', 'ultramodern.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const topologyApps = config?.topology?.apps;
  if (!Array.isArray(topologyApps)) {
    throw new Error(
      '.modernjs/ultramodern.json topology.apps must be an array.',
    );
  }
  const resolve = (id, expectedKind) => {
    const app = topologyApps.find(candidate => candidate?.id === id);
    if (!app) {
      throw new Error(`Missing generated topology app "${id}".`);
    }
    if (app.kind !== expectedKind) {
      throw new Error(
        `Topology app ${id} must have kind ${expectedKind}; received ${String(app.kind)}.`,
      );
    }
    return {
      id,
      kind: expectedKind,
      package: assertNonEmptyString(app.package, `${id}.package`),
      path: normalizeLogicalPath(app.path, `${id}.path`),
    };
  };
  const apps = {
    shell: resolve(ids.shell, 'shell'),
    changed: resolve(ids.changed, 'vertical'),
    sibling: resolve(ids.sibling, 'vertical'),
  };
  if (new Set(Object.values(apps).map(app => app.id)).size !== 3) {
    throw new Error('Shell, changed, and sibling app IDs must be distinct.');
  }
  return apps;
}

function buildApps({ workspace, apps, target, roles, env, run = runProcess }) {
  const commands = [];
  for (const role of roles) {
    const app = apps[role];
    const build = createBuildCommand(app.package, target);
    run(build.command, build.args, { cwd: workspace, env });
    commands.push({
      appId: app.id,
      package: app.package,
      command: [build.command, ...build.args],
    });
  }
  return commands;
}

function buildWorkspaceBaseline({ workspace, target, env, run = runProcess }) {
  const build = createWorkspaceBuildCommand(target);
  run(build.command, build.args, { cwd: workspace, env });
  return [
    {
      appId: '*',
      package: 'workspace',
      command: [build.command, ...build.args],
    },
  ];
}

function removeOutputs(workspace, apps, roles) {
  for (const role of roles) {
    fs.rmSync(path.join(workspace, apps[role].path, '.output'), {
      recursive: true,
      force: true,
    });
  }
}

function captureApps(workspace, apps, target, forbiddenIdentities = {}) {
  return Object.fromEntries(
    Object.values(apps).map(app => [
      app.id,
      captureAppOutput(workspace, app, target, forbiddenIdentities[app.id]),
    ]),
  );
}

function resolveCommitTransition(workspace, baselineRef, changedRef, env) {
  const baseline = git(
    workspace,
    ['rev-parse', '--verify', `${baselineRef}^{commit}`],
    { env },
  ).stdout;
  const changed = git(
    workspace,
    ['rev-parse', '--verify', `${changedRef}^{commit}`],
    { env },
  ).stdout;
  if (baseline === changed) {
    throw new Error('C0 and C1 must be different commits.');
  }
  const parentLine = git(
    workspace,
    ['rev-list', '--parents', '-n', '1', changed],
    { env },
  ).stdout.split(/\s+/u);
  if (parentLine.length !== 2 || parentLine[1] !== baseline) {
    throw new Error('C1 must be a single-parent commit directly on C0.');
  }
  const changedPaths = git(
    workspace,
    ['diff', '--name-only', '--no-renames', baseline, changed, '--'],
    { env },
  )
    .stdout.split('\n')
    .filter(Boolean);
  return { baseline, changed, changedPaths };
}

function restoreCheckout(workspace, original, env) {
  const currentHead = git(workspace, ['rev-parse', 'HEAD'], { env }).stdout;
  if (original.branch) {
    if (
      currentHead !== original.head ||
      original.branch !==
        git(workspace, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
          allowedExitCodes: [0, 1],
          env,
        }).stdout
    ) {
      git(workspace, ['switch', original.branch], { env });
    }
  } else if (currentHead !== original.head) {
    git(workspace, ['switch', '--detach', original.head], { env });
  }
}

function writeEvidence(outputPath, evidence) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(temporaryPath, outputPath);
}

async function runOperationalIndependence(options) {
  const workspace = fs.realpathSync(path.resolve(options.workspace));
  const processEnv = createOperationalProcessEnv(options.packageManagerEnv);
  const expectedApiValue = assertNonEmptyString(
    options.expectedApiValue,
    'expected C1 API value',
  );
  const expectedUiValue = assertNonEmptyString(
    options.expectedUiValue,
    'expected C1 UI value',
  );
  const ids = {
    shell: options.shellId ?? 'shell-super-app',
    changed: options.changedId ?? 'catalog',
    sibling: options.siblingId ?? 'checkout',
  };
  const apps = readTopologyApps(workspace, ids);
  const transition = resolveCommitTransition(
    workspace,
    options.baselineRef,
    options.changedRef,
    processEnv,
  );
  assertChangedPathsOwnedBy(transition.changedPaths, apps.changed.path);
  const originalBranch = git(
    workspace,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { allowedExitCodes: [0, 1], env: processEnv },
  );
  const original = {
    branch: originalBranch.exitCode === 0 ? originalBranch.stdout : undefined,
    head: git(workspace, ['rev-parse', 'HEAD'], { env: processEnv }).stdout,
  };
  assertCleanGitWorkspace(workspace, original.head, 'Initial', processEnv);

  const targets = {};
  const runtimeArtifactDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-operational-runtime-'),
  );
  let failure;
  try {
    for (const target of ['node', 'cloudflare']) {
      git(workspace, ['switch', '--detach', transition.baseline], {
        env: processEnv,
      });
      assertCleanGitWorkspace(
        workspace,
        transition.baseline,
        `${target} C0`,
        processEnv,
      );
      removeOutputs(workspace, apps, ['shell', 'changed', 'sibling']);
      const baselineCommands = buildWorkspaceBaseline({
        workspace,
        target,
        env: processEnv,
        run: options.run,
      });
      assertCleanGitWorkspace(
        workspace,
        transition.baseline,
        `${target} C0 after build`,
        processEnv,
      );
      const baseline = captureApps(workspace, apps, target);

      git(workspace, ['switch', '--detach', transition.changed], {
        env: processEnv,
      });
      assertCleanGitWorkspace(
        workspace,
        transition.changed,
        `${target} C1`,
        processEnv,
      );
      removeOutputs(workspace, apps, ['changed']);
      const changedCommands = buildApps({
        workspace,
        apps,
        target,
        roles: ['changed'],
        env: processEnv,
        run: options.run,
      });
      assertCleanGitWorkspace(
        workspace,
        transition.changed,
        `${target} C1 after build`,
        processEnv,
      );
      const changed = captureApps(workspace, apps, target, {
        [apps.changed.id]: baseline[apps.changed.id].envelope.identity,
      });
      const comparison = compareTargetSnapshots({
        target,
        baseline,
        changed,
        apps,
        revisions: transition,
      });
      const identity = changed[apps.changed.id].envelope.identity;
      const servedBehavior =
        target === 'node'
          ? await runNodeServedBehavior({
              apps,
              artifactDir: runtimeArtifactDir,
              baselineRevision: transition.baseline,
              changedRevision: transition.changed,
              expectedApiValue,
              expectedUiValue,
              identity,
              processEnv,
              shellId: apps.shell.id,
              workspace,
            })
          : await runWorkerdServedBehavior({
              apps,
              artifactDir: runtimeArtifactDir,
              baselineRevision: transition.baseline,
              changedRevision: transition.changed,
              expectedApiValue,
              expectedUiValue,
              identity,
              processEnv,
              workspace,
            });
      assertCleanGitWorkspace(
        workspace,
        transition.changed,
        `${target} C1 after served-behavior proof`,
        processEnv,
      );
      targets[target] = {
        baselineCommands,
        changedCommands,
        baseline,
        changed,
        comparison,
        servedBehavior,
      };
    }
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(runtimeArtifactDir, { recursive: true, force: true });
    try {
      restoreCheckout(workspace, original, processEnv);
    } catch (restoreError) {
      failure = failure
        ? new AggregateError(
            [failure, restoreError],
            'Proof and checkout restoration both failed.',
          )
        : restoreError;
    }
  }
  if (failure) {
    throw failure;
  }

  const evidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: 'ultramodern-operational-independence-proof',
    workspace,
    commits: {
      baseline: transition.baseline,
      changed: transition.changed,
      changedPaths: transition.changedPaths,
      ownerPath: apps.changed.path,
    },
    apps,
    targets,
    crossTarget: assertCrossTargetIdentity(
      targets.node.changed[apps.changed.id],
      targets.cloudflare.changed[apps.changed.id],
    ),
    result: 'pass',
  };
  evidence.evidenceDigest = digestCanonical(evidence);
  if (options.out) {
    writeEvidence(path.resolve(options.out), evidence);
  }
  return evidence;
}

function parseArgs(argv) {
  const options = {};
  const valueFlags = new Map([
    ['--workspace', 'workspace'],
    ['--baseline-ref', 'baselineRef'],
    ['--changed-ref', 'changedRef'],
    ['--shell-id', 'shellId'],
    ['--changed-id', 'changedId'],
    ['--sibling-id', 'siblingId'],
    ['--expected-api-value', 'expectedApiValue'],
    ['--expected-ui-value', 'expectedUiValue'],
    ['--out', 'out'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const property = valueFlags.get(flag);
    if (!property) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }
    options[property] = value;
    index += 1;
  }
  for (const property of [
    'workspace',
    'baselineRef',
    'changedRef',
    'expectedApiValue',
    'expectedUiValue',
  ]) {
    if (!options[property]) {
      throw new Error(
        `--${property.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)} is required.`,
      );
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const evidence = await runOperationalIndependence(options);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

export {
  assertByteIdentical,
  assertChangedPathsOwnedBy,
  assertChangedVerticalRotated,
  assertCrossTargetIdentity,
  canonicalSerialize,
  compareTargetSnapshots,
  createBuildCommand,
  createOperationalProcessEnv,
  createTreeSnapshot,
  createWorkspaceBuildCommand,
  digestCanonical,
  ENVELOPE_RELATIVE_PATH,
  EVIDENCE_SCHEMA_VERSION,
  operationalSourceRevisions,
  parseArgs,
  readAndVerifyEnvelope,
  readTopologyApps,
  runOperationalIndependence,
  servedBehaviorAppIds,
  sha256,
  startNodeTargetsInDependencyOrder,
  verifyServedBehavior,
  visibleHtmlText,
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `[ultramodern-operational-independence] ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}
