import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { assert, assertPathInside, assertString, isObject } from './assertions.mjs';
import {
  collectSourcePackageIndex,
  expectedTargetName,
  validateCreatePublicExports,
  validateCreatePublishedPaths,
  validateCreateRuntimeDependencies,
  validateInternalDependencyResolution,
  validateNoWorkspaceProtocol,
} from './package-validation.mjs';
import { runCreatePackageRuntimeProof } from './runtime-proof.mjs';

const { readJsonFile, writeJsonFile } = fsKit;

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function validateManifestShape(manifest) {
  assert(isObject(manifest), 'Publish manifest must be a JSON object');
  assert(
    manifest.schemaVersion === 1,
    'Publish manifest schemaVersion must be 1',
  );
  for (const field of [
    'generatedAt',
    'scope',
    'prefix',
    'version',
    'dependencyVersion',
    'tag',
  ]) {
    assertString(manifest[field], `Publish manifest ${field}`);
  }
  assert(
    isObject(manifest.aliases),
    'Publish manifest aliases must be an object',
  );
  assert(
    Array.isArray(manifest.packages) && manifest.packages.length > 0,
    'Publish manifest packages must be a non-empty array',
  );
  assert(
    manifest.dependencyVersion === manifest.version,
    `Publish manifest dependencyVersion must equal version for full BleedingDev cohorts, found ${manifest.dependencyVersion}`,
  );
}

function validateSelectedCohort(manifest) {
  const selectedSources = new Set();

  for (const item of manifest.packages) {
    assert(isObject(item), 'Publish manifest package entry must be an object');
    for (const field of ['sourceName', 'targetName', 'version', 'packageDir']) {
      assertString(item[field], `Publish manifest package ${field}`);
    }
    assert(
      item.sourceName.startsWith('@modern-js/'),
      `Source package must be @modern-js scoped: ${item.sourceName}`,
    );
    assert(
      item.targetName === expectedTargetName(item.sourceName, manifest),
      `${item.sourceName} target must be ${expectedTargetName(
        item.sourceName,
        manifest,
      )}, found ${item.targetName}`,
    );
    assert(
      item.version === manifest.version,
      `${item.targetName} version ${item.version} does not match manifest ${manifest.version}`,
    );
    selectedSources.add(item.sourceName);
  }

  const missing = Object.keys(manifest.aliases)
    .filter(sourceName => !selectedSources.has(sourceName))
    .sort((a, b) => a.localeCompare(b));
  assert(
    missing.length === 0,
    [
      `Single-version source proof requires every aliased public package in the staged cohort for ${manifest.version}.`,
      `Missing packages: ${missing.join(', ')}`,
    ].join('\n'),
  );

  return selectedSources;
}

function validateSourceProof({
  repoRoot,
  manifestPath,
  outPath,
  now = Date,
  runRuntimeCreateProof = true,
  createPackageRuntimeProofRunner = runCreatePackageRuntimeProof,
}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedManifestPath = path.resolve(manifestPath);
  const resolvedOutPath = path.resolve(outPath);

  assertPathInside(
    resolvedRepoRoot,
    resolvedManifestPath,
    'Publish manifest path',
  );
  assert(
    fs.existsSync(resolvedManifestPath),
    `Missing ${resolvedManifestPath}`,
  );

  const manifest = readJsonFile(resolvedManifestPath);
  validateManifestShape(manifest);
  validateSelectedCohort(manifest);

  const sourcePackages = collectSourcePackageIndex(resolvedRepoRoot);
  const packages = [];
  let createPackageProof;

  for (const item of manifest.packages) {
    const sourcePackage = sourcePackages.get(item.sourceName);
    assert(
      sourcePackage,
      `Missing local source package metadata for ${item.sourceName}`,
    );
    assert(
      manifest.aliases[item.sourceName] === item.targetName,
      `Alias metadata for ${item.sourceName} must point to ${item.targetName}`,
    );

    const packageDir = path.resolve(resolvedRepoRoot, item.packageDir);
    assertPathInside(
      resolvedRepoRoot,
      packageDir,
      `${item.targetName} packageDir`,
    );
    assert(
      fs.existsSync(path.join(packageDir, 'package.json')),
      `${item.targetName} staged package.json is missing`,
    );

    const packageJson = readJsonFile(path.join(packageDir, 'package.json'));
    assert(
      packageJson.name === item.targetName,
      `${item.sourceName} staged package name ${packageJson.name} does not match ${item.targetName}`,
    );
    assert(
      packageJson.version === manifest.version,
      `${item.targetName} staged package version ${packageJson.version} does not match ${manifest.version}`,
    );
    assert(
      packageJson.publishConfig?.access === 'public',
      `${item.targetName} must publish with public access`,
    );
    assert(
      !packageJson.repository?.url ||
        packageJson.repository.url.includes('BleedingDev/ultramodern.js'),
      `${item.targetName} repository metadata must point at BleedingDev/ultramodern.js`,
    );
    validateNoWorkspaceProtocol(packageJson, item.targetName);
    const internalDependencyChecks = validateInternalDependencyResolution({
      manifest,
      packageJson,
      packageName: item.targetName,
    });

    if (item.sourceName === '@modern-js/create') {
      assert(
        packageJson.ultramodern?.frameworkVersion ===
          manifest.dependencyVersion,
        `@modern-js/create staged package must record ultramodern.frameworkVersion=${manifest.dependencyVersion}`,
      );
      const runtimeDependencyChecks = validateCreateRuntimeDependencies(
        packageJson,
        item.targetName,
        internalDependencyChecks,
        manifest,
      );
      const publishedPathChecks = validateCreatePublishedPaths(
        packageDir,
        item.targetName,
      );
      const publicExportChecks = validateCreatePublicExports(
        packageDir,
        packageJson,
        sourcePackage.packageJson,
        item.targetName,
      );
      const runtimeProof = runRuntimeCreateProof
        ? createPackageRuntimeProofRunner({
            createItem: item,
            createPackageDir: packageDir,
            manifest,
            packageJson,
            repoRoot: resolvedRepoRoot,
            sourcePackageDir: sourcePackage.packageDir,
            sourcePackageDirs: Object.fromEntries(
              manifest.packages.map(packageItem => [
                packageItem.sourceName,
                sourcePackages.get(packageItem.sourceName)?.packageDir,
              ]),
            ),
          })
        : { skipped: true };
      createPackageProof = {
        sourceName: item.sourceName,
        targetName: item.targetName,
        frameworkVersion: packageJson.ultramodern.frameworkVersion,
        runtimeDependencyChecks,
        publishedPathChecks,
        publicExportChecks,
        runtimeProof,
      };
    }

    packages.push({
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: item.version,
      sourcePackageDir: path.relative(
        resolvedRepoRoot,
        sourcePackage.packageDir,
      ),
      packageDir: item.packageDir,
      internalDependencyChecks,
    });
  }

  const proof = {
    schemaVersion: 1,
    generatedAt: new now().toISOString(),
    gate: 'prepublish-source-create-proof',
    passed: true,
    repoRoot: resolvedRepoRoot,
    manifestPath: path.relative(resolvedRepoRoot, resolvedManifestPath),
    manifestSha256: sha256File(resolvedManifestPath),
    cohort: {
      scope: manifest.scope,
      prefix: manifest.prefix,
      version: manifest.version,
      dependencyVersion: manifest.dependencyVersion,
      tag: manifest.tag,
      packageCount: packages.length,
      sourceNames: packages.map(item => item.sourceName),
      targetNames: packages.map(item => item.targetName),
    },
    checks: {
      localSourcePackageMetadata: true,
      stagedPackageMetadata: true,
      noWorkspaceProtocol: true,
      noNpmLatestInternalResolution: true,
      singleVersionCohort: 'all-aliases',
    },
    packages,
    createPackageProof,
  };

  writeJsonFile(resolvedOutPath, proof);
  return proof;
}

function errorProof({ repoRoot, manifestPath, error, now = Date }) {
  return {
    schemaVersion: 1,
    generatedAt: new now().toISOString(),
    gate: 'prepublish-source-create-proof',
    passed: false,
    repoRoot: path.resolve(repoRoot),
    manifestPath: path.relative(
      path.resolve(repoRoot),
      path.resolve(manifestPath),
    ),
    error: error instanceof Error ? error.message : String(error),
  };
}

export { errorProof, validateSourceProof };
