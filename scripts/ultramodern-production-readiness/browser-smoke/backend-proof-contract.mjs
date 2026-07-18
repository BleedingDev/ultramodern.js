const sha256Pattern = /^[a-f\d]{64}$/u;
const nodeReleaseEnvelopeSuffix =
  '/release/microvertical-release-envelope.json';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function sameUrl(left, right) {
  return (
    isHttpUrl(left) &&
    isHttpUrl(right) &&
    new URL(left).href === new URL(right).href
  );
}

function haveSameOrigin(...values) {
  if (values.length === 0 || values.some(value => !isHttpUrl(value))) {
    return false;
  }
  const [expectedOrigin, ...origins] = values.map(
    value => new URL(value).origin,
  );
  return origins.every(origin => origin === expectedOrigin);
}

function isPassingStatusCode(value) {
  return Number.isSafeInteger(value) && value >= 200 && value < 300;
}

function isNormalizedReleaseEnvelopePath(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.startsWith('/')
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.every(
      segment => segment.length > 0 && !['.', '..'].includes(segment),
    ) && value.endsWith(nodeReleaseEnvelopeSuffix)
  );
}

function isNormalizedApiBackendArtifactPath(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.startsWith('/')
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments[0] === 'api' &&
    segments.length > 1 &&
    segments.every(
      segment => segment.length > 0 && !['.', '..'].includes(segment),
    ) &&
    /\.(?:c|m)?js$/u.test(segments.at(-1))
  );
}

function validateLiveArtifact(failures, artifact, expected) {
  if (!isRecord(artifact)) {
    failures.push(`${expected.label} live artifact is missing`);
    return;
  }
  if (
    artifact.status !== 'pass' ||
    !sameUrl(artifact.url, expected.url) ||
    artifact.logicalPath !== expected.logicalPath ||
    !isPassingStatusCode(artifact.statusCode) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0 ||
    !sha256Pattern.test(artifact.sha256)
  ) {
    failures.push(
      `${expected.label} live artifact is not byte- and URL-correlated`,
    );
  }
}

function validateNodeBackendFederationProofResult(result) {
  const failures = [];
  const appId =
    typeof result?.appId === 'string' && result.appId.length > 0
      ? result.appId
      : '<unknown>';

  if (!isRecord(result) || result.status !== 'pass') {
    failures.push(`${appId} proof result did not pass`);
    return { appId, failures, ok: false };
  }
  if (
    !isHttpUrl(result.manifestUrl) ||
    !isHttpUrl(result.containerEntry) ||
    !sameUrl(result.runtimeEntry, result.containerEntry) ||
    !haveSameOrigin(
      result.manifestUrl,
      result.containerEntry,
      result.runtimeEntry,
    )
  ) {
    failures.push(
      `${appId} federation runtime was not loaded from its HTTP container`,
    );
  }

  const envelope = result.releaseEnvelope;
  if (
    !isRecord(envelope) ||
    envelope.target !== 'node' ||
    !isNormalizedReleaseEnvelopePath(envelope.path) ||
    !sha256Pattern.test(envelope.envelopeDigest)
  ) {
    failures.push(`${appId} release envelope evidence is missing or invalid`);
  }

  validateLiveArtifact(failures, result.liveArtifacts?.manifest, {
    label: `${appId} backend manifest`,
    logicalPath: 'backend-mf-manifest.json',
    url: result.manifestUrl,
  });
  validateLiveArtifact(failures, result.liveArtifacts?.container, {
    label: `${appId} backend container`,
    logicalPath: 'backendRemoteEntry.cjs',
    url: result.containerEntry,
  });

  const boundary = result.versionBoundary;
  const liveApi = result.liveApi;
  let liveApiUrl;
  try {
    liveApiUrl = isHttpUrl(liveApi?.url) ? new URL(liveApi.url) : undefined;
  } catch {
    liveApiUrl = undefined;
  }
  if (
    !isRecord(boundary) ||
    !isRecord(liveApi) ||
    liveApi.status !== 'pass' ||
    liveApi.method !== 'GET' ||
    typeof liveApi.route !== 'string' ||
    !liveApi.route.startsWith('/') ||
    liveApiUrl?.pathname !== liveApi.route ||
    liveApiUrl?.origin !==
      (isHttpUrl(result.manifestUrl)
        ? new URL(result.manifestUrl).origin
        : undefined) ||
    !isPassingStatusCode(liveApi.statusCode) ||
    !haveSameOrigin(
      result.manifestUrl,
      result.containerEntry,
      result.runtimeEntry,
      liveApi.url,
    ) ||
    // This producer-result validator can only require and correlate the digest
    // reference. runtime-evidence.verifyEnvelope independently recomputes the
    // canonical envelope digest and every artifact digest from executed bytes.
    liveApi.envelopeDigest !== envelope?.envelopeDigest ||
    liveApi.marker?.unitId !== boundary.unitId ||
    liveApi.marker?.buildMarker !== boundary.buildVersion ||
    liveApi.marker?.sourceRevision !== boundary.sourceRevision ||
    liveApi.marker?.releaseVersion !== boundary.version
  ) {
    failures.push(
      `${appId} live API is not correlated to its release envelope and identity`,
    );
  }
  if (
    !Array.isArray(liveApi?.apiBackendArtifacts) ||
    liveApi.apiBackendArtifacts.length === 0 ||
    liveApi.apiBackendArtifacts.some(
      artifact =>
        !isRecord(artifact) ||
        !isNormalizedApiBackendArtifactPath(artifact.logicalPath) ||
        !Number.isSafeInteger(artifact.byteLength) ||
        artifact.byteLength <= 0 ||
        !sha256Pattern.test(artifact.sha256),
    )
  ) {
    failures.push(
      `${appId} live API has no envelope-bound backend artifact evidence`,
    );
  }

  if (
    !Array.isArray(result.smokeChecks) ||
    result.smokeChecks.length === 0 ||
    result.smokeChecks.some(
      check =>
        check?.status !== 'pass' ||
        !isPassingStatusCode(check.statusCode) ||
        !Array.isArray(check.assertions) ||
        check.assertions.some(assertion => assertion?.status !== 'pass'),
    )
  ) {
    failures.push(`${appId} backend runtime smoke checks are empty or failed`);
  }

  return { appId, failures, ok: failures.length === 0 };
}

export { validateNodeBackendFederationProofResult };
