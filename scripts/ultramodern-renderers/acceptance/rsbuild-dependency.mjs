import assert from 'node:assert/strict';
import path from 'node:path';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';

const canonicalName = '@rsbuild/core';
const maintainedName = '@bleedingdev/rsbuild-core';
const supportedVersion = '2.2.9';

/** Select the same maintained provider as the verified owning framework. */
export function rsbuildSpecifierFromRelease(release) {
  const owner = release.packages.find(
    item => item.sourceName === '@modern-js/ultramodern-app-tools',
  );
  const sidecar = release.sidecars?.packages.find(
    item => item.name === maintainedName,
  );
  assert.ok(owner, 'The verified release must contain Ultra app-tools');
  assert.ok(
    sidecar,
    'The verified release must contain the maintained Rsbuild sidecar',
  );
  assert.equal(
    sidecar.version,
    supportedVersion,
    'The maintained Rsbuild version must match',
  );
  assert.equal(
    sidecar.packageJson.name,
    maintainedName,
    'The maintained Rsbuild packed name must match',
  );
  assert.equal(
    sidecar.packageJson.version,
    supportedVersion,
    'The maintained Rsbuild packed version must match',
  );
  const specifier = `npm:${maintainedName}@${supportedVersion}`;
  assert.equal(
    owner.packageJson.dependencies?.[canonicalName],
    specifier,
    'The owning framework must select the exact verified Rsbuild sidecar',
  );
  return specifier;
}

/** Project ordinary source authoring into the candidate's authenticated alias. */
export function resolveRsbuildDependency({ releaseManifest, specifier } = {}) {
  let admitted = supportedVersion;
  if (releaseManifest !== undefined) {
    assert.ok(
      typeof releaseManifest === 'string' && path.isAbsolute(releaseManifest),
      'Rsbuild candidate intake requires an absolute release manifest',
    );
    admitted = rsbuildSpecifierFromRelease(
      readReleaseManifest({ manifestPath: releaseManifest }),
    );
  }
  assert.ok(
    specifier === undefined ||
      specifier === supportedVersion ||
      specifier === admitted,
    'Compiler observation requires the exact source or manifest-bound maintained Rsbuild provider',
  );
  return admitted;
}
