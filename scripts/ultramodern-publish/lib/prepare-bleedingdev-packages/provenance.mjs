import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import {
  npmRegistryOrigin,
  repoRoot,
  trustedPublishOidcIssuer,
  trustedPublishRef,
  trustedPublishRepository,
  trustedPublishWorkflowPath,
} from './constants.mjs';
import { normalizeRepositoryIdentity } from './release-artifacts.mjs';

const dsseInTotoPayloadType = 'application/vnd.in-toto+json';
const githubActionsBuildType =
  'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1';
const inTotoStatementV1 = 'https://in-toto.io/Statement/v1';
const slsaProvenanceV1 = 'https://slsa.dev/provenance/v1';
const fulcioSourceCommitOid = '1.3.6.1.4.1.57264.1.3';
const fulcioSourceRepositoryOid = '1.3.6.1.4.1.57264.1.5';
const fulcioSourceRefOid = '1.3.6.1.4.1.57264.1.6';

let cachedNpmSigstoreVerifier;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function decodeCanonicalBase64(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    throw new Error(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new Error(`${label} must be canonical base64`);
  }
  return bytes;
}

function sha512HexFromIntegrity(integrity, label) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`${label} must be a SHA-512 SRI value`);
  }
  const digest = decodeCanonicalBase64(
    integrity.slice('sha512-'.length),
    label,
  );
  if (digest.length !== 64) {
    throw new Error(`${label} must contain exactly one SHA-512 digest`);
  }
  return digest.toString('hex');
}

function encodePurlComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, character =>
    `%${character.codePointAt(0).toString(16).toUpperCase()}`,
  );
}

function npmPackagePurl(packageName, version) {
  assertNonEmptyString(packageName, 'npm provenance package name');
  assertNonEmptyString(version, 'npm provenance package version');

  let encodedName;
  if (packageName.startsWith('@')) {
    const segments = packageName.slice(1).split('/');
    if (segments.length !== 2 || segments.some(segment => segment === '')) {
      throw new Error(`Invalid scoped npm package name ${packageName}`);
    }
    encodedName = `%40${encodePurlComponent(segments[0])}/${encodePurlComponent(
      segments[1],
    )}`;
  } else {
    if (packageName.includes('/')) {
      throw new Error(`Invalid npm package name ${packageName}`);
    }
    encodedName = encodePurlComponent(packageName);
  }

  return `pkg:npm/${encodedName}@${encodePurlComponent(version)}`;
}

function normalizedRepository(value, label) {
  assertNonEmptyString(value, label);
  try {
    return normalizeRepositoryIdentity(value);
  } catch (error) {
    throw new Error(
      `${label} is not a GitHub repository identity: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function repositoriesMatch(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function parseRepositoryReference(value, label) {
  assertNonEmptyString(value, label);
  const githubIndex = value.toLowerCase().indexOf('github.com');
  if (githubIndex === -1) {
    throw new Error(`${label} is not a GitHub source reference`);
  }
  const refSeparator = value.lastIndexOf('@');
  if (refSeparator <= githubIndex) {
    throw new Error(`${label} must include an immutable workflow ref`);
  }
  const ref = value.slice(refSeparator + 1);
  assertNonEmptyString(ref, `${label} ref`);
  return {
    ref,
    repository: normalizedRepository(
      value.slice(0, refSeparator),
      `${label} repository`,
    ),
  };
}

function trustedCertificateIdentity(repository, workflowPath, ref) {
  return `https://github.com/${repository}/${workflowPath}@${ref}`;
}

function assertProvenanceExpectation(expectation) {
  assertPlainObject(expectation, 'Registry provenance expectation');
  assertPlainObject(
    expectation.source,
    'Registry provenance source expectation',
  );
  assertPlainObject(
    expectation.workflow,
    'Registry provenance workflow expectation',
  );
  const sourceRepository = normalizedRepository(
    expectation.source.repository,
    'Registry provenance expected source repository',
  );
  const workflowRepository = normalizedRepository(
    expectation.workflow.repository,
    'Registry provenance expected workflow repository',
  );
  if (!repositoriesMatch(sourceRepository, workflowRepository)) {
    throw new Error(
      'Registry provenance source and workflow repositories must match',
    );
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(expectation.source.commit)) {
    throw new Error(
      'Registry provenance expected source commit must be a full Git object ID',
    );
  }
  assertNonEmptyString(
    expectation.workflow.path,
    'Registry provenance expected workflow path',
  );
  assertNonEmptyString(
    expectation.workflow.ref,
    'Registry provenance expected workflow ref',
  );
  assertNonEmptyString(
    expectation.issuer,
    'Registry provenance expected certificate issuer',
  );
  assertNonEmptyString(
    expectation.certificateIdentity,
    'Registry provenance expected certificate identity',
  );
  const expectedIdentity = trustedCertificateIdentity(
    workflowRepository,
    expectation.workflow.path,
    expectation.workflow.ref,
  );
  if (expectation.certificateIdentity !== expectedIdentity) {
    throw new Error(
      `Registry provenance certificate identity must be ${expectedIdentity}`,
    );
  }
  return { sourceRepository, workflowRepository };
}

function assertSourceBinding(statement, expectation, packageLabel) {
  const { sourceRepository, workflowRepository } =
    assertProvenanceExpectation(expectation);
  assertPlainObject(statement.predicate, `${packageLabel} SLSA predicate`);
  const buildDefinition = statement.predicate.buildDefinition;
  assertPlainObject(
    buildDefinition,
    `${packageLabel} SLSA predicate.buildDefinition`,
  );
  if (buildDefinition.buildType !== githubActionsBuildType) {
    throw new Error(
      `${packageLabel} SLSA buildType must be ${githubActionsBuildType}`,
    );
  }

  const dependencies = buildDefinition.resolvedDependencies;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new Error(
      `${packageLabel} SLSA resolvedDependencies must be a non-empty array`,
    );
  }
  const candidates = [];
  for (const [index, dependency] of dependencies.entries()) {
    if (!isPlainObject(dependency) || typeof dependency.uri !== 'string') {
      continue;
    }
    let reference;
    try {
      reference = parseRepositoryReference(
        dependency.uri,
        `${packageLabel} SLSA resolvedDependencies[${index}].uri`,
      );
    } catch {
      continue;
    }
    if (repositoriesMatch(reference.repository, sourceRepository)) {
      candidates.push({ dependency, index, reference });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `${packageLabel} SLSA provenance must identify the accepted source repository exactly once; found ${candidates.length}`,
    );
  }

  const [{ dependency, index, reference }] = candidates;
  assertPlainObject(
    dependency.digest,
    `${packageLabel} SLSA resolvedDependencies[${index}].digest`,
  );
  const actualCommit = dependency.digest.gitCommit;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(actualCommit)) {
    throw new Error(
      `${packageLabel} SLSA source gitCommit must be a full Git object ID`,
    );
  }
  if (actualCommit.toLowerCase() !== expectation.source.commit) {
    throw new Error(
      `${packageLabel} SLSA source commit ${actualCommit} does not match accepted commit ${expectation.source.commit}`,
    );
  }
  if (reference.ref !== expectation.workflow.ref) {
    throw new Error(
      `${packageLabel} SLSA source ref ${reference.ref} does not match trusted ref ${expectation.workflow.ref}`,
    );
  }

  const externalParameters = buildDefinition.externalParameters;
  assertPlainObject(
    externalParameters,
    `${packageLabel} SLSA buildDefinition.externalParameters`,
  );
  const workflow = externalParameters.workflow;
  assertPlainObject(workflow, `${packageLabel} SLSA workflow`);
  assertNonEmptyString(
    workflow.repository,
    `${packageLabel} SLSA workflow.repository`,
  );
  const actualWorkflowRepository = normalizedRepository(
    workflow.repository,
    `${packageLabel} SLSA workflow.repository`,
  );
  if (!repositoriesMatch(actualWorkflowRepository, workflowRepository)) {
    throw new Error(
      `${packageLabel} SLSA workflow repository ${actualWorkflowRepository} does not match trusted repository ${workflowRepository}`,
    );
  }
  assertNonEmptyString(workflow.path, `${packageLabel} SLSA workflow.path`);
  if (workflow.path !== expectation.workflow.path) {
    throw new Error(
      `${packageLabel} SLSA workflow path ${workflow.path} does not match trusted path ${expectation.workflow.path}`,
    );
  }
  assertNonEmptyString(workflow.ref, `${packageLabel} SLSA workflow.ref`);
  if (workflow.ref !== expectation.workflow.ref) {
    throw new Error(
      `${packageLabel} SLSA workflow ref ${workflow.ref} does not match trusted ref ${expectation.workflow.ref}`,
    );
  }
}

function createRegistryProvenanceExpectation(manifest, env = process.env) {
  assertPlainObject(manifest?.source, 'Release manifest source');
  const sourceRepository = normalizedRepository(
    manifest.source.repository,
    'Release manifest source.repository',
  );
  if (!repositoriesMatch(sourceRepository, trustedPublishRepository)) {
    throw new Error(
      `Release source repository ${sourceRepository} does not match trusted publish repository ${trustedPublishRepository}`,
    );
  }
  if (
    env.GITHUB_REPOSITORY !== undefined &&
    !repositoriesMatch(
      normalizedRepository(env.GITHUB_REPOSITORY, 'Trusted publish repository'),
      trustedPublishRepository,
    )
  ) {
    throw new Error(
      `Trusted publish repository ${env.GITHUB_REPOSITORY} does not match ${trustedPublishRepository}`,
    );
  }
  if (
    env.GITHUB_REF !== undefined &&
    env.GITHUB_REF !== trustedPublishRef
  ) {
    throw new Error(
      `Trusted publish ref ${env.GITHUB_REF} does not match ${trustedPublishRef}`,
    );
  }

  const expectation = {
    certificateIdentity: trustedCertificateIdentity(
      trustedPublishRepository,
      trustedPublishWorkflowPath,
      trustedPublishRef,
    ),
    issuer: trustedPublishOidcIssuer,
    source: {
      commit: manifest.source.commit,
      repository: trustedPublishRepository,
    },
    workflow: {
      path: trustedPublishWorkflowPath,
      ref: trustedPublishRef,
      repository: trustedPublishRepository,
    },
  };
  assertProvenanceExpectation(expectation);
  return expectation;
}

function loadNpmSigstoreVerifier(runner = execFileSync) {
  if (runner === execFileSync && cachedNpmSigstoreVerifier) {
    return cachedNpmSigstoreVerifier;
  }
  let globalRoot;
  try {
    globalRoot = String(
      runner('npm', ['root', '--global'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).trim();
  } catch (error) {
    throw new Error('Cannot resolve the active npm installation for Sigstore', {
      cause: error,
    });
  }
  assertNonEmptyString(globalRoot, 'Active npm global module root');
  const npmPackageJson = path.join(globalRoot, 'npm', 'package.json');
  try {
    const requireFromNpm = createRequire(npmPackageJson);
    const sigstore = requireFromNpm('sigstore');
    const packageJson = requireFromNpm('sigstore/package.json');
    if (typeof sigstore?.verify !== 'function') {
      throw new Error('sigstore.verify is unavailable');
    }
    assertNonEmptyString(
      packageJson?.version,
      'npm-bundled Sigstore version',
    );
    const verifier = Object.freeze({
      verify: sigstore.verify,
      version: packageJson.version,
    });
    if (runner === execFileSync) {
      cachedNpmSigstoreVerifier = verifier;
    }
    return verifier;
  } catch (error) {
    throw new Error(
      `The active npm installation at ${npmPackageJson} does not provide a usable Sigstore verifier`,
      { cause: error },
    );
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function verifySigstoreBundle(
  bundle,
  expectation,
  loadVerifier = loadNpmSigstoreVerifier,
) {
  assertPlainObject(bundle, 'npm SLSA Sigstore bundle');
  assertProvenanceExpectation(expectation);
  const verifier = loadVerifier();
  if (!verifier || typeof verifier.verify !== 'function') {
    throw new Error('npm-bundled Sigstore verifier is unavailable');
  }
  const options = {
    certificateIdentityURI: `^${escapeRegularExpression(
      expectation.certificateIdentity,
    )}$`,
    certificateIssuer: expectation.issuer,
    certificateOIDs: {
      [fulcioSourceCommitOid]: expectation.source.commit,
      [fulcioSourceRefOid]: expectation.workflow.ref,
      [fulcioSourceRepositoryOid]: expectation.source.repository,
    },
    ctLogThreshold: 1,
    tlogThreshold: 1,
  };
  let signer;
  try {
    signer = await verifier.verify(bundle, options);
  } catch (error) {
    throw new Error(
      `npm SLSA Sigstore/Fulcio/Rekor verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (
    signer?.identity?.subjectAlternativeName !==
      expectation.certificateIdentity ||
    signer?.identity?.extensions?.issuer !== expectation.issuer
  ) {
    throw new Error(
      'npm SLSA Sigstore verifier did not return the required Fulcio issuer and certificate identity',
    );
  }
  return {
    certificateIdentity: expectation.certificateIdentity,
    issuer: expectation.issuer,
    verifierVersion: verifier.version,
  };
}

function pinnedNpmAttestationsUrl(item, value) {
  assertNonEmptyString(
    value,
    `${item.targetName}@${item.version} registry dist.attestations.url`,
  );
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry attestations URL is invalid`,
      { cause: error },
    );
  }
  const expectedPath = `/-/npm/v1/attestations/${item.targetName}@${item.version}`;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry attestations URL has invalid encoding`,
      { cause: error },
    );
  }
  if (
    url.origin !== npmRegistryOrigin ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    decodedPath !== expectedPath
  ) {
    throw new Error(
      `${item.targetName}@${item.version} registry attestations URL is not the pinned npm endpoint ${npmRegistryOrigin}${expectedPath}`,
    );
  }
  return url.href;
}

async function verifyRegistryProvenance(
  item,
  dist,
  expectation,
  fetchImpl = globalThis.fetch,
  bundleVerifier = verifySigstoreBundle,
) {
  const packageLabel = `${item.targetName}@${item.version}`;
  assertProvenanceExpectation(expectation);
  const attestations = dist?.attestations;
  assertPlainObject(attestations, `${packageLabel} registry dist.attestations`);
  assertPlainObject(
    attestations.provenance,
    `${packageLabel} registry dist.attestations.provenance`,
  );
  if (attestations.provenance.predicateType !== slsaProvenanceV1) {
    throw new Error(
      `${packageLabel} registry metadata does not declare SLSA v1 provenance`,
    );
  }
  const attestationsUrl = pinnedNpmAttestationsUrl(item, attestations.url);
  if (typeof fetchImpl !== 'function') {
    throw new Error(`${packageLabel} registry provenance fetch is unavailable`);
  }

  let response;
  try {
    response = await fetchImpl(attestationsUrl, {
      headers: { accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(
      `${packageLabel} registry provenance request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (!response?.ok) {
    throw new Error(
      `${packageLabel} registry provenance returned HTTP ${String(
        response?.status ?? '<unknown>',
      )}`,
    );
  }
  if (typeof response.json !== 'function') {
    throw new Error(`${packageLabel} registry provenance response is malformed`);
  }

  let document;
  try {
    document = await response.json();
  } catch (error) {
    throw new Error(`${packageLabel} registry provenance is not valid JSON`, {
      cause: error,
    });
  }
  assertPlainObject(document, `${packageLabel} registry provenance response`);
  if (!Array.isArray(document.attestations)) {
    throw new Error(
      `${packageLabel} registry provenance response must contain attestations`,
    );
  }
  const slsaAttestations = document.attestations.filter(
    attestation =>
      isPlainObject(attestation) &&
      attestation.predicateType === slsaProvenanceV1,
  );
  if (slsaAttestations.length !== 1) {
    throw new Error(
      `${packageLabel} registry provenance must contain exactly one SLSA v1 attestation; found ${slsaAttestations.length}`,
    );
  }

  const [attestation] = slsaAttestations;
  assertPlainObject(attestation.bundle, `${packageLabel} SLSA bundle`);
  const verification = await bundleVerifier(attestation.bundle, expectation);

  const envelope = attestation.bundle.dsseEnvelope;
  assertPlainObject(envelope, `${packageLabel} SLSA DSSE envelope`);
  if (envelope.payloadType !== dsseInTotoPayloadType) {
    throw new Error(
      `${packageLabel} SLSA DSSE payloadType must be ${dsseInTotoPayloadType}`,
    );
  }
  const payloadBytes = decodeCanonicalBase64(
    envelope.payload,
    `${packageLabel} SLSA DSSE payload`,
  );
  let statement;
  try {
    statement = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes),
    );
  } catch (error) {
    throw new Error(
      `${packageLabel} SLSA DSSE payload is not valid UTF-8 JSON`,
      { cause: error },
    );
  }
  assertPlainObject(statement, `${packageLabel} in-toto statement`);
  if (statement._type !== inTotoStatementV1) {
    throw new Error(
      `${packageLabel} provenance is not an in-toto Statement v1`,
    );
  }
  if (statement.predicateType !== slsaProvenanceV1) {
    throw new Error(`${packageLabel} provenance is not SLSA v1`);
  }
  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) {
    throw new Error(
      `${packageLabel} SLSA statement must contain exactly one package subject`,
    );
  }

  const [subject] = statement.subject;
  assertPlainObject(subject, `${packageLabel} SLSA subject`);
  const expectedSubject = npmPackagePurl(item.targetName, item.version);
  if (subject.name !== expectedSubject) {
    throw new Error(
      `${packageLabel} SLSA subject ${String(
        subject.name,
      )} does not match ${expectedSubject}`,
    );
  }
  assertPlainObject(subject.digest, `${packageLabel} SLSA subject.digest`);
  const actualSha512 = subject.digest.sha512;
  if (!/^[a-f0-9]{128}$/iu.test(actualSha512)) {
    throw new Error(
      `${packageLabel} SLSA subject.digest.sha512 must be a SHA-512 hex digest`,
    );
  }
  const expectedSha512 = sha512HexFromIntegrity(
    item.integrity,
    `${packageLabel} accepted integrity`,
  );
  if (actualSha512.toLowerCase() !== expectedSha512) {
    throw new Error(
      `${packageLabel} SLSA subject SHA-512 does not match the accepted tarball integrity`,
    );
  }

  assertSourceBinding(statement, expectation, packageLabel);
  return {
    attestationsUrl,
    certificateIdentity: verification.certificateIdentity,
    issuer: verification.issuer,
    predicateType: slsaProvenanceV1,
    subject: expectedSubject,
    subjectSha512: expectedSha512,
    verifierVersion: verification.verifierVersion,
  };
}

export {
  createRegistryProvenanceExpectation,
  dsseInTotoPayloadType,
  githubActionsBuildType,
  inTotoStatementV1,
  loadNpmSigstoreVerifier,
  npmPackagePurl,
  slsaProvenanceV1,
  verifyRegistryProvenance,
  verifySigstoreBundle,
};
