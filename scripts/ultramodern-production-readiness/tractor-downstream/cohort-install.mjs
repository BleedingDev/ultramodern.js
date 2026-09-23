import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { stringify as dump, parse as load } from 'yaml';
import {
  inspectNpmTarball,
  readVerifiedPackageArtifactBytes,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { expectedReleaseCohort } from '../published-create-proof/package-cohort.mjs';
import { collectPackageJsonFiles } from './contract.mjs';

const dependencyBlocks = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/** Select the exact supplied bundle through the consumer's native pnpm catalog. */
export function prepareTractorCohortInstallation(workspace, release) {
  const cohort = expectedReleaseCohort(release);
  const version = release.release.version;
  const create = release.createPackage;
  const packed = inspectNpmTarball(
    readVerifiedPackageArtifactBytes(create, create.artifactPath),
  );
  const cohortBytes = packed.fileContents.get('release-cohort.json');
  if (!cohortBytes) {
    throw new Error(
      'Release create package is missing its producer-owned release-cohort.json',
    );
  }
  let installedCohort;
  try {
    installedCohort = JSON.parse(cohortBytes.toString('utf8'));
  } catch {
    throw new Error(
      'Release create package has an invalid release-cohort.json',
    );
  }
  if (
    !isDeepStrictEqual(installedCohort.aliases, cohort.aliases) ||
    installedCohort.release?.version !== version ||
    (release.cohortProjection?.value &&
      !isDeepStrictEqual(installedCohort, release.cohortProjection.value))
  ) {
    throw new Error(
      'Installed producer release cohort disagrees with the authenticated bundle',
    );
  }

  const workspaceFile = path.join(workspace, 'pnpm-workspace.yaml');
  const policy = load(fs.readFileSync(workspaceFile, 'utf8'));
  const catalog = policy?.catalogs?.ultramodern;
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('Tractor requires a native catalogs.ultramodern entry');
  }
  const requested = new Set();
  let dependencyCount = 0;
  for (const file of collectPackageJsonFiles(workspace)) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const block of dependencyBlocks) {
      for (const [name, specifier] of Object.entries(manifest[block] ?? {})) {
        if (!name.startsWith('@modern-js/')) continue;
        if (!cohort.aliases[name]) {
          throw new Error(
            `Tractor dependency ${name} is absent from the release cohort`,
          );
        }
        if (specifier !== 'catalog:ultramodern') {
          throw new Error(
            `Tractor dependency ${name} in ${path.relative(workspace, file)} must use catalog:ultramodern`,
          );
        }
        requested.add(name);
        dependencyCount += 1;
      }
    }
  }
  if (dependencyCount === 0) {
    throw new Error('Tractor has no framework dependencies to install');
  }
  for (const name of Object.keys(catalog)) {
    if (!cohort.aliases[name]) {
      throw new Error(
        `Tractor catalog entry ${name} is absent from the release cohort`,
      );
    }
  }
  for (const name of requested) {
    if (!Object.hasOwn(catalog, name)) {
      throw new Error(
        `Tractor catalog is missing requested framework dependency ${name}`,
      );
    }
  }
  for (const [name, target] of Object.entries(cohort.aliases)) {
    catalog[name] = `npm:${target}@${version}`;
  }
  fs.writeFileSync(workspaceFile, dump(policy, { lineWidth: 0 }));
  return { catalogCount: Object.keys(cohort.aliases).length, dependencyCount };
}
