// "Installed = packed": every cohort package an app installed must be the
// packed tarball byte for byte, never a workspace link or a rebuilt copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { fileEvidence, sha256 } from '../lib/file-evidence.mjs';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** Reads a prepared cohort with the size and digest of every packed file. */
export function readCohort(manifestPath) {
  const release = readReleaseManifest({ manifestPath });
  return {
    manifestPath: release.manifestPath,
    sourceRevision: release.source.commit,
    release: release.release,
    manifestSha256: release.manifestSha256,
    cohortDigest: release.cohortDigest,
    artifacts: release.packages.map(item => {
      const tarball = inspectNpmTarball(
        readVerifiedPackageArtifactBytes(item, item.artifactPath),
      );
      return {
        sourceName: item.sourceName,
        targetName: item.targetName,
        name: item.targetName,
        version: item.version,
        sha256: item.sha256,
        files: tarball.files.map(file => ({
          path: file.path,
          size: file.size,
          sha256: sha256(tarball.fileContents.get(file.path)),
        })),
      };
    }),
  };
}

/** Records a physical package root, excluding nested dependency directories. */
export function readInstalledPackageFiles(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'node_modules') continue;
      const file = path.join(current, entry.name);
      assert(
        !entry.isSymbolicLink(),
        `Installed package contains a symlink: ${file}`,
      );
      if (entry.isDirectory()) visit(file);
      else {
        assert(
          entry.isFile(),
          `Installed package contains a non-file: ${file}`,
        );
        files.push(fileEvidence(file, directory));
      }
    }
  };
  visit(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** Authenticates every package-owned file against its packed candidate. */
export function verifyInstalledPackage(directory, artifact) {
  const expected = new Map(artifact.files.map(file => [file.path, file]));
  const files = readInstalledPackageFiles(directory);
  for (const file of files) {
    const packed = expected.get(file.path);
    assert(packed, `${artifact.targetName} has an unpacked file ${file.path}`);
    assert(
      file.byteLength === packed.size && file.sha256 === packed.sha256,
      `${artifact.targetName} differs from its tarball at ${file.path}`,
    );
    expected.delete(file.path);
  }
  assert(
    expected.size === 0,
    `${artifact.targetName} is missing ${[...expected.keys()].join(', ')}`,
  );
  return files;
}

function compareInstalled(directory, artifact) {
  const real = fs.realpathSync(directory);
  assert(
    !real.startsWith(`${repoRoot}${path.sep}packages${path.sep}`),
    `${artifact.targetName} is a workspace link: ${real}`,
  );
  verifyInstalledPackage(real, artifact);
}

/** The nearest directory at or above `start` that holds `file`. */
function findUp(start, file) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, file))) return dir;
    assert.notEqual(dir, path.dirname(dir), `No ${file} above ${start}`);
  }
}

/** Resolves `catalog:<name>` through the owning pnpm-workspace.yaml. */
function resolveCatalog(appRoot, name, spec) {
  if (!spec.startsWith('catalog:')) return spec;
  const workspace = parseYaml(
    fs.readFileSync(
      path.join(findUp(appRoot, 'pnpm-workspace.yaml'), 'pnpm-workspace.yaml'),
      'utf8',
    ),
  );
  const catalogName = spec.slice('catalog:'.length) || 'default';
  const catalog =
    catalogName === 'default'
      ? (workspace?.catalog ?? workspace?.catalogs?.default)
      : workspace?.catalogs?.[catalogName];
  const resolved = catalog?.[name];
  assert(resolved, `${name} uses ${spec}, which has no entry for it`);
  return resolved;
}

/**
 * Checks the app's direct cohort dependencies and every cohort copy in the
 * pnpm virtual store above it. Returns the number of installed copies checked.
 */
export function checkInstalledCohort({ appRoot, cohort }) {
  const byTarget = new Map(
    cohort.artifacts.map(artifact => [artifact.targetName, artifact]),
  );
  const bySource = new Map(
    cohort.artifacts.map(artifact => [artifact.sourceName, artifact]),
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
  );
  let checked = 0;
  for (const [name, spec] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    const artifact = byTarget.get(name) ?? bySource.get(name);
    if (!artifact) continue;
    assert.equal(
      resolveCatalog(appRoot, name, spec),
      name === artifact.targetName
        ? artifact.version
        : `npm:${artifact.targetName}@${artifact.version}`,
      `${name} must depend on the packed cohort`,
    );
    compareInstalled(path.join(appRoot, 'node_modules', name), artifact);
    checked += 1;
  }
  const store = path.join(
    findUp(appRoot, 'node_modules/.pnpm'),
    'node_modules/.pnpm',
  );
  for (const entry of fs.readdirSync(store)) {
    const scope = path.join(store, entry, 'node_modules/@bleedingdev');
    if (!fs.existsSync(scope)) continue;
    for (const name of fs.readdirSync(scope)) {
      const artifact = byTarget.get(`@bleedingdev/${name}`);
      const directory = path.join(scope, name);
      if (!artifact || fs.lstatSync(directory).isSymbolicLink()) continue;
      compareInstalled(directory, artifact);
      checked += 1;
    }
  }
  assert(checked > 0, `${appRoot} installed no cohort package`);
  return checked;
}
