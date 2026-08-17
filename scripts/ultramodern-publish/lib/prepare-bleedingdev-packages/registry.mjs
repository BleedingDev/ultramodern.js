// Consumer: publish-bleedingdev.yml preflight, publish, and exact registry verification.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  npmPublishAttempts,
  npmPublishRetryDelayMs,
  npmRegistryOrigin,
  repoRoot,
  transientNpmPublishErrorPatterns,
} from './constants.mjs';
import { run, sleep } from './commands.mjs';
import {
  preflightTrustedPublishingPackages,
  publishAcceptedPackage,
  validateAcceptedPackageDryRun,
} from './npm-buffer-publisher.mjs';
import {
  assertVerifiedReleaseArtifacts,
  readVerifiedPackageArtifactBytes,
  verifyPackageArtifact,
  verifyPackageArtifactBytes,
} from './release-artifacts.mjs';
import {
  createRegistryProvenanceExpectation,
  slsaProvenanceV1,
  verifyRegistryProvenance,
} from './provenance.mjs';
import semver from '../../../../packages/toolkit/utils/compiled/semver/index.js';
import validationKit from '../../../lib/validation-kit.js';

const { assertNonEmptyString, assertPlainObject, isPlainObject } = validationKit;
const execFileAsync = promisify(execFile);

// This code-reviewed checkpoint is deliberately independent of mutable npm
// packuments; only the listed legacy identities may bypass provenance.
const registrySourceChronologyPolicies = Object.freeze({
  '@bleedingdev/modern-js-create': Object.freeze({
    cutoverAnchor: Object.freeze({
      integrity:
        'sha512-fK3mRQR/eyTRdgvuRb+Scg8lWS2ijqhAPy/d97SoRJ+12yFZHD/e4JWTQZcm9zxkOJn0kp4BJypVjwtlI63L6Q==',
      publishedAt: '2026-05-16T21:22:57.171Z',
      sourceCommit: '846d489312f17f48c5bfbf88d1d16164ffd6f465',
      version: '3.2.0-ultramodern.1',
    }),
    grandfatheredVersions: Object.freeze([
      Object.freeze({
        integrity:
          'sha512-+ZyvnxrZouvlF5yqdw6rbtEB/+X8GJJLrBNzKVZhN7aSjYbBI1nVgugRE0IogCNtyQzibOfakbeWNKwKtEI62Q==',
        publishedAt: '2026-05-16T14:50:19.166Z',
        version: '3.2.0-ultramodern.0',
      }),
    ]),
  }),
});

function isTransientNpmPublishError(error) {
  const output = [
    error instanceof Error ? error.message : '',
    typeof error?.stdout === 'string' ? error.stdout : '',
    typeof error?.stderr === 'string' ? error.stderr : '',
  ].join('\n');

  return transientNpmPublishErrorPatterns.some(pattern => pattern.test(output));
}

const maxVerificationConcurrency = 8;
const chronologyVerificationConcurrency = 8;

function resolveVerificationConcurrency(options) {
  const requested = Number(options?.publishConcurrency);
  if (!Number.isInteger(requested) || requested < 1) {
    return 1;
  }
  return Math.min(requested, maxVerificationConcurrency);
}

async function mapWithConcurrency(items, limit, mapper) {
  const entries = [...items];
  const results = new Array(entries.length);
  const workers = Math.min(Math.max(1, limit), entries.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(entries[index], index);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

function packSourcePackage(packageName, packDir) {
  const before = new Set(fs.readdirSync(packDir));
  run(
    'pnpm',
    ['--filter', packageName, 'pack', '--pack-destination', packDir],
    {
      stdio: 'pipe',
    },
  );
  const after = fs.readdirSync(packDir);
  const created = after.filter(
    name => !before.has(name) && name.endsWith('.tgz'),
  );
  if (created.length !== 1) {
    throw new Error(
      `Expected one pack artifact for ${packageName}, got ${created.length}`,
    );
  }
  return path.join(packDir, created[0]);
}

function extractTarball(tarball, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', targetDir], { stdio: 'pipe' });
  return path.join(targetDir, 'package');
}

async function packageExists(packageName, version) {
  return (await lookupRegistryPackageDist(packageName, version)) !== null;
}

async function resolveRegistryDistTag(packageName, tag) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', packageName, 'dist-tags', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  const distTags = JSON.parse(stdout);
  if (!distTags || typeof distTags !== 'object' || Array.isArray(distTags)) {
    throw new Error(`${packageName} returned invalid registry dist-tags`);
  }
  return typeof distTags[tag] === 'string' ? distTags[tag] : undefined;
}

async function resolveRegistryPackageDist(packageName, version) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', `${packageName}@${version}`, 'dist', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  const dist = JSON.parse(stdout);
  if (!dist || typeof dist !== 'object' || Array.isArray(dist)) {
    throw new Error(
      `${packageName}@${version} returned invalid registry dist metadata`,
    );
  }
  return dist;
}

function isRegistryNotFoundError(error) {
  const output = [
    error instanceof Error ? error.message : '',
    typeof error?.stdout === 'string' ? error.stdout : '',
    typeof error?.stderr === 'string' ? error.stderr : '',
  ].join('\n');
  return (
    /\bE404\b/u.test(output) ||
    /404 Not Found/u.test(output) ||
    /is not in this registry/u.test(output)
  );
}

async function lookupRegistryDistTag(packageName, tag) {
  try {
    return await resolveRegistryDistTag(packageName, tag);
  } catch (error) {
    if (isRegistryNotFoundError(error)) {
      return undefined;
    }
    throw new Error(
      `Registry dist-tag state is uncertain for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function lookupRegistryPackageDist(packageName, version) {
  try {
    return await resolveRegistryPackageDist(packageName, version);
  } catch (error) {
    if (isRegistryNotFoundError(error)) {
      return null;
    }
    throw new Error(
      `Registry state is uncertain for ${packageName}@${version}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function pinnedRegistryPackageMetadataUrl(packageName) {
  assertNonEmptyString(packageName, 'Registry package name');
  return `${npmRegistryOrigin}/${encodeURIComponent(packageName)}`;
}

async function fetchRegistryPackageMetadata(
  packageName,
  fetchImpl = globalThis.fetch,
) {
  const metadataUrl = pinnedRegistryPackageMetadataUrl(packageName);
  if (typeof fetchImpl !== 'function') {
    throw new Error(`${packageName} registry metadata fetch is unavailable`);
  }
  let response;
  try {
    response = await fetchImpl(metadataUrl, {
      headers: { accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(
      `${packageName} registry metadata request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (!response?.ok) {
    throw new Error(
      `${packageName} registry metadata returned HTTP ${String(
        response?.status ?? '<unknown>',
      )}`,
    );
  }
  if (typeof response.json !== 'function') {
    throw new Error(`${packageName} registry metadata response is malformed`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${packageName} registry metadata is not valid JSON`, {
      cause: error,
    });
  }
}

const registryPackumentAttempts = 4;
const registryPackumentRetryDelayMs = 1000;
const throttledRegistryMetadataMarker = 'registry metadata stayed throttled';
const registryMetadataStatusPattern =
  /registry metadata returned HTTP (\d{3})$/u;

function registryMetadataStatus(error) {
  const match = registryMetadataStatusPattern.exec(
    error instanceof Error ? error.message : '',
  );
  return match ? Number(match[1]) : undefined;
}

function isRegistryMetadataNotFoundError(error) {
  return registryMetadataStatus(error) === 404;
}

function isTransientRegistryMetadataError(error) {
  const status = registryMetadataStatus(error);
  if (status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }
  return isTransientNpmPublishError(error);
}

function isThrottledRegistryMetadataError(error) {
  return (
    error instanceof Error &&
    error.message.includes(throttledRegistryMetadataMarker)
  );
}

async function fetchRegistryPackumentWithRetry(packageName, overrides) {
  const wait = overrides.wait ?? sleep;
  const retryDelayMs = overrides.retryDelayMs ?? registryPackumentRetryDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchRegistryPackageMetadata(packageName, overrides.fetchImpl);
    } catch (error) {
      if (attempt >= registryPackumentAttempts) {
        if (registryMetadataStatus(error) === 429) {
          throw new Error(
            `${packageName} ${throttledRegistryMetadataMarker} after ${registryPackumentAttempts} attempts`,
            { cause: error },
          );
        }
        throw error;
      }
      if (!isTransientRegistryMetadataError(error)) {
        throw error;
      }
      await wait(retryDelayMs * attempt);
    }
  }
}

// Memoized for the process so one packument answers both preflight phases. The
// post-publish propagation poll must keep using lookupRegistryPackageDist:
// a cached packument would never observe the version it is waiting for.
const registryPackumentCache = new Map();

async function lookupRegistryPackument(packageName, overrides = {}) {
  if (overrides.fetchImpl) {
    return fetchRegistryPackumentWithRetry(packageName, overrides);
  }
  let pending = registryPackumentCache.get(packageName);
  if (!pending) {
    pending = fetchRegistryPackumentWithRetry(packageName, overrides).catch(
      error => {
        registryPackumentCache.delete(packageName);
        throw error;
      },
    );
    registryPackumentCache.set(packageName, pending);
  }
  return pending;
}

function registryPackumentDistTag(packument, packageName, tag) {
  const distTags = packument?.['dist-tags'];
  if (!isPlainObject(distTags)) {
    throw new Error(`${packageName} returned invalid registry dist-tags`);
  }
  return typeof distTags[tag] === 'string' ? distTags[tag] : undefined;
}

// `null` is reserved for a genuinely absent version; a malformed versions map
// or a version entry without usable dist metadata must throw so it can never
// be mistaken for "not published yet".
function registryPackumentDist(packument, packageName, version) {
  const versions = packument?.versions;
  if (!isPlainObject(versions)) {
    throw new Error(
      `${packageName} returned invalid registry versions metadata`,
    );
  }
  if (!Object.hasOwn(versions, version)) {
    return null;
  }
  const dist = versions[version]?.dist;
  if (!isPlainObject(dist)) {
    throw new Error(
      `${packageName}@${version} registry version entry has no dist metadata`,
    );
  }
  return dist;
}

function parseRegistryTimestamp(value, label) {
  assertNonEmptyString(value, label);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO-8601 timestamp`);
  }
  return timestamp;
}

function registrySourceChronologyPolicy(packageName) {
  const policy = registrySourceChronologyPolicies[packageName];
  if (!policy) {
    throw new Error(
      `${packageName} has no independently maintained registry provenance chronology policy`,
    );
  }
  return policy;
}

function assertPinnedRegistryChronologyEntry(
  entry,
  expected,
  packageName,
  label,
) {
  if (entry.version !== expected.version) {
    throw new Error(
      `${packageName} registry ${label} expected version ${expected.version}, found ${entry.version}`,
    );
  }
  if (entry.publishedAt !== expected.publishedAt) {
    throw new Error(
      `${packageName}@${entry.version} registry ${label} publication time must be ${expected.publishedAt}`,
    );
  }
  assertPlainObject(
    entry.published.dist,
    `${packageName}@${entry.version} registry dist metadata`,
  );
  if (entry.published.dist.integrity !== expected.integrity) {
    throw new Error(
      `${packageName}@${entry.version} registry ${label} integrity does not match the independently maintained chronology`,
    );
  }
}

function registryVersionChronology(metadata, packageName) {
  assertPlainObject(metadata, `${packageName} registry metadata`);
  if (metadata.name !== packageName) {
    throw new Error(
      `${packageName} registry metadata identifies package ${String(metadata.name)}`,
    );
  }
  assertPlainObject(metadata.versions, `${packageName} registry versions`);
  assertPlainObject(metadata.time, `${packageName} registry time metadata`);
  const versionNames = Object.keys(metadata.versions).sort();
  const timeVersionNames = Object.keys(metadata.time)
    .filter(name => name !== 'created' && name !== 'modified')
    .sort();
  const versionNameSet = new Set(versionNames);
  const timeVersionNameSet = new Set(timeVersionNames);
  const versionsMissingTime = versionNames.filter(
    version => !timeVersionNameSet.has(version),
  );
  const timesMissingVersion = timeVersionNames.filter(
    version => !versionNameSet.has(version),
  );
  if (versionsMissingTime.length > 0 || timesMissingVersion.length > 0) {
    throw new Error(
      `${packageName} registry versions/time metadata disagree: versions missing from time [${versionsMissingTime.join(
        ', ',
      )}]; time versions missing from versions [${timesMissingVersion.join(', ')}]`,
    );
  }
  const created = parseRegistryTimestamp(
    metadata.time.created,
    `${packageName} registry creation time`,
  );
  const modified = parseRegistryTimestamp(
    metadata.time.modified,
    `${packageName} registry modification time`,
  );
  if (created > modified) {
    throw new Error(`${packageName} registry time metadata is out of order`);
  }

  const entries = Object.entries(metadata.versions).map(
    ([version, published], originalIndex) => {
      assertNonEmptyString(version, `${packageName} registry version`);
      assertPlainObject(
        published,
        `${packageName}@${version} registry version metadata`,
      );
      if (published.name !== packageName || published.version !== version) {
        throw new Error(
          `${packageName}@${version} registry version identity is inconsistent`,
        );
      }
      const publishedAt = metadata.time[version];
      const timestamp = parseRegistryTimestamp(
        publishedAt,
        `${packageName}@${version} registry publication time`,
      );
      if (timestamp < created || timestamp > modified) {
        throw new Error(
          `${packageName}@${version} registry publication time is outside the package lifetime`,
        );
      }
      return { originalIndex, published, publishedAt, timestamp, version };
    },
  );
  if (entries.length === 0) {
    throw new Error(`${packageName} registry metadata has no version ledger`);
  }
  entries.sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.originalIndex - right.originalIndex,
  );
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].timestamp === entries[index].timestamp) {
      throw new Error(
        `${packageName} registry version chronology is ambiguous at ${entries[index].publishedAt}`,
      );
    }
  }
  return entries;
}

function declaresSlsaV1Provenance(published) {
  return (
    published?.dist?.attestations?.provenance?.predicateType ===
    slsaProvenanceV1
  );
}

const registryProvenanceStatusPattern =
  /registry provenance returned HTTP (\d{3})$/u;

// A throttled attestation response carries no information about whether the
// version is provenanced, so it must never be reported as missing provenance.
function isThrottledRegistryProvenanceError(error) {
  const match = registryProvenanceStatusPattern.exec(
    error instanceof Error ? error.message : '',
  );
  return match ? Number(match[1]) === 429 : false;
}

const registryProvenanceRetryAttempts = 4;
const registryProvenanceRetryDelayMs = 1000;

// Bounded backoff for throttled attestation reads; anything still throttled
// after the last attempt propagates so the chronology gate stays fail-closed.
async function retryThrottledProvenance(operation, wait = sleep) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= registryProvenanceRetryAttempts ||
        !isThrottledRegistryProvenanceError(error)
      ) {
        throw error;
      }
      await wait(registryProvenanceRetryDelayMs * attempt);
    }
  }
}

function historicalProvenanceExpectation(expectation) {
  return {
    certificateIdentity: expectation.certificateIdentity,
    issuer: expectation.issuer,
    source: { repository: expectation.source.repository },
    workflow: { ...expectation.workflow },
  };
}

async function assertRegistrySourceCommitUnpublished(
  request,
  dependencies = {},
) {
  assertPlainObject(request, 'Registry source-cohort request');
  const {
    env = process.env,
    packageName,
    requestedVersion,
    sourceCommit,
    sourceRepository,
  } = request;
  assertNonEmptyString(packageName, 'Registry source-cohort package name');
  assertNonEmptyString(
    requestedVersion,
    'Registry source-cohort requested version',
  );
  const chronologyPolicy = registrySourceChronologyPolicy(packageName);
  const expectation = createRegistryProvenanceExpectation(
    {
      source: { commit: sourceCommit, repository: sourceRepository },
    },
    env,
  );
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const provenanceVerifier =
    dependencies.verifyRegistryProvenance ?? verifyRegistryProvenance;
  const metadata = await fetchRegistryPackageMetadata(packageName, fetchImpl);
  const chronology = registryVersionChronology(metadata, packageName);
  const { cutoverAnchor, grandfatheredVersions } = chronologyPolicy;
  const cutoverIndex = chronology.findIndex(
    entry => entry.version === cutoverAnchor.version,
  );
  if (cutoverIndex === -1) {
    throw new Error(
      `${packageName} registry chronology is missing independently maintained provenance cutover anchor ${cutoverAnchor.version}`,
    );
  }
  if (cutoverIndex !== grandfatheredVersions.length) {
    throw new Error(
      `${packageName} registry chronology before ${cutoverAnchor.version} is not independently authorized`,
    );
  }
  for (const [index, grandfatheredVersion] of
    grandfatheredVersions.entries()) {
    assertPinnedRegistryChronologyEntry(
      chronology[index],
      grandfatheredVersion,
      packageName,
      'grandfathered version',
    );
  }
  const cutoverEntry = chronology[cutoverIndex];
  assertPinnedRegistryChronologyEntry(
    cutoverEntry,
    cutoverAnchor,
    packageName,
    'provenance cutover anchor',
  );
  if (!declaresSlsaV1Provenance(cutoverEntry.published)) {
    throw new Error(
      `${packageName}@${cutoverAnchor.version} authenticated provenance cutover anchor is missing its SLSA v1 declaration`,
    );
  }
  const requestedIndex = chronology.findIndex(
    entry => entry.version === requestedVersion,
  );
  if (requestedIndex !== -1 && requestedIndex < cutoverIndex) {
    throw new Error(
      `${packageName}@${requestedVersion} predates authenticated registry provenance and cannot be safely reused`,
    );
  }

  const discoveryExpectation = historicalProvenanceExpectation(expectation);
  const cutoverExpectation = {
    ...discoveryExpectation,
    source: {
      ...discoveryExpectation.source,
      commit: cutoverAnchor.sourceCommit,
    },
  };
  const results = await mapWithConcurrency(
    chronology.slice(cutoverIndex),
    chronologyVerificationConcurrency,
    async entry => {
      try {
        if (!declaresSlsaV1Provenance(entry.published)) {
          throw new Error(
            `${packageName}@${entry.version} is missing SLSA v1 provenance after the ${cutoverAnchor.version} cutover`,
          );
        }
        assertPlainObject(
          entry.published.dist,
          `${packageName}@${entry.version} registry dist metadata`,
        );
        const evidence = await retryThrottledProvenance(
          () =>
            provenanceVerifier(
              {
                integrity: entry.published.dist.integrity,
                targetName: packageName,
                version: entry.version,
              },
              entry.published.dist,
              entry.version === requestedVersion
                ? expectation
                : entry.version === cutoverAnchor.version
                  ? cutoverExpectation
                  : discoveryExpectation,
              fetchImpl,
              dependencies.bundleVerifier,
            ),
          dependencies.wait,
        );
        return { entry, evidence };
      } catch (error) {
        if (isThrottledRegistryProvenanceError(error)) {
          return {
            entry,
            error: new Error(
              `${packageName}@${entry.version} registry provenance is throttled; the published-cohort chronology cannot be authenticated`,
              { cause: error },
            ),
          };
        }
        return { entry, error };
      }
    },
  );
  // Assertions replay in chronology order so the reported failure is the
  // earliest one, exactly as a serial walk would report it.
  for (const { entry, error, evidence } of results) {
    if (error) {
      throw error;
    }
    if (
      entry.version === cutoverAnchor.version &&
      evidence.sourceCommit !== cutoverAnchor.sourceCommit
    ) {
      throw new Error(
        `${packageName}@${cutoverAnchor.version} provenance cutover anchor authenticated unexpected source commit ${String(evidence.sourceCommit)}`,
      );
    }
    if (
      entry.version !== requestedVersion &&
      evidence.sourceCommit === expectation.source.commit
    ) {
      throw new Error(
        `Source commit ${expectation.source.commit} is already authenticated and published as ${packageName}@${entry.version}; refusing requested version ${requestedVersion}`,
      );
    }
  }

  return {
    cutover: {
      publishedAt: cutoverEntry.publishedAt,
      version: cutoverEntry.version,
    },
    exactVersionAuthenticated: requestedIndex !== -1,
    grandfatheredCount: cutoverIndex,
    inspectedCount: results.length,
    packageName,
    requestedVersion,
    sourceCommit: expectation.source.commit,
    versionCount: chronology.length,
  };
}

function assertRegistryDistMatches(item, dist) {
  const mismatches = [];
  if (dist?.integrity !== item.integrity) {
    mismatches.push(
      `integrity expected ${item.integrity}, found ${String(dist?.integrity)}`,
    );
  }
  if (dist?.shasum !== item.shasum) {
    mismatches.push(
      `shasum expected ${item.shasum}, found ${String(dist?.shasum)}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Registry artifact identity mismatch for ${item.targetName}@${item.version}: ${mismatches.join(
        '; ',
      )}`,
    );
  }
}

function pinnedRegistryTarballUrl(item, value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    throw new Error(`${item.targetName}@${item.version} is missing dist.tarball`);
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry tarball URL is invalid`,
      { cause: error },
    );
  }
  const packageBaseName = item.targetName.slice(
    item.targetName.lastIndexOf('/') + 1,
  );
  const expectedPath = `/${item.targetName}/-/${packageBaseName}-${item.version}.tgz`;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry tarball URL has invalid encoding`,
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
      `${item.targetName}@${item.version} registry tarball URL is not the pinned npm endpoint ${npmRegistryOrigin}${expectedPath}`,
    );
  }
  return url.href;
}

async function verifyRegistryTarball(
  item,
  dist,
  fetchImpl = globalThis.fetch,
) {
  const packageLabel = `${item.targetName}@${item.version}`;
  const tarballUrl = pinnedRegistryTarballUrl(item, dist?.tarball);
  if (typeof fetchImpl !== 'function') {
    throw new Error(`${packageLabel} registry tarball fetch is unavailable`);
  }
  let response;
  try {
    response = await fetchImpl(tarballUrl, {
      headers: { accept: 'application/octet-stream' },
      method: 'GET',
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(
      `${packageLabel} registry tarball request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (!response?.ok) {
    throw new Error(
      `${packageLabel} registry tarball ${tarballUrl} returned HTTP ${String(
        response?.status ?? '<unknown>',
      )}`,
    );
  }
  if (typeof response.arrayBuffer !== 'function') {
    throw new Error(`${packageLabel} registry tarball response is malformed`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`${packageLabel} registry tarball body could not be read`, {
      cause: error,
    });
  }

  const actual = {
    integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
    size: bytes.length,
  };
  const mismatches = [];
  for (const field of ['size', 'sha256', 'shasum', 'integrity']) {
    if (actual[field] !== item[field]) {
      mismatches.push(
        `${field} expected ${String(item[field])}, found ${String(actual[field])}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Registry tarball byte mismatch for ${packageLabel}: ${mismatches.join(
        '; ',
      )}`,
    );
  }
  return { ...actual, tarballUrl };
}

async function verifyRegistryPackageDist(
  item,
  dist,
  provenanceExpectation,
  registry = {
    assertRegistryDistMatches,
    verifyRegistryProvenance,
    verifyRegistryTarball,
  },
) {
  registry.assertRegistryDistMatches(item, dist);
  await registry.verifyRegistryTarball(item, dist);
  await registry.verifyRegistryProvenance(
    item,
    dist,
    provenanceExpectation,
  );
  return dist;
}

// 36 attempts, front-loaded so a package that is already coherent is accepted
// in seconds. The 35 delays the loop can spend must stay at or above the 350s
// attestation-propagation window npm has needed; this shape spends 360s.
const registryVerificationRetryDelaysMs = Object.freeze([
  2000,
  3000,
  5000,
  5000,
  ...Array.from({ length: 24 }, () => 10000),
  ...Array.from({ length: 8 }, () => 15000),
]);

async function verifyRegistryPackage(
  item,
  provenanceExpectation,
  registry = {
    assertRegistryDistMatches,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
  },
) {
  // npm's attestation propagation regularly exceeds one minute right after
  // publish (observed: attestations endpoint 404s ~60s in, then appears), so
  // the window must comfortably outlast that lag or the cohort aborts on a
  // package that in fact published fine.
  const attempts = registryVerificationRetryDelaysMs.length;
  let lastError = '';
  // Byte identity is established against the manifest-pinned integrity, shasum,
  // and size, none of which change between attempts, so the tarball download is
  // not repeated once it has matched. The dist itself is re-resolved every
  // attempt: a dist without .attestations is exactly what a lagging publish
  // looks like and only a fresh lookup can observe it appear.
  let tarballVerified = false;
  const verifyTarballOnce = async (tarballItem, dist, ...rest) => {
    // Only the byte download is safe to memoize; the dist is re-resolved every
    // attempt, so each one must still prove its tarball URL is the pinned npm
    // endpoint before the memo can vouch for the bytes behind it.
    pinnedRegistryTarballUrl(tarballItem, dist?.tarball);
    if (tarballVerified) {
      return;
    }
    await registry.verifyRegistryTarball(tarballItem, dist, ...rest);
    tarballVerified = true;
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const dist = await registry.lookupRegistryPackageDist(
      item.targetName,
      item.version,
    );
    if (dist === null) {
      lastError = `${item.targetName}@${item.version} is not present in the registry`;
    } else {
      try {
        await registry.verifyRegistryPackageDist(
          item,
          dist,
          provenanceExpectation,
          {
            assertRegistryDistMatches: registry.assertRegistryDistMatches,
            verifyRegistryProvenance: registry.verifyRegistryProvenance,
            verifyRegistryTarball: verifyTarballOnce,
          },
        );
        return dist;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (attempt < attempts) {
      await new Promise(resolve =>
        setTimeout(resolve, registryVerificationRetryDelaysMs[attempt - 1]),
      );
    }
  }

  throw new Error(
    `Published package ${item.targetName}@${item.version} did not verify on npm after ${attempts} attempts: ${lastError}`,
  );
}

async function verifyRegistryDistTag(packageName, tag, version) {
  const resolvedVersion = await lookupRegistryDistTag(packageName, tag);
  if (resolvedVersion !== version) {
    throw new Error(
      `${packageName} dist-tag ${tag} points at ${resolvedVersion ?? '<missing>'}, expected ${version}`,
    );
  }
}

const ultramodernVersionPattern = /^(\d+\.\d+\.\d+)-ultramodern\.([1-9]\d*)$/;

/**
 * A new incorporated Modern.js base restarts the ultramodern revision counter.
 * Carrying the previous base's revision forward (3.8.1-ultramodern.5 ->
 * 3.8.2-ultramodern.6) is still forward semver, so plain ordering accepts it,
 * but it claims a release history the new base never had. A base change must
 * land on the lowest revision the new base has not used yet: normally `.1`,
 * but a cohort attempt that crashes after partially publishing (post-publish
 * verification can abort mid-cohort) leaves members already tagged on the new
 * base. Those exact versions are immutable and pinned to the crashed run's
 * provenance, so they burn their revision for the whole cohort and the
 * recovery cohort publishes at the next free revision instead.
 */
function assertBaseRevisionReset(
  targetName,
  candidate,
  currentTag,
  allowedRevision = '1',
) {
  const candidateMatch = ultramodernVersionPattern.exec(candidate);
  const currentMatch = ultramodernVersionPattern.exec(currentTag);
  if (!candidateMatch || !currentMatch) {
    return;
  }

  const [, candidateBase, candidateRevision] = candidateMatch;
  const [, currentBase] = currentMatch;
  if (!semver.gt(candidateBase, currentBase)) {
    return;
  }

  if (candidateRevision !== allowedRevision) {
    const burnedNote =
      allowedRevision === '1'
        ? ''
        : ` (lower revisions at base ${candidateBase} are burned by a partially published cohort)`;
    throw new Error(
      `${targetName}@${candidate} moves the incorporated Modern.js base from ${currentBase} to ${candidateBase}; the only valid next version on a base change is ${candidateBase}-ultramodern.${allowedRevision}${burnedNote}`,
    );
  }
}

/**
 * The lowest revision the cohort may claim when it moves to a new incorporated
 * base: one past the highest revision any cohort member's current dist-tag
 * already occupies at that base (crash remnants), or `.1` when the base is
 * untouched. A member whose current dist-tag already IS the cohort version is
 * not a remnant — it is this cohort partially placed (a converge re-run after
 * a mid-cohort crash), so that revision stays claimable by the rest of the
 * cohort instead of forcing an endless revision escalation.
 */
function nextBaseChangeRevision(cohortVersion, currentTags) {
  const cohortMatch = ultramodernVersionPattern.exec(cohortVersion ?? '');
  if (!cohortMatch) {
    return '1';
  }
  const [, cohortBase, cohortRevision] = cohortMatch;
  let burned = 0;
  for (const tag of currentTags) {
    const tagMatch = ultramodernVersionPattern.exec(tag ?? '');
    if (!tagMatch || tagMatch[1] !== cohortBase) {
      continue;
    }
    if (tag === cohortVersion) {
      return cohortRevision;
    }
    burned = Math.max(burned, Number(tagMatch[2]));
  }
  return String(burned + 1);
}

async function preflightRegistryPackages(
  publishItems,
  options,
  provenanceExpectation,
  registry = {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    lookupRegistryPackument,
    verifyRegistryPackageDist,
  },
) {
  const failures = [];
  const states = new Map();
  const currentTags = new Map();
  const concurrency = resolveVerificationConcurrency(options);
  const describeFailure = (item, error) =>
    `${item.targetName}@${item.version}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  // One packument answers both phases, so it may only stand in for lookups the
  // caller has not replaced with its own implementations.
  const packumentLookup =
    registry.lookupRegistryDistTag === lookupRegistryDistTag &&
    registry.lookupRegistryPackageDist === lookupRegistryPackageDist
      ? registry.lookupRegistryPackument
      : undefined;
  // `undefined`: no packument, fall back to the npm-view lookups. `null`: the
  // package itself is absent from the registry.
  const readPackument = async packageName => {
    if (!packumentLookup) {
      return undefined;
    }
    try {
      return await packumentLookup(packageName);
    } catch (error) {
      if (isRegistryMetadataNotFoundError(error)) {
        return null;
      }
      if (isThrottledRegistryMetadataError(error)) {
        throw error;
      }
      return undefined;
    }
  };

  const tagResults = await mapWithConcurrency(
    publishItems,
    concurrency,
    async item => {
      try {
        const packument = await readPackument(item.targetName);
        if (packument === undefined) {
          return {
            currentTag: await registry.lookupRegistryDistTag(
              item.targetName,
              options.tag,
            ),
          };
        }
        return {
          currentTag:
            packument === null
              ? undefined
              : registryPackumentDistTag(
                  packument,
                  item.targetName,
                  options.tag,
                ),
        };
      } catch (error) {
        return { error };
      }
    },
  );
  // The base-change revision may only be computed once every member's current
  // tag is known, so this barrier stays between the two phases.
  for (const [index, item] of publishItems.entries()) {
    const result = tagResults[index];
    if (result.error) {
      failures.push(describeFailure(item, result.error));
      continue;
    }
    currentTags.set(item.targetName, result.currentTag);
  }
  const allowedBaseChangeRevision = nextBaseChangeRevision(
    options.version,
    currentTags.values(),
  );
  const stateResults = await mapWithConcurrency(
    publishItems,
    concurrency,
    async item => {
      if (!currentTags.has(item.targetName)) {
        return { skipped: true };
      }
      try {
        const currentTag = currentTags.get(item.targetName);
        const packument = await readPackument(item.targetName);
        let dist;
        if (packument === undefined) {
          dist = await registry.lookupRegistryPackageDist(
            item.targetName,
            item.version,
          );
        } else {
          dist =
            packument === null
              ? null
              : registryPackumentDist(packument, item.targetName, item.version);
        }
        if (dist !== null) {
          await registry.verifyRegistryPackageDist(
            item,
            dist,
            provenanceExpectation,
          );
          if (currentTag !== item.version) {
            throw new Error(
              `${item.targetName} dist-tag ${options.tag} points at ${currentTag ?? '<missing>'}, expected ${item.version}`,
            );
          }
          return { state: { currentTag, dist, exists: true } };
        }

        if (currentTag === item.version) {
          throw new Error(
            `${item.targetName} dist-tag ${options.tag} points at ${item.version}, but that exact registry version is absent`,
          );
        }
        if (currentTag !== undefined) {
          if (!semver.valid(item.version) || !semver.valid(currentTag)) {
            throw new Error(
              `${item.targetName} cannot compare candidate ${item.version} with current ${options.tag} ${currentTag} as strict semantic versions`,
            );
          }
          if (!semver.gt(item.version, currentTag)) {
            throw new Error(
              `${item.targetName}@${item.version} must be greater than current ${options.tag} ${currentTag}`,
            );
          }
          assertBaseRevisionReset(
            item.targetName,
            item.version,
            currentTag,
            allowedBaseChangeRevision,
          );
        }
        const prefix = options.dryRun
          ? 'Dry-run registry preflight'
          : 'Registry publish preflight';
        return {
          notice: `${prefix}: ${item.targetName}@${item.version} is absent; provenance equivalence cannot be asserted before publication. Current ${options.tag}: ${currentTag ?? '<missing>'}.`,
          state: { currentTag, dist: null, exists: false },
        };
      } catch (error) {
        return { error };
      }
    },
  );
  for (const [index, item] of publishItems.entries()) {
    const result = stateResults[index];
    if (result.skipped) {
      continue;
    }
    if (result.error) {
      failures.push(describeFailure(item, result.error));
      continue;
    }
    states.set(item.targetName, result.state);
    if (result.notice) {
      console.log(result.notice);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      [
        `Registry publish preflight failed for ${options.version}.`,
        ...failures,
      ].join('\n'),
    );
  }
  return states;
}

async function publishPackage(
  artifact,
  options,
  overrides = {},
) {
  const registry = {
    assertRegistryDistMatches,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
    ...overrides.registry,
  };
  const artifactReader =
    overrides.artifactReader ?? readVerifiedPackageArtifactBytes;
  const acceptedBytes = Buffer.from(
    artifactReader(artifact, artifact.artifactPath),
  );
  const publishAcceptedPackageImpl =
    overrides.publishAcceptedPackage ?? publishAcceptedPackage;
  const validateAcceptedPackageDryRunImpl =
    overrides.validateAcceptedPackageDryRun ?? validateAcceptedPackageDryRun;
  const wait = overrides.wait ?? sleep;
  const maxAttempts = options.dryRun ? 1 : npmPublishAttempts;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const acceptedArtifact = verifyPackageArtifactBytes(
      artifact,
      acceptedBytes,
    );
    try {
      try {
        if (options.dryRun) {
          await validateAcceptedPackageDryRunImpl(
            acceptedArtifact,
            acceptedBytes,
            options,
          );
        } else {
          await publishAcceptedPackageImpl(
            acceptedArtifact,
            acceptedBytes,
            options,
          );
        }
      } finally {
        verifyPackageArtifactBytes(artifact, acceptedBytes);
      }
    } catch (error) {
        if (!options.dryRun && options.provenanceExpectation) {
          const dist = await registry.lookupRegistryPackageDist(
            artifact.targetName,
            artifact.version,
          );
          if (dist !== null) {
            await registry.verifyRegistryPackageDist(
              artifact,
              dist,
              options.provenanceExpectation,
              {
                assertRegistryDistMatches: registry.assertRegistryDistMatches,
                verifyRegistryProvenance: registry.verifyRegistryProvenance,
                verifyRegistryTarball: registry.verifyRegistryTarball,
              },
            );
            console.log(
              `Reusing byte-identical ${artifact.targetName}@${artifact.version} after npm publish returned an error`,
            );
            return artifact.targetName;
          }
        }

        const shouldRetry =
          attempt < maxAttempts && isTransientNpmPublishError(error);
        if (!shouldRetry) {
          throw error;
        }

        console.warn(
          `npm publish for ${artifact.targetName}@${artifact.version} failed with a transient registry/provenance error; retrying attempt ${
            attempt + 1
          }/${maxAttempts} in ${npmPublishRetryDelayMs}ms.`,
        );
        await wait(npmPublishRetryDelayMs);
        continue;
    }

    return artifact.targetName;
  }
  return artifact.targetName;
}

const cohortVerificationFailureBudget = 3;

async function validateRegistryCohort(
  manifest,
  options,
  registry = { verifyRegistryDistTag, verifyRegistryPackage },
) {
  if (options.dryRun) {
    console.log('Skipping final registry cohort assertion for dry-run publish');
    return;
  }

  const provenanceExpectation =
    createRegistryProvenanceExpectation(manifest);
  let failureCount = 0;
  const outcomes = await mapWithConcurrency(
    manifest.packages,
    resolveVerificationConcurrency(options),
    async item => {
      // Every member keeps its full propagation window, but once this many have
      // definitively failed the cohort cannot become coherent, so the remaining
      // windows would only burn the job timeout.
      if (failureCount >= cohortVerificationFailureBudget) {
        return { unverified: true };
      }
      try {
        await registry.verifyRegistryPackage(item, provenanceExpectation);
        await registry.verifyRegistryDistTag(
          item.targetName,
          options.tag,
          manifest.release.version,
        );
        return {};
      } catch (error) {
        failureCount += 1;
        return { error };
      }
    },
  );

  const failures = [];
  let unverified = 0;
  for (const [index, item] of manifest.packages.entries()) {
    const outcome = outcomes[index];
    if (outcome.unverified) {
      unverified += 1;
      continue;
    }
    if (outcome.error) {
      failures.push(
        `${item.targetName}@${manifest.release.version}: ${
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Registry cohort validation failed for ${manifest.release.version}.`,
        `The ${options.tag} dist-tag is not coherent for the full cohort.`,
        ...failures,
        ...(unverified > 0
          ? [
              `Stopped after ${cohortVerificationFailureBudget} failed members; ${unverified} remaining member(s) were left unverified.`,
            ]
          : []),
      ].join('\n'),
    );
  }
}

async function publishManifestPackages(
  releaseArtifacts,
  options,
  overrides = {},
) {
  const registry = {
    assertRegistryDistMatches,
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    lookupRegistryPackument,
    preflightTrustedPublishingPackages,
    preflightRegistryPackages,
    publishPackage,
    validateRegistryCohort,
    verifyPackageArtifact,
    verifyRegistryDistTag,
    verifyRegistryPackage,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
    ...overrides,
  };
  assertVerifiedReleaseArtifacts(releaseArtifacts);
  const { manifest } = releaseArtifacts;
  if (
    manifest.release.version !== options.version ||
    manifest.release.tag !== options.tag
  ) {
    throw new Error(
      `Verified release ${manifest.release.version} (${manifest.release.tag}) does not match publish request ${options.version} (${options.tag})`,
    );
  }
  const provenanceExpectation =
    createRegistryProvenanceExpectation(manifest);

  const artifactsByTarget = new Map(
    releaseArtifacts.packages.map(item => [item.targetName, item]),
  );
  const publishItems = manifest.publishOrder.map(targetName => {
    const artifact = artifactsByTarget.get(targetName);
    if (!artifact) {
      throw new Error(`Verified release is missing artifact ${targetName}`);
    }
    return artifact;
  });

  for (const artifact of publishItems) {
    registry.verifyPackageArtifact(artifact, artifact.artifactPath);
  }
  const preflight = await registry.preflightRegistryPackages(
    publishItems,
    options,
    provenanceExpectation,
    {
      lookupRegistryDistTag: registry.lookupRegistryDistTag,
      lookupRegistryPackageDist: registry.lookupRegistryPackageDist,
      lookupRegistryPackument: registry.lookupRegistryPackument,
      verifyRegistryPackageDist: registry.verifyRegistryPackageDist,
    },
  );
  const absentPublishItems = publishItems.filter(
    item => !preflight.get(item.targetName)?.exists,
  );
  if (!options.dryRun && absentPublishItems.length > 0) {
    await registry.preflightTrustedPublishingPackages(
      absentPublishItems,
      options,
      overrides.trustedPublishing,
    );
  }

  console.log(
    `Publishing ${publishItems.length} immutable package artifact(s) in dependency order`,
  );
  if (options.publishConcurrency !== 1) {
    console.log(
      `Publish concurrency ${options.publishConcurrency} applies to registry verification only; full-cohort packages publish sequentially so dependency tarballs are fetchable before consumers.`,
    );
  }
  for (const artifact of publishItems) {
    const state = preflight.get(artifact.targetName);
    if (!state) {
      throw new Error(
        `Registry preflight omitted ${artifact.targetName}@${artifact.version}`,
      );
    }
    if (!options.dryRun && state.exists) {
      console.log(
        `Reusing byte-identical ${artifact.targetName}@${artifact.version} for full-cohort publish`,
      );
      continue;
    }

    const publishedName = await registry.publishPackage(artifact, {
      ...options,
      acceptedTools: manifest.tools,
      provenanceExpectation,
    });
    console.log(
      options.dryRun
        ? `Dry-run validated ${publishedName}@${artifact.version}`
        : `Published ${publishedName}@${artifact.version}`,
    );
    registry.verifyPackageArtifact(artifact, artifact.artifactPath);
  }

  if (!options.dryRun) {
    await registry.validateRegistryCohort(manifest, options, {
      verifyRegistryDistTag: registry.verifyRegistryDistTag,
      verifyRegistryPackage: registry.verifyRegistryPackage,
    });
  }
}

export {
  assertRegistrySourceCommitUnpublished,
  assertRegistryDistMatches,
  createRegistryProvenanceExpectation,
  extractTarball,
  isRegistryNotFoundError,
  isTransientNpmPublishError,
  lookupRegistryDistTag,
  lookupRegistryPackageDist,
  lookupRegistryPackument,
  mapWithConcurrency,
  packSourcePackage,
  packageExists,
  preflightRegistryPackages,
  publishManifestPackages,
  publishPackage,
  registryVerificationRetryDelaysMs,
  validateRegistryCohort,
  verifyRegistryDistTag,
  verifyRegistryPackage,
  verifyRegistryPackageDist,
  verifyRegistryProvenance,
  verifyRegistryTarball,
};
