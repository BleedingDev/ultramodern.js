// "Installed = packed": every cohort package an app installed must be the
// packed tarball byte for byte, never a workspace link or a rebuilt copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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

function compareInstalled(directory, artifact) {
  const real = fs.realpathSync(directory);
  assert(
    !real.startsWith(`${repoRoot}${path.sep}packages${path.sep}`),
    `${artifact.targetName} is a workspace link: ${real}`,
  );
  const expected = new Map(artifact.files.map(file => [file.path, file]));
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(file);
        continue;
      }
      const relative = path.relative(real, file).split(path.sep).join('/');
      const packed = expected.get(relative);
      assert(packed, `${artifact.targetName} has an unpacked file ${relative}`);
      assert(
        entry.isFile() && sha256(fs.readFileSync(file)) === packed.sha256,
        `${artifact.targetName} differs from its tarball at ${relative}`,
      );
      expected.delete(relative);
    }
  };
  visit(real);
  assert(
    expected.size === 0,
    `${artifact.targetName} is missing ${[...expected.keys()].join(', ')}`,
  );
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
      spec,
      name === artifact.targetName
        ? artifact.version
        : `npm:${artifact.targetName}@${artifact.version}`,
      `${name} must depend on the packed cohort`,
    );
    compareInstalled(path.join(appRoot, 'node_modules', name), artifact);
    checked += 1;
  }
  let store;
  for (let dir = appRoot; !store; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules/.pnpm')))
      store = path.join(dir, 'node_modules/.pnpm');
    assert.notEqual(dir, path.dirname(dir), `No pnpm store above ${appRoot}`);
  }
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
