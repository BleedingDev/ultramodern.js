// Consumer: publish-sidecars.mjs, the pre-cohort trusted-publishing lane.
//
// The cohort package @bleedingdev/modern-js-image pins its sidecars through
// `npm:@bleedingdev/<name>@<exact version>` alias specifiers. npm resolves an
// alias by fetching that exact version, so the cohort is unresolvable until
// every sidecar version already exists on the registry. This module owns the
// decisions that make a pre-cohort publish lane safe to re-run:
//
//   * the staged sidecar lane is validated offline (shape, order, identity)
//     before anything touches the network;
//   * an already-published EXACT version is reused only when the registry copy
//     resolves identically to the staged copy - every other registry state
//     (content drift, an absent version the dist-tag claims, a dist-tag that
//     points elsewhere, a backwards republish) fails closed.
//
// Nothing here publishes, packs, or mutates state; the CLI wires these
// decisions to the npm buffer publisher.
import path from 'node:path';
import semver from '../../../../packages/toolkit/utils/compiled/semver/index.js';
import validationKit from '../../../lib/validation-kit.js';
import {
  npmRegistryOrigin,
  sidecarAliasConsumerTargetName,
  sidecarManifestSchema,
  sidecarManifestSchemaVersion,
  sidecarScope,
  sidecarTarballsDirectory,
  trustedPublishRef,
  trustedPublishRepository,
} from './constants.mjs';
import { normalizeSidecarBin, sidecarAliasEntries } from './sidecars.mjs';

const { assertNonEmptyString, assertPlainObject, isPlainObject } = validationKit;

const npmRegistryUrl = `${npmRegistryOrigin}/`;
const stableVersionPattern = /^\d+\.\d+\.\d+$/u;

// Only `latest` ships. Trusted-publishing OIDC cannot mutate dist-tags, so the
// tag a sidecar is published under is the only tag it will ever carry.
const sidecarPublishTag = 'latest';

// The fields that decide how a consumer RESOLVES the sidecar. If the registry
// copy of an exact version differs from the staged copy in any of these, the
// published package is not the package this run staged and the lane must stop.
const sidecarResolutionFields = Object.freeze([
  'bin',
  'cpu',
  'dependencies',
  'engines',
  'exports',
  'main',
  'module',
  'optionalDependencies',
  'os',
  'peerDependencies',
  'peerDependenciesMeta',
  'sideEffects',
  'type',
  'types',
  'typesVersions',
]);

// Fields npm normalizes, rewrites, or drops on the registry copy (a string
// `repository` becomes an object, `readme`/`gitHead`/`dist` are injected), so
// they can never be compared byte-for-byte - and none of them changes
// resolution. `name` and `version` are compared explicitly instead.
const sidecarIgnoredFields = Object.freeze([
  'author',
  'browser',
  'bugs',
  'contributors',
  'description',
  'devDependencies',
  'files',
  'funding',
  'homepage',
  'keywords',
  'license',
  'man',
  'name',
  'private',
  'publishConfig',
  'readme',
  'repository',
  'scripts',
  'version',
]);

const resolutionFieldSet = new Set(sidecarResolutionFields);
const ignoredFieldSet = new Set(sidecarIgnoredFields);

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

/**
 * Every staged field must be explicitly classified as resolution-critical or
 * npm-normalized. An unclassified field fails closed so a future sidecar cannot
 * quietly widen what "identical content" means.
 */
function sidecarContentProjection(packageJson, label) {
  assertPlainObject(packageJson, label);
  const unclassified = Object.keys(packageJson)
    .filter(key => !resolutionFieldSet.has(key) && !ignoredFieldSet.has(key))
    .sort();
  if (unclassified.length > 0) {
    throw new Error(
      [
        `${label} declares field(s) the sidecar publication gate does not classify: ${unclassified.join(', ')}.`,
        'Add each field to sidecarResolutionFields (it changes resolution) or sidecarIgnoredFields (npm normalizes it) before publishing.',
      ].join('\n'),
    );
  }
  return registryContentProjection(packageJson, packageJson.name);
}

/**
 * The same projection taken from a registry packument version entry, which
 * legitimately carries extra npm-owned fields (`dist`, `_id`, `gitHead`, ...).
 */
function registryContentProjection(source, name) {
  const projection = {};
  for (const field of sidecarResolutionFields) {
    if (!Object.hasOwn(source, field)) {
      continue;
    }
    projection[field] =
      field === 'bin'
        ? (normalizeSidecarBin({ bin: source.bin, name }) ?? null)
        : source[field];
  }
  return projection;
}

function assertStableSidecarVersion(name, version) {
  if (typeof version !== 'string' || !stableVersionPattern.test(version)) {
    throw new Error(
      `Sidecar ${name} version ${String(version)} must be stable semver (X.Y.Z) to publish`,
    );
  }
}

/**
 * The registry a sidecar may be published to. `@bleedingdev/ipx` carries an
 * explicit `publishConfig.registry`; anything but the pinned npm endpoint, or
 * any attempt to pin a dist-tag from inside the package, fails closed.
 */
function assertSidecarPublishTarget(packageJson, label) {
  assertPlainObject(packageJson, label);
  if (Object.hasOwn(packageJson, 'tag')) {
    throw new Error(`${label} must not declare a top-level tag`);
  }
  const publishConfig = packageJson.publishConfig;
  if (publishConfig !== undefined && !isPlainObject(publishConfig)) {
    throw new Error(`${label} publishConfig must be an object`);
  }
  if (publishConfig?.access !== 'public') {
    throw new Error(`${label} must declare publishConfig.access "public"`);
  }
  if (Object.hasOwn(publishConfig, 'tag')) {
    throw new Error(
      `${label} publishConfig must not pin a dist-tag; the cohort ships ${sidecarPublishTag} only`,
    );
  }
  if (
    Object.hasOwn(publishConfig, 'registry') &&
    publishConfig.registry !== npmRegistryUrl
  ) {
    throw new Error(
      `${label} publishConfig.registry ${String(publishConfig.registry)} is not the pinned ${npmRegistryUrl}`,
    );
  }
  if (packageJson.private) {
    throw new Error(`${label} must not be private`);
  }
  return packageJson;
}

/**
 * Validate the sidecars.json the staging lane wrote, offline: schema, the
 * publish-before contract, identity, and the alias ordering that makes
 * @bleedingdev/image-size reach the registry before the
 * @bleedingdev/rsbuild-image-core fork that aliases it.
 */
function assertSidecarStagingManifest(
  manifest,
  { publishBefore = sidecarAliasConsumerTargetName } = {},
) {
  assertPlainObject(manifest, 'Sidecar staging manifest');
  const manifestKeys = Object.keys(manifest).sort();
  const expectedManifestKeys = [
    'packages',
    'publishBefore',
    'publishOrder',
    'schema',
    'schemaVersion',
  ];
  if (canonicalJson(manifestKeys) !== canonicalJson(expectedManifestKeys)) {
    throw new Error(
      `Sidecar staging manifest has unknown or missing fields: ${manifestKeys.join(', ')}`,
    );
  }
  if (
    manifest.schema !== sidecarManifestSchema ||
    manifest.schemaVersion !== sidecarManifestSchemaVersion
  ) {
    throw new Error(
      `Unknown sidecar staging manifest schema ${String(manifest.schema)}@${String(manifest.schemaVersion)}`,
    );
  }
  if (manifest.publishBefore !== publishBefore) {
    throw new Error(
      `Sidecar staging manifest must publish before ${publishBefore}, found ${String(manifest.publishBefore)}`,
    );
  }
  if (!Array.isArray(manifest.publishOrder) || !Array.isArray(manifest.packages)) {
    throw new Error(
      'Sidecar staging manifest must carry publishOrder and packages arrays',
    );
  }
  if (manifest.packages.length === 0) {
    throw new Error('Sidecar staging manifest stages no packages');
  }

  const expectedEntryKeys = [
    'fileCount',
    'fileListSha256',
    'integrity',
    'name',
    'packageJsonSha256',
    'root',
    'sha256',
    'shasum',
    'size',
    'tarballPath',
    'unpackedSize',
    'version',
  ];
  const seen = new Set();
  const seenTarballs = new Set();
  for (const [index, entry] of manifest.packages.entries()) {
    assertPlainObject(entry, `Sidecar staging entry ${index}`);
    const entryKeys = Object.keys(entry).sort();
    if (canonicalJson(entryKeys) !== canonicalJson(expectedEntryKeys)) {
      throw new Error(
        `Sidecar staging entry ${index} has unknown or missing fields: ${entryKeys.join(', ')}`,
      );
    }
    assertNonEmptyString(entry.name, `Sidecar staging entry ${index} name`);
    assertNonEmptyString(entry.root, `Sidecar ${entry.name} staging root`);
    assertNonEmptyString(
      entry.tarballPath,
      `Sidecar ${entry.name} tarball path`,
    );
    if (!entry.name.startsWith(`${sidecarScope}/`)) {
      throw new Error(
        `Sidecar ${entry.name} must be published under ${sidecarScope}`,
      );
    }
    if (entry.name.slice(sidecarScope.length + 1).startsWith('modern-js-')) {
      throw new Error(
        `Sidecar ${entry.name} must not carry the Modern.js cohort prefix; sidecars are not cohort members`,
      );
    }
    assertStableSidecarVersion(entry.name, entry.version);
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate sidecar ${entry.name} in the staging manifest`);
    }
    seen.add(entry.name);
    if (seenTarballs.has(entry.tarballPath)) {
      throw new Error(
        `Duplicate sidecar tarball path ${entry.tarballPath} in the staging manifest`,
      );
    }
    seenTarballs.add(entry.tarballPath);
    if (manifest.publishOrder[index] !== entry.name) {
      throw new Error(
        `Sidecar staging manifest publishOrder[${index}] is ${String(manifest.publishOrder[index])} but packages[${index}] is ${entry.name}`,
      );
    }
    if (
      entry.tarballPath.includes('\\') ||
      path.posix.isAbsolute(entry.tarballPath) ||
      path.posix.normalize(entry.tarballPath) !== entry.tarballPath ||
      !entry.tarballPath.startsWith(`${sidecarTarballsDirectory}/`) ||
      entry.tarballPath.split('/').length !== 2 ||
      !entry.tarballPath.endsWith('.tgz')
    ) {
      throw new Error(
        `Sidecar ${entry.name} has unsafe tarball path ${entry.tarballPath}`,
      );
    }
    for (const field of ['size', 'fileCount', 'unpackedSize']) {
      if (!Number.isSafeInteger(entry[field]) || entry[field] <= 0) {
        throw new Error(`Sidecar ${entry.name} ${field} must be positive`);
      }
    }
    for (const field of ['sha256', 'packageJsonSha256', 'fileListSha256']) {
      if (!/^[a-f0-9]{64}$/u.test(entry[field])) {
        throw new Error(
          `Sidecar ${entry.name} ${field} must be a SHA-256 hex digest`,
        );
      }
    }
    if (!/^[a-f0-9]{40}$/u.test(entry.shasum)) {
      throw new Error(
        `Sidecar ${entry.name} shasum must be an npm SHA-1 hex digest`,
      );
    }
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)) {
      throw new Error(
        `Sidecar ${entry.name} integrity must be a SHA-512 SRI value`,
      );
    }
  }
  if (manifest.publishOrder.length !== manifest.packages.length) {
    throw new Error(
      'Sidecar staging manifest publishOrder and packages disagree in length',
    );
  }
  return manifest;
}

/**
 * A sidecar that aliases another staged sidecar must publish after it.
 * Structural, so it holds for any sidecar set, not just today's three.
 */
function assertSidecarPublishOrder(sidecars) {
  const positions = new Map(
    sidecars.map((sidecar, index) => [sidecar.name, index]),
  );
  for (const [index, sidecar] of sidecars.entries()) {
    for (const entry of sidecarAliasEntries(sidecar.packageJson)) {
      const dependencyIndex = positions.get(entry.target);
      if (dependencyIndex === undefined || dependencyIndex === index) {
        continue;
      }
      if (dependencyIndex > index) {
        throw new Error(
          [
            `Sidecar ${sidecar.name} aliases ${entry.specifier} but ${entry.target} is ordered after it.`,
            'A sidecar alias only resolves once its target version exists on the registry, so the target must publish first.',
          ].join('\n'),
        );
      }
      const dependency = sidecars[dependencyIndex];
      if (dependency.version !== entry.version) {
        throw new Error(
          `Sidecar ${sidecar.name} pins ${entry.specifier} but ${entry.target} stages version ${dependency.version}`,
        );
      }
    }
  }
  return sidecars;
}

/**
 * The exact-version idempotency decision.
 *
 * `publish`  - the exact version is absent and may be created.
 * `reuse`    - the exact version already exists AND resolves identically; a
 *              re-run converges instead of failing on an immutable version.
 * throws     - any other registry state.
 */
function sidecarRegistryDecision(
  sidecar,
  packument,
  { tag = sidecarPublishTag } = {},
) {
  assertPlainObject(sidecar, 'Sidecar publication candidate');
  const { integrity, name, packageJson, shasum, version } = sidecar;
  assertNonEmptyString(name, 'Sidecar publication candidate name');
  assertStableSidecarVersion(name, version);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) {
    throw new Error(`${name} publication candidate integrity is invalid`);
  }
  if (!/^[a-f0-9]{40}$/u.test(shasum)) {
    throw new Error(`${name} publication candidate shasum is invalid`);
  }

  if (packument === null || packument === undefined) {
    return {
      action: 'publish',
      currentTag: undefined,
      name,
      reason: `${name} has never been published`,
      version,
    };
  }

  assertPlainObject(packument, `${name} registry packument`);
  if (packument.name !== name) {
    throw new Error(
      `${name} registry packument identifies package ${String(packument.name)}`,
    );
  }
  const distTags = packument['dist-tags'];
  if (!isPlainObject(distTags)) {
    throw new Error(`${name} returned invalid registry dist-tags`);
  }
  const currentTag =
    typeof distTags[tag] === 'string' ? distTags[tag] : undefined;
  const versions = packument.versions;
  if (!isPlainObject(versions)) {
    throw new Error(`${name} returned invalid registry versions metadata`);
  }

  if (!Object.hasOwn(versions, version)) {
    if (currentTag === version) {
      throw new Error(
        `${name} dist-tag ${tag} points at ${version}, but that exact registry version is absent`,
      );
    }
    if (currentTag !== undefined) {
      if (!semver.valid(currentTag) || !semver.valid(version)) {
        throw new Error(
          `${name} cannot compare candidate ${version} with current ${tag} ${currentTag} as strict semantic versions`,
        );
      }
      if (!semver.gt(version, currentTag)) {
        throw new Error(
          `${name}@${version} must be greater than the current ${tag} ${currentTag}; the sidecar lane never republishes backwards`,
        );
      }
    }
    return {
      action: 'publish',
      currentTag,
      name,
      reason: `${name}@${version} is absent from the registry`,
      version,
    };
  }

  const published = versions[version];
  assertPlainObject(published, `${name}@${version} registry version metadata`);
  if (published.name !== name || published.version !== version) {
    throw new Error(
      `${name}@${version} registry version identity is inconsistent`,
    );
  }
  if (!isPlainObject(published.dist)) {
    throw new Error(`${name}@${version} registry version has invalid dist metadata`);
  }
  const digestDrift = [];
  if (published.dist.integrity !== integrity) {
    digestDrift.push(
      `integrity: staged ${integrity}, registry ${String(published.dist.integrity)}`,
    );
  }
  if (published.dist.shasum !== shasum) {
    digestDrift.push(
      `shasum: staged ${shasum}, registry ${String(published.dist.shasum)}`,
    );
  }
  if (digestDrift.length > 0) {
    throw new Error(
      [
        `${name}@${version} is already published from different tarball bytes; an npm version is immutable, so this lane fails closed instead of reusing it.`,
        'Publish the corrected sidecar under a new stable version and repoint the cohort alias.',
        ...digestDrift,
      ].join('\n'),
    );
  }

  const staged = sidecarContentProjection(
    packageJson,
    `${name}@${version} staged manifest`,
  );
  const registry = registryContentProjection(published, name);
  const drift = [];
  for (const field of sidecarResolutionFields) {
    const stagedValue = canonicalJson(
      Object.hasOwn(staged, field) ? staged[field] : null,
    );
    const registryValue = canonicalJson(
      Object.hasOwn(registry, field) ? registry[field] : null,
    );
    if (stagedValue !== registryValue) {
      drift.push(
        `${field}: staged ${stagedValue}, registry ${registryValue}`,
      );
    }
  }
  if (drift.length > 0) {
    throw new Error(
      [
        `${name}@${version} is already published with different content; an npm version is immutable, so this lane fails closed instead of shadowing it.`,
        'Publish the corrected sidecar under a new stable version and repoint the cohort alias.',
        ...drift,
      ].join('\n'),
    );
  }

  if (currentTag !== version) {
    throw new Error(
      `${name} dist-tag ${tag} points at ${currentTag ?? '<missing>'}, expected the already-published ${version}`,
    );
  }

  return {
    action: 'reuse',
    currentTag,
    name,
    reason: `${name}@${version} is already published from the accepted tarball bytes`,
    version,
  };
}

/**
 * Publishing is only ever reachable from the trusted-publishing workflow on the
 * publish branch of the fork; there is no token path.
 */
function assertSidecarTrustedPublishContext(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'Sidecar publishing is only allowed from the GitHub Actions trusted publishing workflow. Run with --dry-run or --check-staging locally.',
    );
  }
  if (env.GITHUB_REPOSITORY !== trustedPublishRepository) {
    throw new Error(
      `Sidecar publishing is only allowed from ${trustedPublishRepository}.`,
    );
  }
  if (env.GITHUB_REF !== trustedPublishRef) {
    throw new Error(`Sidecar publishing is only allowed from ${trustedPublishRef}.`);
  }
}

export {
  assertSidecarPublishOrder,
  assertSidecarPublishTarget,
  assertSidecarStagingManifest,
  assertSidecarTrustedPublishContext,
  assertStableSidecarVersion,
  canonicalJson,
  npmRegistryUrl,
  registryContentProjection,
  sidecarContentProjection,
  sidecarIgnoredFields,
  sidecarPublishTag,
  sidecarRegistryDecision,
  sidecarResolutionFields,
  sidecarManifestSchema,
  sidecarManifestSchemaVersion,
};
