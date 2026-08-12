// Consumer: publish-bleedingdev.yml immutable manifest, cohort digest, and tarball bundle.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createTemplateRequiredFiles,
  repoRoot,
} from './constants.mjs';
import {
  createPackageDependencyGraph,
  orderPublishItems,
  packageDependenciesFromPackageJson,
} from './manifest.mjs';
import validationKit from '../../../lib/validation-kit.js';

const { assertNonEmptyString, assertPlainObject } = validationKit;
const releaseManifestSchema = 'bleedingdev.ultramodern.release-manifest';
const releaseManifestSchemaVersion = 2;
const releaseManifestFile = 'manifest.json';
const releaseManifestDigestFile = 'manifest.json.sha256';
const releaseCohortDigestFile = 'cohort.sha256';
const releaseCohortProjectionSchema =
  'bleedingdev.ultramodern.release-cohort';
const releaseCohortProjectionSchemaVersion = 1;
const releaseCohortProjectionPath =
  'template-workspace/.modernjs/release-cohort.json';
const tarballsDirectory = 'tarballs';
const verifiedReleaseArtifactsBrand = Symbol('verifiedReleaseArtifacts');

function compareCanonicalStrings(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function canonicalValue(value, label = 'value') {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalValue(item, `${label}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must contain only plain JSON objects`);
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareCanonicalStrings)
        .map(key => [key, canonicalValue(value[key], `${label}.${key}`)]),
    );
  }
  throw new Error(`${label} contains a non-JSON value`);
}

function canonicalJson(value, indentation = 0) {
  return JSON.stringify(canonicalValue(value), null, indentation);
}

function hashBuffer(algorithm, value, encoding = 'hex') {
  return crypto.createHash(algorithm).update(value).digest(encoding);
}

function sha256(value) {
  return hashBuffer('sha256', value);
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort(compareCanonicalStrings);
  const expected = [...expectedKeys].sort(compareCanonicalStrings);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${label} has unknown or missing fields: expected ${expected.join(
        ', ',
      )}; found ${actual.join(', ')}`,
    );
  }
}

function assertSafeInteger(value, label, { positive = false } = {}) {
  const minimum = positive ? 1 : 0;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  }
}

function assertSortedUnique(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }
  const sorted = [...values].sort(compareCanonicalStrings);
  if (
    new Set(values).size !== values.length ||
    canonicalJson(values) !== canonicalJson(sorted)
  ) {
    throw new Error(`${label} must be sorted and contain no duplicates`);
  }
}

function normalizeExpectedNames(values) {
  return [...values].sort(compareCanonicalStrings);
}

function assertSameJson(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match the accepted release identity`);
  }
}

function validateRelativeTarballPath(tarballPath) {
  assertNonEmptyString(tarballPath, 'Release package tarballPath');
  if (
    tarballPath.includes('\\') ||
    path.posix.isAbsolute(tarballPath) ||
    path.posix.normalize(tarballPath) !== tarballPath
  ) {
    throw new Error(
      `Release package tarballPath escapes the artifact root: ${tarballPath}`,
    );
  }
  const segments = tarballPath.split('/');
  if (
    segments.length !== 2 ||
    segments[0] !== tarballsDirectory ||
    !segments[1].endsWith('.tgz')
  ) {
    throw new Error(
      `Release package tarballPath must be tarballs/<file>.tgz: ${tarballPath}`,
    );
  }
}

function cohortIdentity(manifest) {
  return {
    aliases: manifest.aliases,
    cohortProjection: manifest.cohortProjection,
    dependencyGraph: manifest.dependencyGraph,
    packages: manifest.packages,
    publishOrder: manifest.publishOrder,
    release: manifest.release,
    schema: manifest.schema,
    schemaVersion: manifest.schemaVersion,
    source: manifest.source,
    tools: manifest.tools,
  };
}

function createReleaseCohortProjection({ aliases, packages, source, tag, version }) {
  return {
    aliases,
    packages: [...packages]
      .sort((left, right) =>
        compareCanonicalStrings(left.sourceName, right.sourceName),
      )
      .map(item => ({
        sourceName: item.sourceName,
        targetName: item.targetName,
        version: item.version,
      })),
    release: { tag, version },
    schema: releaseCohortProjectionSchema,
    schemaVersion: releaseCohortProjectionSchemaVersion,
    source,
  };
}

function validateReleaseCohortProjection(projection, manifest) {
  assertExactKeys(
    projection,
    ['aliases', 'packages', 'release', 'schema', 'schemaVersion', 'source'],
    'Release cohort projection',
  );
  if (
    projection.schema !== releaseCohortProjectionSchema ||
    projection.schemaVersion !== releaseCohortProjectionSchemaVersion
  ) {
    throw new Error(
      `Unknown release cohort projection schema ${String(
        projection.schema,
      )}@${String(projection.schemaVersion)}`,
    );
  }
  assertSameJson(
    projection,
    createReleaseCohortProjection({
      aliases: manifest.aliases,
      packages: manifest.packages,
      source: manifest.source,
      tag: manifest.release.tag,
      version: manifest.release.version,
    }),
    'Release cohort projection',
  );
  return projection;
}

function computeCohortDigest(manifest) {
  return sha256(canonicalJson(cohortIdentity(manifest)));
}

function validateReleaseManifest(manifest, expected = {}) {
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
      'source',
      'tools',
    ],
    'Release manifest',
  );
  if (
    manifest.schema !== releaseManifestSchema ||
    manifest.schemaVersion !== releaseManifestSchemaVersion
  ) {
    throw new Error(
      `Unknown release manifest schema ${String(manifest.schema)}@${String(
        manifest.schemaVersion,
      )}`,
    );
  }

  assertExactKeys(manifest.source, ['commit', 'repository'], 'source');
  assertNonEmptyString(manifest.source.repository, 'source.repository');
  if (!/^[^/\s]+\/[^/\s]+$/u.test(manifest.source.repository)) {
    throw new Error('source.repository must be an owner/repository identity');
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(manifest.source.commit)) {
    throw new Error('source.commit must be a full Git object ID');
  }

  assertExactKeys(manifest.release, ['tag', 'version'], 'release');
  assertNonEmptyString(manifest.release.version, 'release.version');
  assertNonEmptyString(manifest.release.tag, 'release.tag');

  assertExactKeys(manifest.cohortProjection, ['sha256'], 'cohortProjection');
  if (!/^[a-f0-9]{64}$/u.test(manifest.cohortProjection.sha256)) {
    throw new Error('cohortProjection.sha256 must be a SHA-256 hex digest');
  }

  assertExactKeys(manifest.tools, ['node', 'npm', 'pnpm'], 'tools');
  for (const tool of ['node', 'npm', 'pnpm']) {
    assertNonEmptyString(manifest.tools[tool], `tools.${tool}`);
  }

  assertPlainObject(manifest.aliases, 'aliases');
  const aliasSourceNames = Object.keys(manifest.aliases).sort(
    compareCanonicalStrings,
  );
  if (aliasSourceNames.length === 0) {
    throw new Error('Release manifest aliases must not be empty');
  }
  for (const sourceName of aliasSourceNames) {
    if (!sourceName.startsWith('@modern-js/')) {
      throw new Error(`Invalid release source package ${sourceName}`);
    }
    assertNonEmptyString(manifest.aliases[sourceName], `aliases.${sourceName}`);
  }

  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error('Release manifest packages must be a non-empty array');
  }
  const sourceNames = [];
  const targetNames = [];
  const tarballPaths = [];
  for (const [index, item] of manifest.packages.entries()) {
    const label = `packages[${index}]`;
    assertExactKeys(
      item,
      [
        'fileCount',
        'fileListSha256',
        'integrity',
        'packageJsonSha256',
        'sha256',
        'shasum',
        'size',
        'sourceName',
        'tarballPath',
        'targetName',
        'unpackedSize',
        'version',
      ],
      label,
    );
    for (const field of [
      'sourceName',
      'targetName',
      'version',
      'tarballPath',
    ]) {
      assertNonEmptyString(item[field], `${label}.${field}`);
    }
    if (!item.sourceName.startsWith('@modern-js/')) {
      throw new Error(`${label}.sourceName must use the @modern-js scope`);
    }
    if (manifest.aliases[item.sourceName] !== item.targetName) {
      throw new Error(
        `${item.sourceName} target ${item.targetName} does not match aliases`,
      );
    }
    if (item.version !== manifest.release.version) {
      throw new Error(
        `${item.targetName} version ${item.version} does not match release ${manifest.release.version}`,
      );
    }
    validateRelativeTarballPath(item.tarballPath);
    assertSafeInteger(item.size, `${label}.size`, { positive: true });
    assertSafeInteger(item.fileCount, `${label}.fileCount`, {
      positive: true,
    });
    assertSafeInteger(item.unpackedSize, `${label}.unpackedSize`, {
      positive: true,
    });
    for (const field of [
      'sha256',
      'packageJsonSha256',
      'fileListSha256',
    ]) {
      if (!/^[a-f0-9]{64}$/u.test(item[field])) {
        throw new Error(`${label}.${field} must be a SHA-256 hex digest`);
      }
    }
    if (!/^[a-f0-9]{40}$/u.test(item.shasum)) {
      throw new Error(`${label}.shasum must be an npm SHA-1 hex digest`);
    }
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(item.integrity)) {
      throw new Error(`${label}.integrity must be a SHA-512 SRI value`);
    }
    sourceNames.push(item.sourceName);
    targetNames.push(item.targetName);
    tarballPaths.push(item.tarballPath);
  }

  assertSortedUnique(sourceNames, 'Release package source names');
  if (new Set(targetNames).size !== targetNames.length) {
    throw new Error('Release package target names contain duplicates');
  }
  if (new Set(tarballPaths).size !== tarballPaths.length) {
    throw new Error('Release package tarball paths contain duplicates');
  }
  assertSameJson(sourceNames, aliasSourceNames, 'Release package source names');

  if (expected.sourceNames) {
    assertSameJson(
      sourceNames,
      normalizeExpectedNames(expected.sourceNames),
      'Release manifest package cohort',
    );
  }
  if (expected.aliases) {
    assertSameJson(manifest.aliases, expected.aliases, 'Release aliases');
  }
  if (expected.source) {
    assertSameJson(manifest.source, expected.source, 'Release source');
  }
  if (
    expected.version !== undefined &&
    manifest.release.version !== expected.version
  ) {
    throw new Error(
      `Release manifest version ${manifest.release.version} does not match expected ${expected.version}`,
    );
  }
  if (expected.tag !== undefined && manifest.release.tag !== expected.tag) {
    throw new Error(
      `Release manifest tag ${manifest.release.tag} does not match expected ${expected.tag}`,
    );
  }

  assertPlainObject(manifest.dependencyGraph, 'dependencyGraph');
  const graphTargets = Object.keys(manifest.dependencyGraph).sort(
    compareCanonicalStrings,
  );
  const sortedTargets = [...targetNames].sort(compareCanonicalStrings);
  assertSameJson(graphTargets, sortedTargets, 'Release dependency graph');
  const knownTargets = new Set(targetNames);
  for (const targetName of graphTargets) {
    const dependencies = manifest.dependencyGraph[targetName];
    assertSortedUnique(dependencies, `dependencyGraph.${targetName}`);
    for (const dependency of dependencies) {
      if (!knownTargets.has(dependency) || dependency === targetName) {
        throw new Error(
          `dependencyGraph.${targetName} contains invalid dependency ${dependency}`,
        );
      }
    }
  }

  if (!Array.isArray(manifest.publishOrder)) {
    throw new Error('publishOrder must be an array');
  }
  if (
    manifest.publishOrder.length !== targetNames.length ||
    new Set(manifest.publishOrder).size !== manifest.publishOrder.length ||
    manifest.publishOrder.some(targetName => !knownTargets.has(targetName))
  ) {
    throw new Error(
      'publishOrder must enumerate every release target exactly once',
    );
  }
  const canonicalPublishOrder = orderPublishItems(
    manifest.packages,
    manifest,
  ).map(item => item.targetName);
  assertSameJson(
    manifest.publishOrder,
    canonicalPublishOrder,
    'Release publish order',
  );

  if (!/^[a-f0-9]{64}$/u.test(manifest.cohortDigest)) {
    throw new Error('cohortDigest must be a SHA-256 hex digest');
  }
  const expectedCohortDigest = computeCohortDigest(manifest);
  if (manifest.cohortDigest !== expectedCohortDigest) {
    throw new Error(
      `Release cohort digest mismatch: expected ${expectedCohortDigest}, found ${manifest.cohortDigest}`,
    );
  }

  return manifest;
}

function parseTarNumber(field, label) {
  if ((field[0] & 0x80) !== 0) {
    let value = BigInt(field[0] & 0x7f);
    for (const byte of field.subarray(1)) {
      value = (value << 8n) | BigInt(byte);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return Number(value);
  }

  const text = field
    .toString('ascii')
    .replaceAll('\0', '')
    .trim();
  if (text === '') {
    return 0;
  }
  if (!/^[0-7]+$/u.test(text)) {
    throw new Error(`${label} is not an octal tar value`);
  }
  return Number.parseInt(text, 8);
}

function readTarString(field) {
  const nullIndex = field.indexOf(0);
  return field.subarray(0, nullIndex === -1 ? field.length : nullIndex).toString(
    'utf8',
  );
}

function validateTarChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156), 'tar checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) {
    throw new Error(`Invalid tar header checksum ${expected}; computed ${actual}`);
  }
}

function parsePaxRecords(contents) {
  const records = {};
  let offset = 0;
  while (offset < contents.length) {
    const space = contents.indexOf(32, offset);
    if (space === -1) {
      throw new Error('Malformed PAX record length');
    }
    const lengthText = contents.subarray(offset, space).toString('ascii');
    if (!/^[1-9]\d*$/u.test(lengthText)) {
      throw new Error('Malformed PAX record length');
    }
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > contents.length) {
      throw new Error('PAX record extends past its tar entry');
    }
    const record = contents.subarray(space + 1, end);
    if (record.at(-1) !== 10) {
      throw new Error('PAX record is missing its newline terminator');
    }
    const body = record.subarray(0, -1).toString('utf8');
    const equals = body.indexOf('=');
    if (equals <= 0) {
      throw new Error('Malformed PAX key/value record');
    }
    records[body.slice(0, equals)] = body.slice(equals + 1);
    offset = end;
  }
  return records;
}

function validateArchivePath(archivePath, { directory = false } = {}) {
  if (
    typeof archivePath !== 'string' ||
    archivePath === '' ||
    archivePath.includes('\\') ||
    archivePath.includes('\0') ||
    path.posix.isAbsolute(archivePath) ||
    path.posix.normalize(archivePath) !== archivePath
  ) {
    throw new Error(`Unsafe path in npm tarball: ${String(archivePath)}`);
  }
  if (directory && archivePath === 'package/') {
    return '';
  }
  if (!archivePath.startsWith('package/')) {
    throw new Error(`npm tarball entry is outside package/: ${archivePath}`);
  }
  const packagePath = archivePath.slice('package/'.length);
  if (packagePath === '' || packagePath.startsWith('../')) {
    throw new Error(`Unsafe package path in npm tarball: ${archivePath}`);
  }
  return packagePath;
}

function inspectNpmTarball(tarballBytes) {
  let tarBytes;
  try {
    tarBytes = zlib.gunzipSync(tarballBytes);
  } catch (error) {
    throw new Error(
      `Release tarball is not valid gzip data: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const files = [];
  const fileContents = new Map();
  const seenPaths = new Set();
  let packageJsonBytes;
  let globalPax = {};
  let nextPax = {};
  let longPath;
  let offset = 0;
  let reachedEnd = false;

  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      reachedEnd = true;
      if (!tarBytes.subarray(offset).every(byte => byte === 0)) {
        throw new Error('npm tarball contains data after its end marker');
      }
      break;
    }
    validateTarChecksum(header);
    const headerName = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const fallbackPath = prefix ? `${prefix}/${headerName}` : headerName;
    const size = parseTarNumber(header.subarray(124, 136), 'tar entry size');
    const mode = parseTarNumber(header.subarray(100, 108), 'tar entry mode');
    const type = String.fromCharCode(header[156] || 48);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tarBytes.length) {
      throw new Error(`Tar entry ${fallbackPath} extends past the archive`);
    }
    const contents = tarBytes.subarray(contentStart, contentEnd);
    offset = contentStart + Math.ceil(size / 512) * 512;

    if (type === 'x' || type === 'g') {
      const pax = parsePaxRecords(contents);
      if (type === 'g') {
        globalPax = { ...globalPax, ...pax };
      } else {
        nextPax = pax;
      }
      continue;
    }
    if (type === 'L') {
      longPath = readTarString(contents);
      continue;
    }

    const pax = { ...globalPax, ...nextPax };
    const archivePath = pax.path ?? longPath ?? fallbackPath;
    nextPax = {};
    longPath = undefined;

    if (type === '5') {
      validateArchivePath(archivePath, { directory: true });
      continue;
    }
    if (type !== '0') {
      throw new Error(
        `Unsupported tar entry type ${JSON.stringify(type)} for ${archivePath}`,
      );
    }

    const packagePath = validateArchivePath(archivePath);
    if (seenPaths.has(packagePath)) {
      throw new Error(`Duplicate file in npm tarball: ${packagePath}`);
    }
    seenPaths.add(packagePath);
    files.push({ mode, path: packagePath, size });
    fileContents.set(packagePath, Buffer.from(contents));
    if (packagePath === 'package.json') {
      packageJsonBytes = Buffer.from(contents);
    }
  }

  if (!reachedEnd) {
    throw new Error('npm tarball is missing its end marker');
  }
  if (!packageJsonBytes) {
    throw new Error('npm tarball is missing package/package.json');
  }

  files.sort((left, right) =>
    compareCanonicalStrings(left.path, right.path),
  );
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `npm tarball package.json is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    fileCount: files.length,
    fileContents,
    fileListSha256: sha256(canonicalJson(files)),
    files,
    packageJson,
    packageJsonSha256: sha256(packageJsonBytes),
    unpackedSize: files.reduce((total, file) => total + file.size, 0),
  };
}

function readNpmTarballFile(tarballBytes, packagePath) {
  const contents = inspectNpmTarball(tarballBytes).fileContents.get(packagePath);
  if (!contents) {
    throw new Error(`npm tarball is missing ${packagePath}`);
  }
  return contents;
}

function validatePackedPackageJson(item, inspection) {
  const { packageJson } = inspection;
  if (packageJson.name !== item.targetName) {
    throw new Error(
      `${item.sourceName} tarball contains package ${String(
        packageJson.name,
      )}, expected ${item.targetName}`,
    );
  }
  if (packageJson.version !== item.version) {
    throw new Error(
      `${item.targetName} tarball version ${String(
        packageJson.version,
      )} does not match ${item.version}`,
    );
  }
  if (packageJson.publishConfig?.access !== 'public') {
    throw new Error(`${item.targetName} tarball must publish with public access`);
  }
  if (Object.hasOwn(packageJson, 'tag')) {
    throw new Error(
      `${item.targetName} tarball package.json must not declare top-level tag`,
    );
  }
  for (const key of ['registry', 'tag']) {
    if (Object.hasOwn(packageJson.publishConfig ?? {}, key)) {
      throw new Error(
        `${item.targetName} tarball publishConfig must not declare ${key}`,
      );
    }
  }
  for (const blockName of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    const block = packageJson[blockName] ?? {};
    const dependencyNames = Object.keys(block);
    if (
      JSON.stringify(dependencyNames) !==
      JSON.stringify([...dependencyNames].sort())
    ) {
      throw new Error(
        `${item.targetName} tarball ${blockName} keys must use canonical lexical order`,
      );
    }
    for (const [dependencyName, specifier] of Object.entries(block)) {
      if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
        throw new Error(
          `${item.targetName} ${blockName}.${dependencyName} still uses ${specifier}`,
        );
      }
    }
  }
  if (item.sourceName === '@modern-js/create') {
    const filePaths = new Set(inspection.files.map(file => file.path));
    const missing = createTemplateRequiredFiles.filter(
      requiredPath => !filePaths.has(requiredPath),
    );
    if (missing.length > 0) {
      throw new Error(
        `${item.targetName} tarball is missing required create template file(s): ${missing.join(
          ', ',
        )}`,
      );
    }
  }
}

function verifyPackageArtifactBytes(item, bytes, artifactPath) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`${item.targetName} tarball bytes must be a Buffer`);
  }
  if (bytes.length !== item.size) {
    throw new Error(
      `${item.targetName} tarball size mismatch: expected ${item.size}, found ${bytes.length}`,
    );
  }

  const actualSha256 = sha256(bytes);
  const actualShasum = hashBuffer('sha1', bytes);
  const actualIntegrity = `sha512-${hashBuffer('sha512', bytes, 'base64')}`;
  if (actualSha256 !== item.sha256) {
    throw new Error(`${item.targetName} tarball SHA-256 mismatch`);
  }
  if (actualShasum !== item.shasum) {
    throw new Error(`${item.targetName} tarball npm shasum mismatch`);
  }
  if (actualIntegrity !== item.integrity) {
    throw new Error(`${item.targetName} tarball npm integrity mismatch`);
  }

  const inspection = inspectNpmTarball(bytes);
  for (const field of [
    'fileCount',
    'unpackedSize',
    'packageJsonSha256',
    'fileListSha256',
  ]) {
    if (inspection[field] !== item[field]) {
      throw new Error(
        `${item.targetName} tarball ${field} mismatch: expected ${item[field]}, found ${inspection[field]}`,
      );
    }
  }
  validatePackedPackageJson(item, inspection);
  return {
    ...item,
    ...(artifactPath === undefined ? {} : { artifactPath }),
    packageJson: inspection.packageJson,
  };
}

function readVerifiedPackageArtifactBytes(item, artifactPath) {
  const bytes = readRegularFile(
    artifactPath,
    `${item.targetName} release tarball`,
  );
  verifyPackageArtifactBytes(item, bytes, artifactPath);
  return bytes;
}

function verifyPackageArtifact(item, artifactPath) {
  const bytes = readRegularFile(
    artifactPath,
    `${item.targetName} release tarball`,
  );
  return verifyPackageArtifactBytes(item, bytes, artifactPath);
}

function parseNpmPackOutput(stdout, sourceName) {
  let value;
  try {
    value = JSON.parse(String(stdout));
  } catch (error) {
    throw new Error(
      `npm pack for ${sourceName} did not return JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`npm pack for ${sourceName} must return one artifact`);
  }
  return value[0];
}

function packStagedPackage(
  item,
  tarballsDir,
  command = execFileSync,
) {
  const packageDir = path.resolve(repoRoot, item.packageDir);
  const before = new Set(fs.readdirSync(tarballsDir));
  const stdout = command(
    'npm',
    [
      'pack',
      packageDir,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      tarballsDir,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const metadata = parseNpmPackOutput(stdout, item.sourceName);
  const created = fs
    .readdirSync(tarballsDir)
    .filter(fileName => !before.has(fileName));
  if (created.length !== 1) {
    throw new Error(
      `npm pack for ${item.sourceName} created ${created.length} files; expected exactly one`,
    );
  }
  if (
    typeof metadata.filename !== 'string' ||
    path.basename(metadata.filename) !== metadata.filename ||
    metadata.filename !== created[0]
  ) {
    throw new Error(`npm pack for ${item.sourceName} returned an unsafe filename`);
  }

  const artifactPath = path.join(tarballsDir, metadata.filename);
  const bytes = fs.readFileSync(artifactPath);
  const inspection = inspectNpmTarball(bytes);
  if (metadata.name !== item.targetName || metadata.version !== item.version) {
    throw new Error(
      `npm pack identity mismatch for ${item.sourceName}: ${String(
        metadata.name,
      )}@${String(metadata.version)}`,
    );
  }
  const npmFiles = Array.isArray(metadata.files)
    ? metadata.files
        .map(file => ({
          mode: file.mode,
          path: file.path,
          size: file.size,
        }))
        .sort((left, right) =>
          compareCanonicalStrings(left.path, right.path),
        )
    : undefined;
  if (!npmFiles || canonicalJson(npmFiles) !== canonicalJson(inspection.files)) {
    throw new Error(`npm pack file list mismatch for ${item.targetName}`);
  }

  const computed = {
    fileCount: inspection.fileCount,
    integrity: `sha512-${hashBuffer('sha512', bytes, 'base64')}`,
    packageJsonSha256: inspection.packageJsonSha256,
    sha256: sha256(bytes),
    shasum: hashBuffer('sha1', bytes),
    size: bytes.length,
    unpackedSize: inspection.unpackedSize,
  };
  for (const field of [
    'size',
    'unpackedSize',
    'shasum',
    'integrity',
  ]) {
    if (metadata[field] !== computed[field]) {
      throw new Error(
        `npm pack ${field} mismatch for ${item.targetName}: reported ${String(
          metadata[field],
        )}, computed ${computed[field]}`,
      );
    }
  }
  if (metadata.entryCount !== computed.fileCount) {
    throw new Error(
      `npm pack file count mismatch for ${item.targetName}: reported ${String(
        metadata.entryCount,
      )}, computed ${computed.fileCount}`,
    );
  }

  const manifestItem = {
    fileCount: computed.fileCount,
    fileListSha256: inspection.fileListSha256,
    integrity: computed.integrity,
    packageJsonSha256: computed.packageJsonSha256,
    sha256: computed.sha256,
    shasum: computed.shasum,
    size: computed.size,
    sourceName: item.sourceName,
    tarballPath: `${tarballsDirectory}/${metadata.filename}`,
    targetName: item.targetName,
    unpackedSize: computed.unpackedSize,
    version: item.version,
  };
  validatePackedPackageJson(manifestItem, inspection);
  return manifestItem;
}

function commandText(command, args, runner = execFileSync) {
  return String(
    runner(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ).trim();
}

function normalizeRepositoryIdentity(value) {
  assertNonEmptyString(value, 'Source repository identity');
  if (/^[^/\s]+\/[^/\s]+$/u.test(value)) {
    return value.replace(/\.git$/u, '');
  }
  const match = /github\.com(?::|\/)(?<identity>[^/\s]+\/[^/\s]+?)(?:\.git)?$/u.exec(
    value,
  );
  if (!match?.groups?.identity) {
    throw new Error(`Cannot derive GitHub repository identity from ${value}`);
  }
  return match.groups.identity;
}

function resolveSourceIdentity({ env = process.env, runner = execFileSync } = {}) {
  const repository = normalizeRepositoryIdentity(
    env.GITHUB_REPOSITORY ||
      commandText('git', ['remote', 'get-url', 'bleedingdev'], runner),
  );
  const commit = commandText(
    'git',
    ['rev-parse', '--verify', 'HEAD'],
    runner,
  ).toLowerCase();
  return { commit, repository };
}

function resolveToolVersions(runner = execFileSync) {
  return {
    node: process.version,
    npm: commandText('npm', ['--version'], runner),
    pnpm: commandText('pnpm', ['--version'], runner),
  };
}

function readRegularFile(filePath, label) {
  let fd;
  try {
    fd = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    throw new Error(`${label} is missing or is not a regular file`, {
      cause: error,
    });
  }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) {
      throw new Error(`${label} is not a regular file`);
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      after.size !== bytes.length
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function verifyReleaseArtifacts(outDir, expected = {}) {
  const resolvedOutDir = path.resolve(outDir);
  const manifestPath = path.join(resolvedOutDir, releaseManifestFile);
  const manifestBytes = readRegularFile(manifestPath, 'Release manifest');
  const manifestDigest = sha256(manifestBytes);
  const detachedManifestDigest = readRegularFile(
    path.join(resolvedOutDir, releaseManifestDigestFile),
    'Detached release manifest SHA-256',
  ).toString('utf8');
  const expectedDetachedManifestDigest = `${manifestDigest}  ${releaseManifestFile}\n`;
  if (detachedManifestDigest !== expectedDetachedManifestDigest) {
    throw new Error('Detached release manifest SHA-256 mismatch');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `Release manifest is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const canonicalManifestBytes = Buffer.from(
    `${canonicalJson(manifest, 2)}\n`,
    'utf8',
  );
  if (!manifestBytes.equals(canonicalManifestBytes)) {
    throw new Error('Release manifest is not canonical JSON');
  }
  validateReleaseManifest(manifest, expected);

  const detachedCohortDigest = readRegularFile(
    path.join(resolvedOutDir, releaseCohortDigestFile),
    'Detached release cohort digest',
  ).toString('utf8');
  if (detachedCohortDigest !== `${manifest.cohortDigest}\n`) {
    throw new Error('Detached release cohort digest mismatch');
  }

  const tarballsDir = path.join(resolvedOutDir, tarballsDirectory);
  const tarballsStat = fs.lstatSync(tarballsDir, { throwIfNoEntry: false });
  if (!tarballsStat?.isDirectory() || tarballsStat.isSymbolicLink()) {
    throw new Error('Release tarballs directory is missing or unsafe');
  }
  const expectedTarballs = manifest.packages
    .map(item => path.posix.basename(item.tarballPath))
    .sort(compareCanonicalStrings);
  const actualTarballs = fs
    .readdirSync(tarballsDir, { withFileTypes: true })
    .map(entry => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`Unexpected entry in release tarballs: ${entry.name}`);
      }
      return entry.name;
    })
    .sort(compareCanonicalStrings);
  if (canonicalJson(actualTarballs) !== canonicalJson(expectedTarballs)) {
    throw new Error(
      `Release tarball set mismatch: expected ${expectedTarballs.join(
        ', ',
      )}; found ${actualTarballs.join(', ')}`,
    );
  }

  const packages = manifest.packages.map(item => {
    const artifactPath = path.resolve(resolvedOutDir, item.tarballPath);
    const relative = path.relative(resolvedOutDir, artifactPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${item.targetName} tarball escapes the artifact root`);
    }
    return verifyPackageArtifact(item, artifactPath);
  });

  const createPackages = packages.filter(
    item => item.sourceName === '@modern-js/create',
  );
  if (createPackages.length !== 1) {
    throw new Error(
      `Release manifest must contain exactly one @modern-js/create package, found ${createPackages.length}`,
    );
  }
  const createTarballBytes = readVerifiedPackageArtifactBytes(
    createPackages[0],
    path.resolve(resolvedOutDir, createPackages[0].tarballPath),
  );
  const projectionBytes = readNpmTarballFile(
    createTarballBytes,
    releaseCohortProjectionPath,
  );
  let projection;
  try {
    projection = JSON.parse(projectionBytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      `Packed release cohort projection is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  validateReleaseCohortProjection(projection, manifest);
  const canonicalProjectionBytes = Buffer.from(
    `${canonicalJson(projection, 2)}\n`,
    'utf8',
  );
  if (!projectionBytes.equals(canonicalProjectionBytes)) {
    throw new Error('Packed release cohort projection is not canonical JSON');
  }
  if (sha256(projectionBytes) !== manifest.cohortProjection.sha256) {
    throw new Error('Packed release cohort projection SHA-256 mismatch');
  }

  const actualDependencyGraph = Object.fromEntries(
    [...packages]
      .sort((left, right) =>
        compareCanonicalStrings(left.targetName, right.targetName),
      )
      .map(item => [
        item.targetName,
        packageDependenciesFromPackageJson(
          item.packageJson,
          item.targetName,
          manifest,
        ),
      ]),
  );
  assertSameJson(
    actualDependencyGraph,
    manifest.dependencyGraph,
    'Packed package dependency graph',
  );

  const verified = {
    cohortProjection: Object.freeze({
      sha256: manifest.cohortProjection.sha256,
      value: Object.freeze(projection),
    }),
    manifest,
    manifestPath,
    manifestSha256: manifestDigest,
    outDir: resolvedOutDir,
    packages,
  };
  Object.defineProperty(verified, verifiedReleaseArtifactsBrand, {
    value: true,
  });
  return Object.freeze(verified);
}

function assertVerifiedReleaseArtifacts(value) {
  if (!value || value[verifiedReleaseArtifactsBrand] !== true) {
    throw new Error(
      'Publishing requires release artifacts returned by verifyReleaseArtifacts',
    );
  }
}

function writeReleaseManifest(outDir, manifest) {
  const manifestBytes = Buffer.from(`${canonicalJson(manifest, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, releaseManifestFile), manifestBytes);
  fs.writeFileSync(
    path.join(outDir, releaseManifestDigestFile),
    `${sha256(manifestBytes)}  ${releaseManifestFile}\n`,
  );
  fs.writeFileSync(
    path.join(outDir, releaseCohortDigestFile),
    `${manifest.cohortDigest}\n`,
  );
}

function createReleaseArtifacts({
  aliases,
  command = execFileSync,
  outDir,
  packages,
  source = resolveSourceIdentity(),
  tag,
  tools = resolveToolVersions(),
  version,
}) {
  const resolvedOutDir = path.resolve(outDir);
  const stagingManifest = { aliases, packages };
  const expectedSourceNames = Object.keys(aliases).sort(
    compareCanonicalStrings,
  );
  const actualSourceNames = packages
    .map(item => item.sourceName)
    .sort(compareCanonicalStrings);
  assertSameJson(
    actualSourceNames,
    expectedSourceNames,
    'Staged release package cohort',
  );

  const dependencyGraph = createPackageDependencyGraph(
    packages,
    stagingManifest,
  );
  const publishOrder = orderPublishItems(packages, {
    ...stagingManifest,
    dependencyGraph,
  }).map(item => item.targetName);

  const tarballsDir = path.join(resolvedOutDir, tarballsDirectory);
  fs.rmSync(tarballsDir, { force: true, recursive: true });
  fs.mkdirSync(tarballsDir, { recursive: true });
  for (const fileName of [
    releaseManifestFile,
    releaseManifestDigestFile,
    releaseCohortDigestFile,
  ]) {
    fs.rmSync(path.join(resolvedOutDir, fileName), { force: true });
  }

  const projection = createReleaseCohortProjection({
    aliases,
    packages,
    source,
    tag,
    version,
  });
  const createPackages = packages.filter(
    item => item.sourceName === '@modern-js/create',
  );
  if (createPackages.length !== 1) {
    throw new Error(
      `Staged release package cohort must contain exactly one @modern-js/create package, found ${createPackages.length}`,
    );
  }
  const projectionPath = path.join(
    path.resolve(repoRoot, createPackages[0].packageDir),
    releaseCohortProjectionPath,
  );
  if (fs.existsSync(projectionPath)) {
    throw new Error(
      `Staged @modern-js/create package already contains ${releaseCohortProjectionPath}`,
    );
  }
  fs.mkdirSync(path.dirname(projectionPath), { recursive: true });
  fs.writeFileSync(
    projectionPath,
    `${canonicalJson(projection, 2)}\n`,
    'utf8',
  );
  let releasePackages;
  try {
    releasePackages = [...packages]
      .sort((left, right) =>
        compareCanonicalStrings(left.sourceName, right.sourceName),
      )
      .map(item => packStagedPackage(item, tarballsDir, command));
  } finally {
    fs.rmSync(projectionPath, { force: true });
    fs.rmdirSync(path.dirname(projectionPath));
  }
  const manifest = {
    aliases,
    cohortDigest: '',
    cohortProjection: { sha256: sha256(canonicalJson(projection, 2) + '\n') },
    dependencyGraph,
    packages: releasePackages,
    publishOrder,
    release: { tag, version },
    schema: releaseManifestSchema,
    schemaVersion: releaseManifestSchemaVersion,
    source,
    tools,
  };
  manifest.cohortDigest = computeCohortDigest(manifest);
  validateReleaseManifest(manifest, {
    aliases,
    source,
    sourceNames: expectedSourceNames,
    tag,
    version,
  });
  writeReleaseManifest(resolvedOutDir, manifest);

  return verifyReleaseArtifacts(resolvedOutDir, {
    aliases,
    source,
    sourceNames: expectedSourceNames,
    tag,
    version,
  });
}

export {
  assertVerifiedReleaseArtifacts,
  computeCohortDigest,
  createReleaseArtifacts,
  createReleaseCohortProjection,
  readNpmTarballFile,
  releaseCohortDigestFile,
  releaseCohortProjectionPath,
  releaseCohortProjectionSchema,
  releaseCohortProjectionSchemaVersion,
  releaseManifestDigestFile,
  releaseManifestFile,
  releaseManifestSchema,
  releaseManifestSchemaVersion,
  normalizeRepositoryIdentity,
  resolveSourceIdentity,
  resolveToolVersions,
  readVerifiedPackageArtifactBytes,
  validateReleaseManifest,
  validateReleaseCohortProjection,
  verifyPackageArtifact,
  verifyPackageArtifactBytes,
  verifyReleaseArtifacts,
};
