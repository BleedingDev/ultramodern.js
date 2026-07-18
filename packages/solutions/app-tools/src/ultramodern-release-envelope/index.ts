import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalSerializeMicroVerticalReleaseEnvelope,
  digestMicroVerticalReleaseEnvelopePayload,
  releaseEnvelopePayload,
} from './canonical';
import {
  type CreateMicroVerticalReleaseEnvelopeInput,
  MICROVERTICAL_RELEASE_ENVELOPE_KIND,
  MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION,
  MICROVERTICAL_RELEASE_TARGETS,
  type MicroVerticalReleaseArtifact,
  type MicroVerticalReleaseArtifactInput,
  type MicroVerticalReleaseEnvelope,
  type MicroVerticalReleaseEnvelopePayload,
  type MicroVerticalReleaseIdentity,
  type MicroVerticalReleaseSurfaces,
  type MicroVerticalReleaseTarget,
  type VerifyMicroVerticalReleaseEnvelopeOptions,
} from './types';

export type {
  CreateMicroVerticalReleaseEnvelopeInput,
  MicroVerticalReleaseArtifact,
  MicroVerticalReleaseArtifactInput,
  MicroVerticalReleaseArtifactInputs,
  MicroVerticalReleaseEnvelope,
  MicroVerticalReleaseEnvelopePayload,
  MicroVerticalReleaseIdentity,
  MicroVerticalReleaseSurfaces,
  MicroVerticalReleaseTarget,
  VerifyMicroVerticalReleaseEnvelopeOptions,
} from './types';
export {
  canonicalSerializeMicroVerticalReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_KIND,
  MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION,
  MICROVERTICAL_RELEASE_TARGETS,
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const TARGETS = new Set<string>(MICROVERTICAL_RELEASE_TARGETS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (
  value: unknown,
  location: string,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${location} must be an object.`);
  }
  return value;
};

const assertExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  location: string,
) => {
  const expectedKeys = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new Error(`${location} contains unknown field "${key}".`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new Error(`${location}.${key} is required.`);
    }
  }
};

const assertNonEmptyString = (value: unknown, location: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  if (value !== value.trim()) {
    throw new Error(`${location} must not contain surrounding whitespace.`);
  }
  return value;
};

const assertTarget = (
  value: unknown,
  location = 'target',
): MicroVerticalReleaseTarget => {
  const target = assertNonEmptyString(value, location);
  if (!TARGETS.has(target)) {
    throw new Error(
      `${location} must be one of: ${MICROVERTICAL_RELEASE_TARGETS.join(', ')}.`,
    );
  }
  return target as MicroVerticalReleaseTarget;
};

const assertReleaseIdentity = (
  value: unknown,
  location = 'identity',
): MicroVerticalReleaseIdentity => {
  const identity = assertRecord(value, location);
  assertExactKeys(
    identity,
    ['unitId', 'buildMarker', 'sourceRevision', 'releaseVersion'],
    location,
  );
  const sourceRevision = assertNonEmptyString(
    identity.sourceRevision,
    `${location}.sourceRevision`,
  );
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new Error(
      `${location}.sourceRevision must be an exact lowercase 40- or 64-character Git object ID; "${sourceRevision}" is not promotable.`,
    );
  }
  return {
    unitId: assertNonEmptyString(identity.unitId, `${location}.unitId`),
    buildMarker: assertNonEmptyString(
      identity.buildMarker,
      `${location}.buildMarker`,
    ),
    sourceRevision,
    releaseVersion: assertNonEmptyString(
      identity.releaseVersion,
      `${location}.releaseVersion`,
    ),
  };
};

const assertNormalizedLogicalPath = (value: unknown, location: string) => {
  const logicalPath = assertNonEmptyString(value, location);
  if (
    logicalPath.includes('\\') ||
    path.posix.isAbsolute(logicalPath) ||
    path.posix.normalize(logicalPath) !== logicalPath ||
    logicalPath === '.' ||
    logicalPath.split('/').some(segment => segment === '..' || segment === '.')
  ) {
    throw new Error(`${location} must be a normalized relative POSIX path.`);
  }
  return logicalPath;
};

const isPathInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const resolveArtifactPath = async (
  artifactRoot: string,
  logicalPath: string,
) => {
  const lexicalPath = path.resolve(artifactRoot, ...logicalPath.split('/'));
  if (!isPathInside(artifactRoot, lexicalPath)) {
    throw new Error(
      `Artifact logicalPath "${logicalPath}" resolves outside artifactRoot.`,
    );
  }
  let realPath: string;
  try {
    realPath = await fs.realpath(lexicalPath);
  } catch {
    throw new Error(`Artifact "${logicalPath}" does not exist.`);
  }
  const realRoot = await fs.realpath(artifactRoot);
  if (!isPathInside(realRoot, realPath)) {
    throw new Error(
      `Artifact logicalPath "${logicalPath}" resolves outside artifactRoot.`,
    );
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error(`Artifact "${logicalPath}" must resolve to a file.`);
  }
  return realPath;
};

const assertArtifactInput = (
  value: unknown,
  location: string,
): MicroVerticalReleaseArtifactInput => {
  const artifact = assertRecord(value, location);
  assertExactKeys(artifact, ['logicalPath', 'runtime'], location);
  return {
    logicalPath: assertNormalizedLogicalPath(
      artifact.logicalPath,
      `${location}.logicalPath`,
    ),
    runtime: assertNonEmptyString(artifact.runtime, `${location}.runtime`),
  };
};

const readFinalArtifact = async (
  artifactRoot: string,
  input: MicroVerticalReleaseArtifactInput,
  resolvedLogicalPath = input.logicalPath,
): Promise<MicroVerticalReleaseArtifact> => {
  const logicalPath = assertNormalizedLogicalPath(
    resolvedLogicalPath,
    `staged path for ${input.logicalPath}`,
  );
  const filePath = await resolveArtifactPath(artifactRoot, logicalPath);
  const bytes = await fs.readFile(filePath);
  return {
    ...input,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

const assertReleaseArtifact = (
  value: unknown,
  location: string,
): MicroVerticalReleaseArtifact => {
  const artifact = assertRecord(value, location);
  assertExactKeys(
    artifact,
    ['logicalPath', 'runtime', 'byteLength', 'sha256'],
    location,
  );
  const byteLength = artifact.byteLength;
  if (
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new Error(`${location}.byteLength must be a non-negative integer.`);
  }
  const sha256 = assertNonEmptyString(artifact.sha256, `${location}.sha256`);
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${location}.sha256 must be a lowercase SHA-256 digest.`);
  }
  return {
    ...assertArtifactInput(
      {
        logicalPath: artifact.logicalPath,
        runtime: artifact.runtime,
      },
      location,
    ),
    byteLength,
    sha256,
  };
};

const assertUniqueSortedArtifacts = (
  artifacts: readonly { logicalPath: string }[],
  location: string,
) => {
  const paths = artifacts.map(artifact => artifact.logicalPath);
  const unique = new Set(paths);
  if (unique.size !== paths.length) {
    const duplicate = paths.find(
      (logicalPath, index) => paths.indexOf(logicalPath) !== index,
    );
    throw new Error(`Duplicate artifact logicalPath "${duplicate}".`);
  }
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (paths.some((logicalPath, index) => logicalPath !== sorted[index])) {
    throw new Error(`${location} must be sorted by logicalPath.`);
  }
};

const assertSurfacePaths = (value: unknown, location: string): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${location} must contain at least one artifact path.`);
  }
  const paths = value.map((item, index) =>
    assertNormalizedLogicalPath(item, `${location}[${index}]`),
  );
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (paths.some((logicalPath, index) => logicalPath !== sorted[index])) {
    throw new Error(`${location} must be sorted by logicalPath.`);
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${location} must not contain duplicate artifact paths.`);
  }
  return paths;
};

const assertSurfaces = (value: unknown): MicroVerticalReleaseSurfaces => {
  const surfaces = assertRecord(value, 'surfaces');
  assertExactKeys(
    surfaces,
    ['uiClient', 'ssr', 'apiBackend', 'backendFederation'],
    'surfaces',
  );
  const backendFederation = assertRecord(
    surfaces.backendFederation,
    'surfaces.backendFederation',
  );
  assertExactKeys(
    backendFederation,
    ['manifest', 'container'],
    'surfaces.backendFederation',
  );
  return {
    uiClient: assertSurfacePaths(surfaces.uiClient, 'surfaces.uiClient'),
    ssr: assertSurfacePaths(surfaces.ssr, 'surfaces.ssr'),
    apiBackend: assertSurfacePaths(surfaces.apiBackend, 'surfaces.apiBackend'),
    backendFederation: {
      manifest: assertNormalizedLogicalPath(
        backendFederation.manifest,
        'surfaces.backendFederation.manifest',
      ),
      container: assertNormalizedLogicalPath(
        backendFederation.container,
        'surfaces.backendFederation.container',
      ),
    },
  };
};

const assertSurfaceReferences = (
  artifacts: readonly MicroVerticalReleaseArtifactInput[],
  surfaces: MicroVerticalReleaseSurfaces,
) => {
  const artifactPaths = new Set(
    artifacts.map(artifact => artifact.logicalPath),
  );
  for (const [surface, paths] of Object.entries({
    uiClient: surfaces.uiClient,
    ssr: surfaces.ssr,
    apiBackend: surfaces.apiBackend,
    'backendFederation.manifest': [surfaces.backendFederation.manifest],
    'backendFederation.container': [surfaces.backendFederation.container],
  })) {
    for (const logicalPath of paths) {
      if (!artifactPaths.has(logicalPath)) {
        throw new Error(
          `surfaces.${surface} references unbound artifact "${logicalPath}".`,
        );
      }
    }
  }
};

const assertTargetSurfaceContract = (
  target: MicroVerticalReleaseTarget,
  artifacts: readonly MicroVerticalReleaseArtifactInput[],
  surfaces: MicroVerticalReleaseSurfaces,
) => {
  const byPath = new Map(
    artifacts.map(artifact => [artifact.logicalPath, artifact]),
  );
  const assertRuntime = (
    paths: readonly string[],
    expected: string,
    surface: string,
  ) => {
    for (const logicalPath of paths) {
      const runtime = byPath.get(logicalPath)?.runtime;
      if (runtime !== expected) {
        throw new Error(
          `${target} ${surface} artifact "${logicalPath}" must use runtime "${expected}"; received "${String(runtime)}".`,
        );
      }
    }
  };

  assertRuntime(surfaces.uiClient, 'browser', 'UI/client');
  assertRuntime(surfaces.ssr, target === 'node' ? 'nodejs' : 'workerd', 'SSR');
  assertRuntime(
    surfaces.apiBackend,
    target === 'node' ? 'nodejs' : 'workerd-effect',
    'API/backend',
  );
  assertRuntime(
    [surfaces.backendFederation.manifest],
    'module-federation-manifest',
    'backend federation manifest',
  );
  assertRuntime(
    [surfaces.backendFederation.container],
    target === 'node' ? 'nodejs' : 'commonjs-module',
    'backend federation container',
  );
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
};

const assertEnvelope = (value: unknown): MicroVerticalReleaseEnvelope => {
  const envelope = assertRecord(value, 'envelope');
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
  if (
    envelope.schemaVersion !== MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION
  ) {
    throw new Error(
      `envelope.schemaVersion must be ${MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION}.`,
    );
  }
  if (envelope.kind !== MICROVERTICAL_RELEASE_ENVELOPE_KIND) {
    throw new Error(
      `envelope.kind must be "${MICROVERTICAL_RELEASE_ENVELOPE_KIND}".`,
    );
  }
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length === 0) {
    throw new Error('envelope.artifacts must contain at least one artifact.');
  }
  const artifacts = envelope.artifacts.map((artifact, index) =>
    assertReleaseArtifact(artifact, `envelope.artifacts[${index}]`),
  );
  assertUniqueSortedArtifacts(artifacts, 'envelope.artifacts');
  const target = assertTarget(envelope.target, 'envelope.target');
  const surfaces = assertSurfaces(envelope.surfaces);
  assertSurfaceReferences(artifacts, surfaces);
  assertTargetSurfaceContract(target, artifacts, surfaces);
  const parsed: MicroVerticalReleaseEnvelope = {
    schemaVersion: MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION,
    kind: MICROVERTICAL_RELEASE_ENVELOPE_KIND,
    target,
    identity: assertReleaseIdentity(envelope.identity, 'envelope.identity'),
    artifacts,
    surfaces,
    envelopeDigest: assertNonEmptyString(
      envelope.envelopeDigest,
      'envelope.envelopeDigest',
    ),
  };
  if (!SHA256_PATTERN.test(parsed.envelopeDigest)) {
    throw new Error(
      'envelope.envelopeDigest must be a lowercase SHA-256 digest.',
    );
  }
  const expectedDigest = digestMicroVerticalReleaseEnvelopePayload(
    releaseEnvelopePayload(parsed),
  );
  if (parsed.envelopeDigest !== expectedDigest) {
    throw new Error(
      'envelope.envelopeDigest does not match canonical payload.',
    );
  }
  return parsed;
};

export const createMicroVerticalReleaseEnvelope = async (
  input: CreateMicroVerticalReleaseEnvelopeInput,
): Promise<MicroVerticalReleaseEnvelope> => {
  const artifactRoot = await fs.realpath(path.resolve(input.artifactRoot));
  const target = assertTarget(input.target);
  const identity = assertReleaseIdentity(input.identity);
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new Error('artifacts must contain at least one artifact.');
  }
  const inputs = input.artifacts.map((artifact, index) =>
    assertArtifactInput(artifact, `artifacts[${index}]`),
  );
  const sortedInputs = [...inputs].sort((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );
  assertUniqueSortedArtifacts(sortedInputs, 'artifacts');
  const surfaces = assertSurfaces(input.surfaces);
  assertSurfaceReferences(sortedInputs, surfaces);
  assertTargetSurfaceContract(target, sortedInputs, surfaces);
  const artifacts = await Promise.all(
    sortedInputs.map(artifact => readFinalArtifact(artifactRoot, artifact)),
  );
  const payload: MicroVerticalReleaseEnvelopePayload = {
    schemaVersion: MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION,
    kind: MICROVERTICAL_RELEASE_ENVELOPE_KIND,
    target,
    identity,
    artifacts,
    surfaces,
  };
  return deepFreeze({
    ...payload,
    envelopeDigest: digestMicroVerticalReleaseEnvelopePayload(payload),
  });
};

export const verifyMicroVerticalReleaseEnvelope = async (
  value: unknown,
  options: VerifyMicroVerticalReleaseEnvelopeOptions,
): Promise<MicroVerticalReleaseEnvelope> => {
  const envelope = assertEnvelope(value);
  if (
    options.expectedTarget !== undefined &&
    envelope.target !== options.expectedTarget
  ) {
    throw new Error(
      `envelope.target must be "${options.expectedTarget}" for this staging target; received "${envelope.target}".`,
    );
  }
  const artifactRoot = await fs.realpath(path.resolve(options.artifactRoot));
  for (const artifact of envelope.artifacts) {
    const finalArtifact = await readFinalArtifact(
      artifactRoot,
      artifact,
      options.logicalPathForArtifact?.(artifact) ?? artifact.logicalPath,
    );
    if (
      finalArtifact.byteLength !== artifact.byteLength ||
      finalArtifact.sha256 !== artifact.sha256
    ) {
      throw new Error(
        `Artifact "${artifact.logicalPath}" digest does not match final artifact bytes.`,
      );
    }
  }
  return deepFreeze(envelope);
};
