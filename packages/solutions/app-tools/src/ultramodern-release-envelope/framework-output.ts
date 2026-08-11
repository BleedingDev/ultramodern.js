import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
  isUltramodernBuildArtifact,
  ULTRAMODERN_BUILD_ARTIFACT_FILE,
  type UltramodernBuildArtifact,
} from '@modern-js/utils/universal';
import {
  canonicalSerializeMicroVerticalReleaseEnvelope,
  createMicroVerticalReleaseEnvelope,
  verifyMicroVerticalReleaseEnvelope,
} from './index';
import type {
  MicroVerticalReleaseArtifact,
  MicroVerticalReleaseArtifactInput,
  MicroVerticalReleaseEnvelope,
  MicroVerticalReleaseIdentity,
  MicroVerticalReleaseSurfaces,
  MicroVerticalReleaseTarget,
} from './types';

export const MICROVERTICAL_RELEASE_ENVELOPE_PATH =
  'release/microvertical-release-envelope.json';
export const MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH =
  'release/microvertical-release-identity-carriers.json';

const MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_KIND =
  'ultramodern-release-identity-carriers';
const MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_SCHEMA_VERSION = 1;

const COMPILED_MODULE_PATTERN = /\.(?:c|m)?js$/u;
const EFFECT_BFF_WORKER_PATTERN = /^worker\/__modern_bff_effect\.(?:c|m)?js$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const flattenStrings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(flattenStrings)
      : [];

const collectNestedStrings = (value: unknown, key: string): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(item => collectNestedStrings(item, key));
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([entryKey, entryValue]) => [
    ...(entryKey === key ? flattenStrings(entryValue) : []),
    ...collectNestedStrings(entryValue, key),
  ]);
};

const manifestReferencedClientModules = async (
  distDirectory: string,
  files: string[],
  manifestLogicalPath = 'mf-manifest.json',
) => {
  const manifest = await readJson(
    path.join(distDirectory, manifestLogicalPath),
  );
  const references = [
    ...collectNestedStrings(manifest, 'path'),
    ...collectNestedStrings(manifest, 'name'),
    ...collectNestedStrings(manifest, 'sync'),
    ...collectNestedStrings(manifest, 'async'),
  ];
  const normalizedReferences = new Set(
    references
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.replace(/^https?:\/\/[^/]+/u, ''))
      .map(value => value.replace(/^\/+/u, '')),
  );
  return files.filter(
    logicalPath =>
      COMPILED_MODULE_PATTERN.test(logicalPath) &&
      [...normalizedReferences].some(
        reference =>
          reference === logicalPath ||
          reference.endsWith(`/${logicalPath}`) ||
          logicalPath.endsWith(`/${reference}`),
      ),
  );
};

const routeReferencedSsrModules = async (
  distDirectory: string,
  files: string[],
  target: MicroVerticalReleaseTarget,
  routeSpecLogicalPath = 'route.json',
) => {
  const routeSpec = await readJson(
    path.join(distDirectory, routeSpecLogicalPath),
  );
  const field = target === 'node' ? 'bundle' : 'worker';
  const references = collectNestedStrings(routeSpec, field).map(value =>
    value.replace(/^\/+/u, ''),
  );
  return files.filter(
    logicalPath =>
      COMPILED_MODULE_PATTERN.test(logicalPath) &&
      references.includes(logicalPath),
  );
};

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;

const isFilesystemPathInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const isMissingPathError = (error: unknown) =>
  isRecord(error) && error.code === 'ENOENT';

const resolveSafeReleaseEnvelopePath = async ({
  artifactRoot,
  createDirectory,
}: {
  artifactRoot: string;
  createDirectory: boolean;
}): Promise<string | undefined> => {
  const resolvedRoot = path.resolve(artifactRoot);
  const realRoot = await fs.realpath(resolvedRoot);
  const releaseDirectory = path.join(resolvedRoot, 'release');
  let releaseStat;
  try {
    releaseStat = await fs.lstat(releaseDirectory);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    if (!createDirectory) {
      return undefined;
    }
    await fs.mkdir(releaseDirectory);
    releaseStat = await fs.lstat(releaseDirectory);
  }
  if (releaseStat.isSymbolicLink() || !releaseStat.isDirectory()) {
    throw new Error(
      '[ultramodern-release-envelope] release must be a real directory inside artifactRoot, not a symlink or file.',
    );
  }
  const realReleaseDirectory = await fs.realpath(releaseDirectory);
  if (!isFilesystemPathInside(realRoot, realReleaseDirectory)) {
    throw new Error(
      '[ultramodern-release-envelope] release directory resolves outside artifactRoot.',
    );
  }

  const envelopePath = path.join(
    releaseDirectory,
    path.basename(MICROVERTICAL_RELEASE_ENVELOPE_PATH),
  );
  try {
    const envelopeStat = await fs.lstat(envelopePath);
    if (envelopeStat.isSymbolicLink() || !envelopeStat.isFile()) {
      throw new Error(
        '[ultramodern-release-envelope] release envelope must be a real file inside artifactRoot, not a symlink or directory.',
      );
    }
    const realEnvelopePath = await fs.realpath(envelopePath);
    if (!isFilesystemPathInside(realRoot, realEnvelopePath)) {
      throw new Error(
        '[ultramodern-release-envelope] release envelope resolves outside artifactRoot.',
      );
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    if (!createDirectory) {
      return undefined;
    }
  }
  return envelopePath;
};

const writeReleaseEnvelope = async (
  artifactRoot: string,
  envelope: MicroVerticalReleaseEnvelope,
) => {
  const envelopePath = await resolveSafeReleaseEnvelopePath({
    artifactRoot,
    createDirectory: true,
  });
  if (!envelopePath) {
    throw new Error(
      '[ultramodern-release-envelope] could not resolve release envelope path.',
    );
  }
  await fs.writeFile(
    envelopePath,
    `${canonicalSerializeMicroVerticalReleaseEnvelope(envelope)}\n`,
  );
};

const readBuildArtifact = async (
  distDirectory: string,
): Promise<UltramodernBuildArtifact> => {
  const artifactPath = path.join(
    distDirectory,
    ULTRAMODERN_BUILD_ARTIFACT_FILE,
  );
  const artifact = await readJson(artifactPath);
  if (!isUltramodernBuildArtifact(artifact)) {
    throw new Error(
      `[ultramodern-release-envelope] ${ULTRAMODERN_BUILD_ARTIFACT_FILE} is missing or invalid.`,
    );
  }
  if (artifact.deliveryUnit.sourceRevision === 'workspace') {
    throw new Error(
      '[ultramodern-release-envelope] sourceRevision "workspace" cannot produce a promotable full-stack envelope.',
    );
  }
  return artifact;
};

const assertIdentityBlock = (
  value: unknown,
  identity: MicroVerticalReleaseIdentity,
  location: string,
  includeReleaseVersion: boolean,
) => {
  if (!isRecord(value)) {
    throw new Error(
      `[ultramodern-release-envelope] ${location} is missing delivery identity.`,
    );
  }
  const expected = {
    unitId: identity.unitId,
    buildMarker: identity.buildMarker,
    sourceRevision: identity.sourceRevision,
    ...(includeReleaseVersion
      ? { version: identity.releaseVersion }
      : undefined),
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw new Error(
        `[ultramodern-release-envelope] ${location}.${field} must match ${expectedValue}; received ${String(value[field])}.`,
      );
    }
  }
};

const readBackendManifest = async (
  distDirectory: string,
  identity: MicroVerticalReleaseIdentity,
) => {
  const manifest = await readJson(
    path.join(distDirectory, BACKEND_FEDERATION_MANIFEST_FILE),
  );
  if (!isRecord(manifest) || !isRecord(manifest.backendFederation)) {
    throw new Error(
      '[ultramodern-release-envelope] backend federation manifest is missing backendFederation metadata.',
    );
  }
  assertIdentityBlock(
    manifest.backendFederation.deliveryUnit,
    identity,
    'backendFederation.deliveryUnit',
    true,
  );
  const versionBoundary = manifest.backendFederation.versionBoundary;
  assertIdentityBlock(
    isRecord(versionBoundary) ? versionBoundary.deliveryUnit : undefined,
    identity,
    'backendFederation.versionBoundary.deliveryUnit',
    false,
  );
};

const collectFiles = async (root: string): Promise<string[]> => {
  const resolvedRoot = path.resolve(root);
  const realRoot = await fs.realpath(resolvedRoot);

  const collectDirectory = async (
    relativeDirectory: string,
  ): Promise<string[]> => {
    const directory = path.join(
      resolvedRoot,
      ...relativeDirectory.split('/').filter(Boolean),
    );
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const logicalPath = path.posix.join(relativeDirectory, entry.name);
      if (logicalPath === 'release' || logicalPath.startsWith('release/')) {
        continue;
      }
      if (entry.isDirectory()) {
        files.push(...(await collectDirectory(logicalPath)));
        continue;
      }
      if (entry.isFile()) {
        files.push(logicalPath);
        continue;
      }
      if (!entry.isSymbolicLink()) {
        continue;
      }

      const lexicalPath = path.join(resolvedRoot, ...logicalPath.split('/'));
      let realPath: string;
      try {
        realPath = await fs.realpath(lexicalPath);
      } catch {
        throw new Error(
          `[ultramodern-release-envelope] symbolic link ${logicalPath} cannot be resolved.`,
        );
      }
      if (!isFilesystemPathInside(realRoot, realPath)) {
        throw new Error(
          `[ultramodern-release-envelope] symbolic link ${logicalPath} resolves outside artifactRoot.`,
        );
      }
      const targetStat = await fs.stat(realPath);
      if (!targetStat.isFile() && !targetStat.isDirectory()) {
        throw new Error(
          `[ultramodern-release-envelope] symbolic link ${logicalPath} must resolve to a file or directory.`,
        );
      }
      const targetLogicalPath = path
        .relative(realRoot, realPath)
        .split(path.sep)
        .join('/');
      if (
        targetLogicalPath === 'release' ||
        targetLogicalPath.startsWith('release/')
      ) {
        throw new Error(
          `[ultramodern-release-envelope] symbolic link ${logicalPath} targets private release metadata.`,
        );
      }
      if (
        targetStat.isDirectory() &&
        isFilesystemPathInside(
          realPath,
          await fs.realpath(path.dirname(lexicalPath)),
        )
      ) {
        throw new Error(
          `[ultramodern-release-envelope] symbolic link ${logicalPath} targets an ancestor directory.`,
        );
      }
      files.push(logicalPath);
    }
    return files;
  };

  return (await collectDirectory('')).sort();
};

const releaseArtifact = (
  logicalPath: string,
  runtime: string,
): MicroVerticalReleaseArtifactInput => ({
  logicalPath,
  runtime,
});

type ReleaseIdentityCarrierSurface =
  | 'apiBackend'
  | 'backendFederation'
  | 'ssr'
  | 'uiClient';

type ReleaseIdentityCarrierPaths = Record<
  ReleaseIdentityCarrierSurface,
  string[]
>;

const writeReleaseIdentityCarrierMetadata = async (
  artifactRoot: string,
  identity: MicroVerticalReleaseIdentity,
  carrierPaths: ReleaseIdentityCarrierPaths,
) => {
  const surfacesByPath = new Map<string, Set<ReleaseIdentityCarrierSurface>>();
  for (const [surface, logicalPaths] of Object.entries(carrierPaths) as [
    ReleaseIdentityCarrierSurface,
    string[],
  ][]) {
    if (logicalPaths.length === 0) {
      throw new Error(
        `[ultramodern-release-envelope] ${surface} has no declared release-identity carrier artifact.`,
      );
    }
    for (const logicalPath of logicalPaths) {
      const surfaces = surfacesByPath.get(logicalPath) ?? new Set();
      surfaces.add(surface);
      surfacesByPath.set(logicalPath, surfaces);
    }
  }

  const carriers = await Promise.all(
    [...surfacesByPath]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([logicalPath, surfaces]) => {
        const bytes = await fs.readFile(path.join(artifactRoot, logicalPath));
        return {
          logicalPath,
          byteLength: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          surfaces: [...surfaces].sort((left, right) =>
            left.localeCompare(right),
          ),
        };
      }),
  );
  const releaseEnvelopePath = await resolveSafeReleaseEnvelopePath({
    artifactRoot,
    createDirectory: true,
  });
  if (!releaseEnvelopePath) {
    throw new Error(
      '[ultramodern-release-envelope] could not resolve private release metadata directory.',
    );
  }
  const metadataPath = path.join(
    path.dirname(releaseEnvelopePath),
    path.basename(MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH),
  );
  try {
    const metadataStat = await fs.lstat(metadataPath);
    if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) {
      throw new Error(
        '[ultramodern-release-envelope] release identity carrier metadata must be a real file inside artifactRoot.',
      );
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_SCHEMA_VERSION,
        kind: MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_KIND,
        identity,
        carriers,
      },
      null,
      2,
    )}\n`,
  );
  return releaseArtifact(
    MICROVERTICAL_RELEASE_IDENTITY_CARRIERS_PATH,
    'release-identity-metadata',
  );
};

const createReleaseArtifactInputs = async (
  distDirectory: string,
  identity: MicroVerticalReleaseIdentity,
  target: MicroVerticalReleaseTarget,
) => {
  const files = await collectFiles(distDirectory);
  if (
    target === 'node' &&
    files.some(logicalPath => EFFECT_BFF_WORKER_PATTERN.test(logicalPath))
  ) {
    throw new Error(
      '[ultramodern-release-envelope] Node target conflicts with a Cloudflare Effect API/BFF worker artifact; resolve the canonical deploy target instead of emitting a Node envelope for Cloudflare output.',
    );
  }
  const uiClientPaths = files.filter(logicalPath => {
    const topLevel = logicalPath.split('/')[0];
    return (
      topLevel === 'static' ||
      topLevel === 'html' ||
      topLevel === 'public' ||
      [
        'index.html',
        'mf-manifest.json',
        'mf-stats.json',
        'remoteEntry.js',
        'routes-manifest.json',
        'loadable-stats.json',
      ].includes(logicalPath)
    );
  });
  const ssrPaths =
    target === 'node'
      ? files.filter(
          logicalPath =>
            logicalPath.startsWith('bundles/') &&
            COMPILED_MODULE_PATTERN.test(logicalPath),
        )
      : files.filter(
          logicalPath =>
            logicalPath.startsWith('worker/') &&
            COMPILED_MODULE_PATTERN.test(logicalPath) &&
            !EFFECT_BFF_WORKER_PATTERN.test(logicalPath),
        );
  const nodeApiEntryPaths = files.filter(
    logicalPath =>
      logicalPath.startsWith('api/') &&
      COMPILED_MODULE_PATTERN.test(logicalPath),
  );
  const apiBackendPaths =
    target === 'node'
      ? files.filter(
          logicalPath =>
            (logicalPath.startsWith('api/') ||
              logicalPath.startsWith('shared/')) &&
            COMPILED_MODULE_PATTERN.test(logicalPath),
        )
      : files.filter(logicalPath =>
          EFFECT_BFF_WORKER_PATTERN.test(logicalPath),
        );

  if (uiClientPaths.length === 0) {
    throw new Error(
      `[ultramodern-release-envelope] ${target} full-stack MicroVertical has no UI/client artifacts.`,
    );
  }
  if (ssrPaths.length === 0) {
    throw new Error(
      `[ultramodern-release-envelope] ${target} full-stack MicroVertical has no ${target === 'node' ? 'Node' : 'workerd'} SSR artifacts.`,
    );
  }
  if (
    (target === 'node' && nodeApiEntryPaths.length === 0) ||
    apiBackendPaths.length === 0
  ) {
    throw new Error(
      `[ultramodern-release-envelope] ${target} full-stack MicroVertical has no actual ${target === 'node' ? 'compiled Node Effect API artifact' : 'Effect API/BFF worker artifact'}.`,
    );
  }

  const clientExecutionPaths = await manifestReferencedClientModules(
    distDirectory,
    files,
  );
  if (clientExecutionPaths.length === 0) {
    throw new Error(
      '[ultramodern-release-envelope] UI/client manifest references no compiled execution module.',
    );
  }
  const ssrExecutionPaths = await routeReferencedSsrModules(
    distDirectory,
    files,
    target,
  );
  if (ssrExecutionPaths.length === 0) {
    throw new Error(
      `[ultramodern-release-envelope] route manifest references no emitted ${target === 'node' ? 'Node' : 'Cloudflare'} SSR execution module.`,
    );
  }

  const runtimeByPath = new Map<string, string>();
  const add = (paths: string[], runtime: string) => {
    for (const logicalPath of paths) {
      const existing = runtimeByPath.get(logicalPath);
      if (existing && existing !== runtime) {
        throw new Error(
          `[ultramodern-release-envelope] artifact "${logicalPath}" cannot carry conflicting runtimes "${existing}" and "${runtime}".`,
        );
      }
      runtimeByPath.set(logicalPath, runtime);
    }
  };
  add(uiClientPaths, 'browser');
  add(ssrPaths, target === 'node' ? 'nodejs' : 'workerd');
  add(apiBackendPaths, target === 'node' ? 'nodejs' : 'workerd-effect');
  add([BACKEND_FEDERATION_MANIFEST_FILE], 'module-federation-manifest');
  add(
    [BACKEND_FEDERATION_REMOTE_ENTRY_FILE],
    target === 'node' ? 'nodejs' : 'commonjs-module',
  );

  const surfaces: MicroVerticalReleaseSurfaces = {
    uiClient: [...uiClientPaths].sort((left, right) =>
      left.localeCompare(right),
    ),
    ssr: [...ssrPaths].sort((left, right) => left.localeCompare(right)),
    apiBackend: [...apiBackendPaths].sort((left, right) =>
      left.localeCompare(right),
    ),
    backendFederation: {
      manifest: BACKEND_FEDERATION_MANIFEST_FILE,
      container: BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
    },
  };
  const artifacts = [...runtimeByPath]
    .map(([logicalPath, runtime]) => releaseArtifact(logicalPath, runtime))
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  const identityCarrierMetadata = await writeReleaseIdentityCarrierMetadata(
    distDirectory,
    identity,
    {
      apiBackend: apiBackendPaths,
      backendFederation: [
        BACKEND_FEDERATION_MANIFEST_FILE,
        BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
      ],
      ssr: [...new Set([...ssrExecutionPaths, ...ssrPaths])],
      uiClient: uiClientPaths.filter(logicalPath =>
        COMPILED_MODULE_PATTERN.test(logicalPath),
      ),
    },
  );
  return {
    artifacts: [...artifacts, identityCarrierMetadata].sort((left, right) =>
      left.logicalPath.localeCompare(right.logicalPath),
    ),
    surfaces,
  };
};

const pathExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const emitFrameworkMicroVerticalReleaseEnvelope = async ({
  apiOnly,
  distDirectory,
  target,
}: {
  apiOnly: boolean;
  distDirectory: string;
  target: MicroVerticalReleaseTarget;
}): Promise<MicroVerticalReleaseEnvelope | undefined> => {
  if (apiOnly) {
    return undefined;
  }
  const backendManifestPath = path.join(
    distDirectory,
    BACKEND_FEDERATION_MANIFEST_FILE,
  );
  const backendContainerPath = path.join(
    distDirectory,
    BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
  );
  const [hasBackendManifest, hasBackendContainer] = await Promise.all([
    pathExists(backendManifestPath),
    pathExists(backendContainerPath),
  ]);
  if (!hasBackendManifest && !hasBackendContainer) {
    return undefined;
  }
  if (!hasBackendManifest || !hasBackendContainer) {
    throw new Error(
      '[ultramodern-release-envelope] full-stack MicroVertical backend federation manifest and container must be emitted together.',
    );
  }

  const buildArtifact = await readBuildArtifact(distDirectory);
  const identity = {
    unitId: buildArtifact.deliveryUnit.unitId,
    buildMarker: buildArtifact.deliveryUnit.buildMarker,
    sourceRevision: buildArtifact.deliveryUnit.sourceRevision,
    releaseVersion: buildArtifact.deliveryUnit.version,
  };
  await readBackendManifest(distDirectory, identity);
  const { artifacts, surfaces } = await createReleaseArtifactInputs(
    distDirectory,
    identity,
    target,
  );
  const envelope = await createMicroVerticalReleaseEnvelope({
    artifactRoot: distDirectory,
    target,
    identity,
    artifacts,
    surfaces,
  });
  await writeReleaseEnvelope(distDirectory, envelope);
  return envelope;
};

export const readFrameworkMicroVerticalReleaseEnvelope = async ({
  artifactRoot,
  expectedTarget,
  logicalPathForArtifact,
  required = false,
}: {
  artifactRoot: string;
  expectedTarget?: MicroVerticalReleaseTarget;
  logicalPathForArtifact?: (artifact: MicroVerticalReleaseArtifact) => string;
  required?: boolean;
}): Promise<MicroVerticalReleaseEnvelope | undefined> => {
  const envelopePath = await resolveSafeReleaseEnvelopePath({
    artifactRoot,
    createDirectory: false,
  });
  if (!envelopePath) {
    if (required) {
      throw new Error(
        `[ultramodern-release-envelope] required envelope is missing at ${MICROVERTICAL_RELEASE_ENVELOPE_PATH}.`,
      );
    }
    return undefined;
  }
  return verifyMicroVerticalReleaseEnvelope(await readJson(envelopePath), {
    artifactRoot,
    ...(expectedTarget ? { expectedTarget } : {}),
    ...(logicalPathForArtifact ? { logicalPathForArtifact } : {}),
  });
};

export const verifyBuildOutputReleaseEnvelope = async (
  distDirectory: string,
  expectedTarget?: MicroVerticalReleaseTarget,
) => {
  const [hasEnvelope, hasBuildArtifact, hasBackendManifest, hasBackendEntry] =
    await Promise.all([
      pathExists(path.join(distDirectory, MICROVERTICAL_RELEASE_ENVELOPE_PATH)),
      pathExists(path.join(distDirectory, ULTRAMODERN_BUILD_ARTIFACT_FILE)),
      pathExists(path.join(distDirectory, BACKEND_FEDERATION_MANIFEST_FILE)),
      pathExists(
        path.join(distDirectory, BACKEND_FEDERATION_REMOTE_ENTRY_FILE),
      ),
    ]);
  const isFullStackMicroVertical =
    hasBuildArtifact && (hasBackendManifest || hasBackendEntry);
  return readFrameworkMicroVerticalReleaseEnvelope({
    artifactRoot: distDirectory,
    ...(expectedTarget ? { expectedTarget } : {}),
    required: hasEnvelope || isFullStackMicroVertical,
  });
};

export const verifyNodeReleaseEnvelopeStaging = async ({
  outputDirectory,
}: {
  distDirectory?: string;
  outputDirectory: string;
}) =>
  readFrameworkMicroVerticalReleaseEnvelope({
    artifactRoot: outputDirectory,
    expectedTarget: 'node',
    required: true,
  });

const createNodeStagedReleaseArtifactInputs = async (
  outputDirectory: string,
  identity: MicroVerticalReleaseIdentity,
) => {
  const files = await collectFiles(outputDirectory);
  for (const requiredPath of [
    'index.js',
    'package.json',
    BACKEND_FEDERATION_MANIFEST_FILE,
    BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
  ]) {
    if (!files.includes(requiredPath)) {
      throw new Error(
        `[ultramodern-release-envelope] final Node staging is missing ${requiredPath}.`,
      );
    }
  }

  const backendFederationPaths = new Set([
    BACKEND_FEDERATION_MANIFEST_FILE,
    BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
  ]);
  const uiClientPaths = files.filter(logicalPath => {
    const topLevel = logicalPath.split('/')[0];
    return (
      topLevel === 'static' ||
      topLevel === 'html' ||
      topLevel === 'public' ||
      [
        'index.html',
        'mf-manifest.json',
        'mf-stats.json',
        'remoteEntry.js',
        'routes-manifest.json',
        'loadable-stats.json',
      ].includes(logicalPath)
    );
  });
  const ssrPaths = files.filter(
    logicalPath =>
      logicalPath === 'index.js' ||
      (logicalPath.startsWith('bundles/') &&
        COMPILED_MODULE_PATTERN.test(logicalPath)),
  );
  const apiBackendPaths = files.filter(
    logicalPath =>
      (logicalPath.startsWith('api/') || logicalPath.startsWith('shared/')) &&
      COMPILED_MODULE_PATTERN.test(logicalPath),
  );
  for (const [surface, paths] of [
    ['UI/client', uiClientPaths],
    ['Node SSR', ssrPaths],
    ['Node API/backend', apiBackendPaths],
  ] as const) {
    if (paths.length === 0) {
      throw new Error(
        `[ultramodern-release-envelope] final Node staging has no ${surface} artifacts.`,
      );
    }
  }
  const clientExecutionPaths = await manifestReferencedClientModules(
    outputDirectory,
    files,
  );
  const ssrExecutionPaths = await routeReferencedSsrModules(
    outputDirectory,
    files,
    'node',
  );
  if (clientExecutionPaths.length === 0 || ssrExecutionPaths.length === 0) {
    throw new Error(
      '[ultramodern-release-envelope] final Node manifests must reference emitted UI/client and SSR execution modules.',
    );
  }

  const runtimeByPath = new Map(
    files
      .filter(logicalPath => !backendFederationPaths.has(logicalPath))
      .map(logicalPath => [logicalPath, 'nodejs-deployment']),
  );
  for (const logicalPath of uiClientPaths) {
    runtimeByPath.set(logicalPath, 'browser');
  }
  for (const logicalPath of ssrPaths) {
    runtimeByPath.set(logicalPath, 'nodejs');
  }
  for (const logicalPath of apiBackendPaths) {
    runtimeByPath.set(logicalPath, 'nodejs');
  }
  runtimeByPath.set(
    BACKEND_FEDERATION_MANIFEST_FILE,
    'module-federation-manifest',
  );
  runtimeByPath.set(BACKEND_FEDERATION_REMOTE_ENTRY_FILE, 'nodejs');

  const identityCarrierMetadata = await writeReleaseIdentityCarrierMetadata(
    outputDirectory,
    identity,
    {
      apiBackend: apiBackendPaths,
      backendFederation: [
        BACKEND_FEDERATION_MANIFEST_FILE,
        BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
      ],
      ssr: [
        ...new Set([
          ...ssrExecutionPaths,
          ...ssrPaths.filter(logicalPath => logicalPath !== 'index.js'),
        ]),
      ],
      uiClient: uiClientPaths.filter(logicalPath =>
        COMPILED_MODULE_PATTERN.test(logicalPath),
      ),
    },
  );
  return {
    artifacts: [
      ...[...runtimeByPath].map(([logicalPath, runtime]) =>
        releaseArtifact(logicalPath, runtime),
      ),
      identityCarrierMetadata,
    ].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)),
    surfaces: {
      uiClient: [...uiClientPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      ssr: [...ssrPaths].sort((left, right) => left.localeCompare(right)),
      apiBackend: [...apiBackendPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      backendFederation: {
        manifest: BACKEND_FEDERATION_MANIFEST_FILE,
        container: BACKEND_FEDERATION_REMOTE_ENTRY_FILE,
      },
    },
  };
};

export const emitNodeStagedReleaseEnvelope = async ({
  distDirectory,
  outputDirectory,
}: {
  distDirectory: string;
  outputDirectory: string;
}) => {
  const source = await verifyBuildOutputReleaseEnvelope(distDirectory, 'node');
  if (!source) {
    return undefined;
  }
  const { artifacts, surfaces } = await createNodeStagedReleaseArtifactInputs(
    outputDirectory,
    source.identity,
  );
  const staged = await createMicroVerticalReleaseEnvelope({
    artifactRoot: outputDirectory,
    target: 'node',
    identity: source.identity,
    artifacts,
    surfaces,
  });
  await writeReleaseEnvelope(outputDirectory, staged);
  return staged;
};

export const stageCloudflareReleaseEnvelope = async ({
  distDirectory,
  outputDirectory,
}: {
  distDirectory: string;
  outputDirectory: string;
}) => {
  const source = await verifyBuildOutputReleaseEnvelope(
    distDirectory,
    'cloudflare',
  );
  if (!source) {
    return undefined;
  }
  const stagedEnvelopePath = path.join(
    outputDirectory,
    MICROVERTICAL_RELEASE_ENVELOPE_PATH,
  );
  if (await pathExists(stagedEnvelopePath)) {
    throw new Error(
      '[ultramodern-release-envelope] Cloudflare staging contains a stale envelope before final output generation.',
    );
  }
  return source;
};

const createCloudflareStagedReleaseArtifactInputs = async (
  outputDirectory: string,
  identity: MicroVerticalReleaseIdentity,
) => {
  const files = await collectFiles(outputDirectory);
  for (const requiredPath of [
    'server/index.mjs',
    'server/modern-worker-manifest.json',
    'wrangler.json',
    'package.json',
    'worker/package.json',
  ]) {
    if (!files.includes(requiredPath)) {
      throw new Error(
        `[ultramodern-release-envelope] final Cloudflare staging is missing ${requiredPath}.`,
      );
    }
  }
  if (
    files.some(
      logicalPath =>
        logicalPath === 'public/release' ||
        logicalPath.startsWith('public/release/'),
    )
  ) {
    throw new Error(
      '[ultramodern-release-envelope] final Cloudflare envelope must remain private and cannot be staged under public/release.',
    );
  }
  const backendManifestPath = `public/${BACKEND_FEDERATION_MANIFEST_FILE}`;
  const backendContainerPath = `public/${BACKEND_FEDERATION_REMOTE_ENTRY_FILE}`;
  const apiBackendPaths = files.filter(logicalPath =>
    EFFECT_BFF_WORKER_PATTERN.test(logicalPath),
  );
  const ssrPaths = files.filter(
    logicalPath =>
      (logicalPath.startsWith('server/') ||
        logicalPath.startsWith('worker/')) &&
      COMPILED_MODULE_PATTERN.test(logicalPath) &&
      !EFFECT_BFF_WORKER_PATTERN.test(logicalPath),
  );
  const uiClientPaths = files.filter(
    logicalPath =>
      logicalPath.startsWith('public/') &&
      logicalPath !== backendManifestPath &&
      logicalPath !== backendContainerPath,
  );
  for (const [surface, paths] of [
    ['UI/client', uiClientPaths],
    ['Cloudflare SSR', ssrPaths],
    ['Cloudflare API/backend', apiBackendPaths],
  ] as const) {
    if (paths.length === 0) {
      throw new Error(
        `[ultramodern-release-envelope] final Cloudflare staging has no ${surface} artifacts.`,
      );
    }
  }
  for (const logicalPath of [backendManifestPath, backendContainerPath]) {
    if (!files.includes(logicalPath)) {
      throw new Error(
        `[ultramodern-release-envelope] final Cloudflare staging is missing ${logicalPath}.`,
      );
    }
  }

  const clientExecutionPaths = await manifestReferencedClientModules(
    outputDirectory,
    files,
    'public/mf-manifest.json',
  );
  const ssrExecutionPaths = await routeReferencedSsrModules(
    outputDirectory,
    files,
    'cloudflare',
    'server/route.json',
  );
  if (clientExecutionPaths.length === 0 || ssrExecutionPaths.length === 0) {
    throw new Error(
      '[ultramodern-release-envelope] final Cloudflare manifests must reference emitted UI/client and SSR execution modules.',
    );
  }

  const runtimeByPath = new Map<string, string>();
  for (const logicalPath of files) {
    runtimeByPath.set(logicalPath, 'cloudflare-deployment');
  }
  const add = (paths: string[], runtime: string) => {
    for (const logicalPath of paths) {
      runtimeByPath.set(logicalPath, runtime);
    }
  };
  add(uiClientPaths, 'browser');
  add(ssrPaths, 'workerd');
  add(apiBackendPaths, 'workerd-effect');
  add([backendManifestPath], 'module-federation-manifest');
  add([backendContainerPath], 'commonjs-module');

  const identityCarrierMetadata = await writeReleaseIdentityCarrierMetadata(
    outputDirectory,
    identity,
    {
      apiBackend: apiBackendPaths,
      backendFederation: [backendManifestPath, backendContainerPath],
      ssr: [
        ...new Set([
          ...ssrExecutionPaths,
          ...ssrPaths.filter(logicalPath => logicalPath.startsWith('worker/')),
        ]),
      ],
      uiClient: uiClientPaths.filter(logicalPath =>
        COMPILED_MODULE_PATTERN.test(logicalPath),
      ),
    },
  );
  return {
    artifacts: [
      ...[...runtimeByPath].map(([logicalPath, runtime]) =>
        releaseArtifact(logicalPath, runtime),
      ),
      identityCarrierMetadata,
    ].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath)),
    surfaces: {
      uiClient: [...uiClientPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      ssr: [...ssrPaths].sort((left, right) => left.localeCompare(right)),
      apiBackend: [...apiBackendPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      backendFederation: {
        manifest: backendManifestPath,
        container: backendContainerPath,
      },
    },
  };
};

export const emitCloudflareStagedReleaseEnvelope = async ({
  distDirectory,
  outputDirectory,
}: {
  distDirectory: string;
  outputDirectory: string;
}) => {
  const source = await verifyBuildOutputReleaseEnvelope(
    distDirectory,
    'cloudflare',
  );
  if (!source) {
    return undefined;
  }
  const { artifacts, surfaces } =
    await createCloudflareStagedReleaseArtifactInputs(
      outputDirectory,
      source.identity,
    );
  const staged = await createMicroVerticalReleaseEnvelope({
    artifactRoot: outputDirectory,
    target: 'cloudflare',
    identity: source.identity,
    artifacts,
    surfaces,
  });
  await writeReleaseEnvelope(outputDirectory, staged);
  return staged;
};

export const verifyCloudflareReleaseEnvelopeStaging = async (
  outputDirectory: string,
) =>
  readFrameworkMicroVerticalReleaseEnvelope({
    artifactRoot: outputDirectory,
    expectedTarget: 'cloudflare',
    required: true,
  });
