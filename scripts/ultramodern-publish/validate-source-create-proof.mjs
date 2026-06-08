#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(
  new URL('../..', import.meta.url).pathname,
);
const defaultManifestPath = path.join(
  defaultRepoRoot,
  '.modern',
  'bleedingdev-publish',
  'manifest.json',
);
const defaultOutPath = path.join(
  defaultRepoRoot,
  '.modern',
  'prepublish-release-gates',
  'source-create-proof.json',
);
const dependencyBlockNames = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const requiredCreateRuntimeDependencies = ['@modern-js/i18n-utils'];

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    manifestPath: defaultManifestPath,
    outPath: defaultOutPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    const readValue = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--root') {
      options.repoRoot = path.resolve(readValue());
    } else if (arg === '--manifest') {
      options.manifestPath = path.resolve(readValue());
    } else if (arg === '--out') {
      options.outPath = path.resolve(readValue());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, label) {
  assert(typeof value === 'string' && value.trim() !== '', `${label} missing`);
}

function assertPathInside(rootDir, candidatePath, label) {
  const relative = path.relative(rootDir, candidatePath);
  assert(
    relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative)),
    `${label} escapes repository root: ${candidatePath}`,
  );
}

function scopedName(name) {
  assertString(name, 'package name');
  return name.split('/').at(-1);
}

function expectedTargetName(sourceName, manifest) {
  return `@${manifest.scope}/${manifest.prefix}${scopedName(sourceName)}`;
}

function collectSourcePackageIndex(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  const packages = new Map();

  function visit(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          visit(entryPath);
        }
        continue;
      }

      if (entry.name !== 'package.json') {
        continue;
      }

      const packageJson = readJson(entryPath);
      if (packageJson.name?.startsWith('@modern-js/')) {
        packages.set(packageJson.name, {
          packageJson,
          packageJsonPath: entryPath,
          packageDir: path.dirname(entryPath),
        });
      }
    }
  }

  visit(packagesDir);
  return packages;
}

function validateNoWorkspaceProtocol(packageJson, packageName) {
  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!isObject(block)) {
      continue;
    }

    for (const [dependencyName, specifier] of Object.entries(block)) {
      assert(
        typeof specifier !== 'string' || !specifier.startsWith('workspace:'),
        `${packageName} ${blockName}.${dependencyName} still uses ${specifier}`,
      );
    }
  }
}

function validateInternalDependencyResolution({
  manifest,
  packageJson,
  packageName,
}) {
  const checks = [];

  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!isObject(block)) {
      continue;
    }

    for (const [dependencyName, specifier] of Object.entries(block)) {
      if (!dependencyName.startsWith('@modern-js/')) {
        continue;
      }

      const hasAlias = Object.prototype.hasOwnProperty.call(
        manifest.aliases,
        dependencyName,
      );
      const targetName = manifest.aliases[dependencyName];
      if (!hasAlias) {
        assert(
          typeof specifier !== 'string' || !specifier.startsWith('workspace:'),
          `${packageName} ${blockName}.${dependencyName} has no alias metadata and still uses ${specifier}`,
        );
        checks.push({
          blockName,
          dependencyName,
          specifier,
          resolution: 'external-registry',
        });
        continue;
      }

      assertString(
        targetName,
        `${packageName} ${blockName}.${dependencyName} has no alias metadata`,
      );

      if (blockName === 'peerDependencies') {
        assert(
          specifier === manifest.dependencyVersion,
          `${packageName} ${blockName}.${dependencyName} must use ${manifest.dependencyVersion}, found ${specifier}`,
        );
      } else {
        const expectedSpecifier = `npm:${targetName}@${manifest.dependencyVersion}`;
        assert(
          specifier === expectedSpecifier,
          `${packageName} ${blockName}.${dependencyName} must resolve to staged cohort ${expectedSpecifier}, found ${specifier}`,
        );
      }

      checks.push({
        blockName,
        dependencyName,
        specifier,
        resolution: 'staged-cohort',
      });
    }
  }

  return checks;
}

function validateCreateRuntimeDependencies(
  packageJson,
  packageName,
  internalChecks,
) {
  const checks = [];

  for (const dependencyName of requiredCreateRuntimeDependencies) {
    const specifier = packageJson.dependencies?.[dependencyName];
    assertString(
      specifier,
      `${packageName} dependencies.${dependencyName} is required because create imports it at runtime`,
    );
    assert(
      packageJson.devDependencies?.[dependencyName] === undefined,
      `${packageName} devDependencies.${dependencyName} must be a runtime dependency`,
    );
    assert(
      internalChecks.some(
        check =>
          check.blockName === 'dependencies' &&
          check.dependencyName === dependencyName &&
          check.resolution === 'staged-cohort',
      ),
      `${packageName} dependencies.${dependencyName} must resolve to the staged BleedingDev cohort`,
    );
    checks.push({
      dependencyName,
      specifier,
    });
  }

  return checks;
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

function validateSourceProof({ repoRoot, manifestPath, outPath, now = Date }) {
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

  const manifest = readJson(resolvedManifestPath);
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

    const packageJson = readJson(path.join(packageDir, 'package.json'));
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
      );
      createPackageProof = {
        sourceName: item.sourceName,
        targetName: item.targetName,
        frameworkVersion: packageJson.ultramodern.frameworkVersion,
        runtimeDependencyChecks,
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

  writeJson(resolvedOutPath, proof);
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

function isDirectRun() {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const proof = validateSourceProof(options);
    console.log(
      `Pre-publish source proof passed for ${proof.cohort.packageCount} package(s); wrote ${path.relative(
        options.repoRoot,
        options.outPath,
      )}`,
    );
  } catch (error) {
    writeJson(options.outPath, errorProof({ ...options, error }));
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}

export { errorProof, parseArgs, validateSourceProof };
