import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dimensions = [
  'ssr',
  'browser-mf',
  'api',
  'backend',
  'backend-driven-ui',
  'failure-isolation',
  'release-identity',
];
const dependencyBlocks = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} has invalid fields`);
  }
}

function assertNonEmptyString(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function assertLogicalPath(value, label) {
  const logicalPath = assertNonEmptyString(value, label);
  if (
    logicalPath.includes('\\') ||
    path.posix.isAbsolute(logicalPath) ||
    path.posix.normalize(logicalPath) !== logicalPath ||
    logicalPath.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a normalized relative POSIX path`);
  }
  return logicalPath;
}

function assertSortedUniquePaths(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const paths = value.map((item, index) =>
    assertLogicalPath(item, `${label}[${index}]`),
  );
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (
    new Set(paths).size !== paths.length ||
    paths.some((item, index) => item !== sorted[index])
  ) {
    throw new Error(`${label} must contain sorted unique paths`);
  }
  return paths;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function exactVersion(specifier) {
  const alias = /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(?<version>.+)$/u.exec(specifier);
  return alias?.groups?.version ?? specifier;
}

function readModuleFederationCohort(projectDir, app) {
  const packageJson = readAppPackageJson(projectDir, app);
  const versions = new Map();
  for (const blockName of dependencyBlocks) {
    for (const [packageName, specifier] of Object.entries(
      packageJson[blockName] ?? {},
    )) {
      if (packageName === '@module-federation/runtime') {
        versions.set(packageName, exactVersion(specifier));
      }
    }
  }
  const cohort = [...versions]
    .map(([packageName, version]) => ({ packageName, version }))
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
  if (cohort.length !== 1) {
    throw new Error(
      `${app.id} must declare one exact @module-federation/runtime version`,
    );
  }
  return cohort;
}

function readAppPackageJson(projectDir, app) {
  return JSON.parse(
    fs.readFileSync(path.join(projectDir, app.path, 'package.json'), 'utf8'),
  );
}

function envelopeLocation(projectDir, app, platform) {
  const appRoot = path.join(projectDir, app.path);
  const expectedTarget = platform === 'workerd' ? 'cloudflare' : 'node';
  const location = { root: path.join(appRoot, '.output'), staged: true };
  const envelopePath = path.join(
    location.root,
    'release/microvertical-release-envelope.json',
  );
  if (!fs.existsSync(envelopePath)) {
    throw new Error(
      `${app.id} is missing target-specific ${expectedTarget} release envelope in executed artifact root`,
    );
  }
  const realRoot = fs.realpathSync(location.root);
  const realEnvelopePath = fs.realpathSync(envelopePath);
  if (
    !isInside(realRoot, realEnvelopePath) ||
    !fs.statSync(realEnvelopePath).isFile()
  ) {
    throw new Error(`${app.id} release envelope escapes target root`);
  }
  const envelope = JSON.parse(fs.readFileSync(realEnvelopePath, 'utf8'));
  if (envelope.target !== expectedTarget) {
    throw new Error(
      `${app.id} executed artifact root contains ${String(envelope.target)} release envelope instead of ${expectedTarget}`,
    );
  }
  return {
    ...location,
    envelope,
    envelopePath: realEnvelopePath,
  };
}

function artifactPath(location, logicalPath) {
  return path.join(location.root, logicalPath);
}

function verifyEnvelope(location, appId) {
  const { envelope } = location;
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
    `${appId} release envelope`,
  );
  if (
    envelope.schemaVersion !== 2 ||
    envelope.kind !== 'ultramodern-target-microvertical-release-envelope'
  ) {
    throw new Error(`${appId} has an invalid release envelope schema`);
  }
  assertExactKeys(
    envelope.identity,
    ['unitId', 'buildMarker', 'sourceRevision', 'releaseVersion'],
    `${appId} release identity`,
  );
  for (const field of [
    'unitId',
    'buildMarker',
    'sourceRevision',
    'releaseVersion',
  ]) {
    assertNonEmptyString(
      envelope.identity[field],
      `${appId} release identity.${field}`,
    );
  }
  if (envelope.identity.sourceRevision === 'workspace') {
    throw new Error(`${appId} release identity is not promotable`);
  }
  if (!/^[a-f\d]{64}$/u.test(envelope.envelopeDigest)) {
    throw new Error(`${appId} release envelope digest is invalid`);
  }
  const { envelopeDigest, ...payload } = envelope;
  if (sha256(canonical(payload)) !== envelopeDigest) {
    throw new Error(`${appId} release envelope digest mismatch`);
  }
  if (!Array.isArray(envelope.artifacts) || envelope.artifacts.length === 0) {
    throw new Error(`${appId} release envelope has no artifacts`);
  }
  const artifacts = envelope.artifacts.map((artifact, index) => {
    assertExactKeys(
      artifact,
      ['logicalPath', 'runtime', 'byteLength', 'sha256'],
      `${appId} artifacts[${index}]`,
    );
    const logicalPath = assertLogicalPath(
      artifact.logicalPath,
      `${appId} artifacts[${index}].logicalPath`,
    );
    assertNonEmptyString(
      artifact.runtime,
      `${appId} artifacts[${index}].runtime`,
    );
    if (
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 0 ||
      !/^[a-f\d]{64}$/u.test(artifact.sha256)
    ) {
      throw new Error(`${appId} artifact metadata is invalid`);
    }
    return { ...artifact, logicalPath };
  });
  const artifactLogicalPaths = artifacts.map(artifact => artifact.logicalPath);
  const sortedArtifactPaths = [...artifactLogicalPaths].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    new Set(artifactLogicalPaths).size !== artifactLogicalPaths.length ||
    artifactLogicalPaths.some(
      (logicalPath, index) => logicalPath !== sortedArtifactPaths[index],
    )
  ) {
    throw new Error(`${appId} release artifacts must be sorted and unique`);
  }

  assertExactKeys(
    envelope.surfaces,
    ['uiClient', 'ssr', 'apiBackend', 'backendFederation'],
    `${appId} release surfaces`,
  );
  assertExactKeys(
    envelope.surfaces.backendFederation,
    ['manifest', 'container'],
    `${appId} backend federation surfaces`,
  );
  const surfaces = {
    uiClient: assertSortedUniquePaths(
      envelope.surfaces.uiClient,
      `${appId} surfaces.uiClient`,
    ),
    ssr: assertSortedUniquePaths(
      envelope.surfaces.ssr,
      `${appId} surfaces.ssr`,
    ),
    apiBackend: assertSortedUniquePaths(
      envelope.surfaces.apiBackend,
      `${appId} surfaces.apiBackend`,
    ),
    backendManifest: assertLogicalPath(
      envelope.surfaces.backendFederation.manifest,
      `${appId} surfaces.backendFederation.manifest`,
    ),
    backendContainer: assertLogicalPath(
      envelope.surfaces.backendFederation.container,
      `${appId} surfaces.backendFederation.container`,
    ),
  };
  const artifactByPath = new Map(
    artifacts.map(artifact => [artifact.logicalPath, artifact]),
  );
  const expectedRuntimes = {
    uiClient: 'browser',
    ssr: envelope.target === 'node' ? 'nodejs' : 'workerd',
    apiBackend: envelope.target === 'node' ? 'nodejs' : 'workerd-effect',
    backendManifest: 'module-federation-manifest',
    backendContainer: envelope.target === 'node' ? 'nodejs' : 'commonjs-module',
  };
  for (const [surface, logicalPaths] of Object.entries({
    uiClient: surfaces.uiClient,
    ssr: surfaces.ssr,
    apiBackend: surfaces.apiBackend,
    backendManifest: [surfaces.backendManifest],
    backendContainer: [surfaces.backendContainer],
  })) {
    for (const logicalPath of logicalPaths) {
      const artifact = artifactByPath.get(logicalPath);
      if (!artifact) {
        throw new Error(
          `${appId} surface ${surface} references unbound artifact ${logicalPath}`,
        );
      }
      if (artifact.runtime !== expectedRuntimes[surface]) {
        throw new Error(
          `${appId} surface ${surface} has invalid runtime ${artifact.runtime}`,
        );
      }
    }
  }

  const realRoot = fs.realpathSync(location.root);
  for (const artifact of artifacts) {
    const absolutePath = artifactPath(location, artifact.logicalPath);
    const realArtifact = fs.realpathSync(absolutePath);
    if (
      !isInside(realRoot, realArtifact) ||
      !fs.statSync(realArtifact).isFile()
    ) {
      throw new Error(
        `${appId} release artifact escapes target root: ${artifact.logicalPath}`,
      );
    }
    const bytes = fs.readFileSync(realArtifact);
    if (
      bytes.byteLength !== artifact.byteLength ||
      sha256(bytes) !== artifact.sha256
    ) {
      throw new Error(
        `${appId} release envelope artifact mismatch for ${artifact.logicalPath}`,
      );
    }
  }
}

function manifestModuleFederationCohort(
  location,
  logicalPath,
  appId,
  configuredCohort,
) {
  const manifest = JSON.parse(
    fs.readFileSync(artifactPath(location, logicalPath), 'utf8'),
  );
  const pluginVersion =
    manifest.pluginVersion ??
    manifest.metaData?.pluginVersion ??
    manifest.backendFederation?.moduleFederationVersion;
  if (typeof pluginVersion !== 'string' || pluginVersion.length === 0) {
    throw new Error(
      `${appId} SHA-bound Module Federation manifest has no pluginVersion`,
    );
  }
  for (const item of configuredCohort) {
    if (item.version !== pluginVersion) {
      throw new Error(
        `${appId} runtime manifest Module Federation ${pluginVersion} differs from ${item.packageName}@${item.version}`,
      );
    }
  }
  return configuredCohort;
}

function verifyWorkerdResponse(response, app, identity, label) {
  if (
    !isRecord(response) ||
    typeof response.bodyBase64 !== 'string' ||
    !Number.isSafeInteger(response.byteLength) ||
    typeof response.sha256 !== 'string' ||
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(`${app.id} ${label} API response evidence is invalid`);
  }
  const bytes = Buffer.from(response.bodyBase64, 'base64');
  if (
    bytes.byteLength !== response.byteLength ||
    sha256(bytes) !== response.sha256
  ) {
    throw new Error(`${app.id} ${label} API response digest mismatch`);
  }
  JSON.parse(bytes.toString('utf8'));
  if (
    response.releaseMarker?.appId !== app.id ||
    response.releaseMarker?.build !== identity.buildMarker ||
    response.releaseMarker?.version !== identity.releaseVersion
  ) {
    throw new Error(
      `${app.id} ${label} API response is not tied to its release identity`,
    );
  }
}

function verifyWorkerdRuntimeCorrelation(projectDir, app, location) {
  const reportPath = path.join(
    projectDir,
    '.codex/reports/cloudflare-workerd-ssr/composition-proof.json',
  );
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `${app.id} workerd execution correlation report is missing`,
    );
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (
    report.schemaVersion !== 3 ||
    report.runtime !== 'workerd' ||
    !Array.isArray(report.executions) ||
    !Array.isArray(report.apiProofs)
  ) {
    throw new Error(
      `${app.id} workerd execution correlation report is invalid`,
    );
  }
  const execution = report.executions.find(item => item.appId === app.id);
  if (!execution) {
    throw new Error(`${app.id} workerd execution metadata is missing`);
  }
  const expectedRoot = path.posix.join(app.path, '.output');
  if (
    execution.modulesRoot !== expectedRoot ||
    execution.envelopeDigest !== location.envelope.envelopeDigest ||
    JSON.stringify(execution.identity) !==
      JSON.stringify(location.envelope.identity) ||
    typeof execution.worker !== 'string' ||
    execution.worker.length === 0 ||
    !Array.isArray(execution.modules) ||
    execution.modules.length === 0
  ) {
    throw new Error(`${app.id} workerd execution identity is invalid`);
  }
  const artifactByPath = new Map(
    location.envelope.artifacts.map(artifact => [
      artifact.logicalPath,
      artifact,
    ]),
  );
  for (const module of execution.modules) {
    const artifact = artifactByPath.get(module.logicalPath);
    if (
      !artifact ||
      module.byteLength !== artifact.byteLength ||
      module.sha256 !== artifact.sha256 ||
      typeof module.type !== 'string'
    ) {
      throw new Error(
        `${app.id} selected workerd module ${String(module.logicalPath)} is not envelope-bound`,
      );
    }
  }
  const selectedPaths = new Set(
    execution.modules.map(module => module.logicalPath),
  );
  if (
    !selectedPaths.has(execution.main) ||
    !location.envelope.surfaces.ssr.every(logicalPath =>
      selectedPaths.has(logicalPath),
    ) ||
    !location.envelope.surfaces.apiBackend.every(logicalPath =>
      selectedPaths.has(logicalPath),
    )
  ) {
    throw new Error(
      `${app.id} workerd main/SSR/BFF surfaces are not all selected`,
    );
  }

  const apiProofs = report.apiProofs.filter(item => item.appId === app.id);
  const expectedChecks = app.deploy?.cloudflare?.jsonSmokeChecks ?? [];
  const checkKey = check =>
    JSON.stringify({
      id: check.id,
      method: String(check.method ?? 'GET').toUpperCase(),
      route: check.route,
    });
  const expectedKeys = expectedChecks.map(checkKey).sort();
  const actualKeys = apiProofs.map(checkKey).sort();
  if (
    expectedKeys.length === 0 ||
    new Set(expectedKeys).size !== expectedKeys.length ||
    new Set(actualKeys).size !== actualKeys.length ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error(
      `${app.id} workerd API execution proofs do not exactly match configured JSON smoke checks`,
    );
  }
  for (const proof of apiProofs) {
    if (
      proof.bindingTarget?.appId !== app.id ||
      proof.bindingTarget?.envelopeDigest !==
        location.envelope.envelopeDigest ||
      proof.bindingTarget?.worker !== execution.worker ||
      typeof proof.binding !== 'string' ||
      proof.binding.length === 0
    ) {
      throw new Error(
        `${app.id} service binding is not tied to its Miniflare worker identity`,
      );
    }
    verifyWorkerdResponse(
      proof.direct,
      app,
      location.envelope.identity,
      'direct',
    );
    verifyWorkerdResponse(
      proof.throughShell,
      app,
      location.envelope.identity,
      'service-binding',
    );
    if (proof.direct.sha256 !== proof.throughShell.sha256) {
      throw new Error(
        `${app.id} direct and service-binding API response digests differ`,
      );
    }
  }
  return {
    apiProofCount: apiProofs.length,
    main: execution.main,
    moduleCount: execution.modules.length,
    modulesRoot: execution.modulesRoot,
    worker: execution.worker,
  };
}

function releaseIdentity(projectDir, app, platform) {
  const location = envelopeLocation(projectDir, app, platform);
  verifyEnvelope(location, app.id);
  const packageJson = readAppPackageJson(projectDir, app);
  if (
    typeof packageJson.version !== 'string' ||
    packageJson.version.length === 0 ||
    location.envelope.identity.releaseVersion !== packageJson.version
  ) {
    throw new Error(
      `${app.id} release envelope version ${String(
        location.envelope.identity.releaseVersion,
      )} differs from its package version ${String(packageJson.version)}`,
    );
  }
  const frontendManifest = location.envelope.surfaces.uiClient.find(
    logicalPath =>
      logicalPath ===
      (platform === 'workerd' ? 'public/mf-manifest.json' : 'mf-manifest.json'),
  );
  if (!frontendManifest) {
    throw new Error(
      `${app.id} release envelope does not bind its executed mf-manifest.json`,
    );
  }
  const moduleFederation = manifestModuleFederationCohort(
    location,
    frontendManifest,
    app.id,
    readModuleFederationCohort(projectDir, app),
  );
  const identity = {
    buildMarker: location.envelope.identity.buildMarker,
    moduleFederation,
    releaseVersion: location.envelope.identity.releaseVersion,
    sourceRevision: location.envelope.identity.sourceRevision,
  };
  return {
    appId: app.id,
    envelopeDigest: location.envelope.envelopeDigest,
    envelopePath: path.relative(
      fs.realpathSync(projectDir),
      location.envelopePath,
    ),
    ...(platform === 'workerd'
      ? {
          workerd: verifyWorkerdRuntimeCorrelation(projectDir, app, location),
        }
      : {}),
    surfaces: {
      api: { ...identity },
      backend: { ...identity },
      frontend: { ...identity },
      ssr: { ...identity },
    },
  };
}

function readNodeBackendArtifactEvidence(projectDir, app) {
  const identity = releaseIdentity(projectDir, app, 'node');
  return {
    appId: identity.appId,
    envelopeDigest: identity.envelopeDigest,
    envelopePath: identity.envelopePath,
    identity: identity.surfaces.backend,
  };
}

function dimensionEvidence({
  artifactMode,
  assertions,
  platform,
  verticalIds,
}) {
  const normalizedAssertions =
    assertions.length > 0
      ? assertions
      : [
          {
            reason: 'No real runtime producer exists for this dimension',
            status: 'fail',
          },
        ];
  return {
    artifactMode,
    assertions: normalizedAssertions,
    platform,
    status: normalizedAssertions.every(assertion => assertion.status === 'pass')
      ? 'pass'
      : 'fail',
    verticalIds,
  };
}

function resultAssertions(results, appIds, types) {
  return results
    .filter(result => appIds.includes(result.appId))
    .flatMap(result =>
      result.assertions
        .filter(assertion => types.includes(assertion.type))
        .map(assertion => ({ appId: result.appId, ...assertion })),
    );
}

function requireAppCoverage(assertions, appIds, type) {
  const covered = new Set(
    assertions
      .filter(assertion => assertion.status === 'pass')
      .map(assertion => assertion.appId),
  );
  return appIds.map(appId => ({
    appId,
    status: covered.has(appId) ? 'pass' : 'fail',
    type,
  }));
}

function createRuntimeEvidence({
  artifactMode,
  contract,
  platform,
  projectDir,
  results,
}) {
  const verticalApps = (contract.apps ?? []).filter(
    app => app.kind === 'vertical',
  );
  const verticalIds = verticalApps.map(app => app.id);
  const allAppIds = (contract.apps ?? []).map(app => app.id);
  const evidence = {};

  const ssrAssertions = resultAssertions(results, allAppIds, [
    'ssr-route',
    'ui-marker-html',
    'no-js-ssr-ui-marker',
    'no-js-distributed-ssr-route',
    'no-js-shell-composition-boundary',
  ]);
  evidence.ssr = dimensionEvidence({
    artifactMode,
    assertions: [
      ...ssrAssertions,
      ...requireAppCoverage(ssrAssertions, allAppIds, 'ssr-app-coverage'),
    ],
    platform,
    verticalIds,
  });

  const browserMfAssertions = resultAssertions(results, allAppIds, [
    'mf-manifest',
    'mf-manifest-json',
    'shell-mf-network-evidence',
    'shell-hydration-dom-identity',
    'shell-composition-boundary',
  ]);
  evidence['browser-mf'] = dimensionEvidence({
    artifactMode,
    assertions: [
      ...browserMfAssertions,
      ...requireAppCoverage(
        browserMfAssertions.filter(
          assertion => assertion.type === 'mf-manifest',
        ),
        allAppIds,
        'browser-mf-app-coverage',
      ),
    ],
    platform,
    verticalIds,
  });

  const apiAssertions = resultAssertions(results, verticalIds, [
    'effect-readiness',
  ]);
  evidence.api = dimensionEvidence({
    artifactMode,
    assertions: [
      ...apiAssertions,
      ...requireAppCoverage(apiAssertions, verticalIds, 'api-app-coverage'),
    ],
    platform,
    verticalIds,
  });

  const backendAssertions = resultAssertions(results, verticalIds, [
    'backend-json-smoke',
    ...(platform === 'node' ? ['backend-federation-network'] : []),
  ]);
  const backendFederationAssertions =
    platform === 'node'
      ? backendAssertions.filter(
          assertion => assertion.type === 'backend-federation-network',
        )
      : backendAssertions;
  evidence.backend = dimensionEvidence({
    artifactMode,
    assertions: [
      ...backendAssertions,
      ...requireAppCoverage(
        backendFederationAssertions,
        verticalIds,
        'backend-app-coverage',
      ),
    ],
    platform,
    verticalIds,
  });

  for (const dimension of ['backend-driven-ui', 'failure-isolation']) {
    const assertions = resultAssertions(results, verticalIds, [dimension]);
    evidence[dimension] = dimensionEvidence({
      artifactMode,
      assertions: [
        ...assertions,
        ...requireAppCoverage(
          assertions,
          verticalIds,
          `${dimension}-app-coverage`,
        ),
      ],
      platform,
      verticalIds,
    });
  }

  const identityAssertions = [];
  const apps = [];
  for (const app of verticalApps) {
    try {
      const identity = releaseIdentity(projectDir, app, platform);
      apps.push(identity);
      identityAssertions.push({
        appId: app.id,
        envelopeDigest: identity.envelopeDigest,
        envelopePath: identity.envelopePath,
        status: 'pass',
        type: 'release-envelope',
      });
    } catch (error) {
      identityAssertions.push({
        appId: app.id,
        reason: error instanceof Error ? error.message : String(error),
        status: 'fail',
        type: 'release-envelope',
      });
    }
  }
  evidence['release-identity'] = {
    ...dimensionEvidence({
      artifactMode,
      assertions: identityAssertions,
      platform,
      verticalIds,
    }),
    apps,
  };

  return Object.fromEntries(
    dimensions.map(dimension => [dimension, evidence[dimension]]),
  );
}

export { createRuntimeEvidence, readNodeBackendArtifactEvidence };
