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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readNativeCatalog(workspace) {
  const policy = load(
    fs.readFileSync(path.join(workspace, 'pnpm-workspace.yaml'), 'utf8'),
  );
  const catalog = policy?.catalogs?.ultramodern;
  assert(
    catalog && typeof catalog === 'object' && !Array.isArray(catalog),
    'Tractor requires native catalogs.ultramodern',
  );
  return catalog;
}

function findInstalledManifest(workspace, packageFile, name) {
  let directory = path.dirname(packageFile);
  const root = path.resolve(workspace);
  while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    const candidate = path.join(
      directory,
      'node_modules',
      name,
      'package.json',
    );
    if (fs.existsSync(candidate)) return readJson(candidate);
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  throw new Error(
    `${normalizePath(path.relative(workspace, packageFile))} ${name} is not installed`,
  );
}

export function assertAuthenticatedTractorCohort(workspace, release) {
  for (const retired of [
    '.modernjs/ultramodern.json',
    '.modernjs/release-cohort.json',
  ]) {
    assert(
      !fs.existsSync(path.join(workspace, retired)),
      `Tractor still carries retired ${retired}`,
    );
  }
  const catalog = readNativeCatalog(workspace);
  const version = release.release?.version;
  const aliases = release.aliases;
  assert(
    typeof version === 'string' && version.length > 0,
    'Exact release version is required',
  );
  assert(
    aliases && typeof aliases === 'object',
    'Exact release aliases are required',
  );
  const cohortPath = path.join(
    workspace,
    'node_modules/@modern-js/ultramodern-create/release-cohort.json',
  );
  assert(
    fs.existsSync(cohortPath),
    'Installed producer release cohort is missing',
  );
  const observed = readJson(cohortPath);
  assert(
    observed.release?.version === version &&
      isDeepStrictEqual(observed.aliases, aliases) &&
      (!release.cohortProjection?.value ||
        isDeepStrictEqual(observed, release.cohortProjection.value)),
    'Installed producer release cohort differs from the exact release manifest',
  );
  for (const [name, target] of Object.entries(aliases)) {
    assert(
      catalog[name] === `npm:${target}@${version}`,
      `Tractor native catalog ${name} must select exact release ${version}`,
    );
  }
  return { catalogCount: Object.keys(aliases).length, version };
}

export function assertExactModernDependencySpecifiers(workspace, release) {
  const catalog = readNativeCatalog(workspace);
  const version = release.release?.version;
  const aliases = release.aliases;
  assert(
    typeof version === 'string' && version.length > 0,
    'Release version is required for Tractor cohort validation',
  );
  assert(
    aliases && typeof aliases === 'object',
    'Release aliases are required for Tractor cohort validation',
  );
  const observations = [];
  for (const packageFile of collectPackageJsonFiles(workspace)) {
    const manifest = readJson(packageFile);
    for (const blockName of dependencyBlocks) {
      for (const [dependencyName, specifier] of Object.entries(
        manifest[blockName] ?? {},
      )) {
        if (!dependencyName.startsWith('@modern-js/')) continue;
        const targetName = aliases[dependencyName];
        assert(
          typeof targetName === 'string',
          `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} is absent from the exact release cohort`,
        );
        assert(
          specifier === 'catalog:ultramodern',
          `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} must use catalog:ultramodern`,
        );
        const expected = `npm:${targetName}@${version}`;
        assert(
          catalog[dependencyName] === expected,
          `${dependencyName} catalog request must be ${expected}`,
        );
        const installed = findInstalledManifest(
          workspace,
          packageFile,
          dependencyName,
        );
        assert(
          installed.name === targetName && installed.version === version,
          `${dependencyName} installed identity/version differs from the exact release`,
        );
        observations.push({
          blockName,
          dependencyName,
          packageFile: normalizePath(path.relative(workspace, packageFile)),
          specifier,
          targetName,
        });
      }
    }
  }
  assert(
    observations.length > 0,
    'Tractor workspace contains no Modern.js dependencies to bind to the release cohort',
  );
  return observations;
}
