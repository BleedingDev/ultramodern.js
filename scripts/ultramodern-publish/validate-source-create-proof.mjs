#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cliKit from '../lib/cli-kit.js';
import fsKit from '../lib/fs-kit.js';

const { parseCliArgs } = cliKit;
const { readJsonFile, writeJsonFile } = fsKit;
const requireFromScript = createRequire(import.meta.url);

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
const requiredCreateRuntimeDependencies = [
  '@modern-js/codesmith',
  '@modern-js/i18n-utils',
];
const requiredCreatePublishedPaths = [
  'bin/run.js',
  'dist/cjs/index.cjs',
  'dist/cjs/ultramodern-workspace/codesmith.cjs',
  'dist/cjs/ultramodern-workspace/public-api.cjs',
  'dist/esm-node/index.js',
  'dist/esm-node/ultramodern-workspace/codesmith.js',
  'dist/esm-node/ultramodern-workspace/public-api.js',
  'dist/types/index.d.ts',
  'dist/types/ultramodern-workspace/codesmith.d.ts',
  'dist/types/ultramodern-workspace/public-api.d.ts',
  'template-workspace',
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
  'templates',
];
const publicCreateExportSubpaths = [
  '.',
  './ultramodern-workspace',
  './ultramodern-workspace/codesmith',
];
const cliValueOptions = new Set(['--root', '--manifest', '--out']);

class SourceCreateProofError extends Error {
  constructor(category, message) {
    super(`${category}: ${message}`);
    this.name = 'SourceCreateProofError';
    this.category = category;
  }
}

function rejectInlineOptionSyntax(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (/^--[^=]+=/.test(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (cliValueOptions.has(arg)) {
      const value = argv[index + 1];
      if (value) {
        index += 1;
      }
      continue;
    }
    return;
  }
}

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv);

  const options = parseCliArgs(argv, {
    defaults: {
      repoRoot: defaultRepoRoot,
      manifestPath: defaultManifestPath,
      outPath: defaultOutPath,
    },
    ignoreTerminator: true,
    options: {
      root: {
        key: 'repoRoot',
      },
      manifest: {
        key: 'manifestPath',
      },
      out: {
        key: 'outPath',
      },
    },
  });

  return {
    ...options,
    repoRoot: path.resolve(options.repoRoot),
    manifestPath: path.resolve(options.manifestPath),
    outPath: path.resolve(options.outPath),
  };
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

function failProof(category, message) {
  throw new SourceCreateProofError(category, message);
}

function assertProof(condition, category, message) {
  if (!condition) {
    failProof(category, message);
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

      const packageJson = readJsonFile(entryPath);
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
  manifest,
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
    if (
      Object.prototype.hasOwnProperty.call(manifest.aliases, dependencyName)
    ) {
      assert(
        internalChecks.some(
          check =>
            check.blockName === 'dependencies' &&
            check.dependencyName === dependencyName &&
            check.resolution === 'staged-cohort',
        ),
        `${packageName} dependencies.${dependencyName} must resolve to the staged BleedingDev cohort`,
      );
    }
    checks.push({
      dependencyName,
      specifier,
    });
  }

  return checks;
}

function assertExistingPublishedPath(packageDir, packageName, relativePath) {
  const fullPath = path.join(packageDir, relativePath);
  assertProof(
    fs.existsSync(fullPath),
    'template/package files',
    `${packageName} staged package is missing required published path: ${relativePath}`,
  );
}

function validateCreatePublishedPaths(packageDir, packageName) {
  for (const relativePath of requiredCreatePublishedPaths) {
    assertExistingPublishedPath(packageDir, packageName, relativePath);
  }

  return {
    requiredPathCount: requiredCreatePublishedPaths.length,
    requiredPaths: requiredCreatePublishedPaths,
  };
}

function validateExportTarget(packageDir, packageName, subpath, exportValue) {
  assertProof(
    isObject(exportValue),
    'export config',
    `${packageName} exports.${subpath} must be an object`,
  );
  assertString(exportValue.types, `${packageName} exports.${subpath}.types`);
  assertExistingPublishedPath(
    packageDir,
    packageName,
    exportValue.types.replace(/^\.\//, ''),
  );

  assertProof(
    isObject(exportValue.node),
    'export config',
    `${packageName} exports.${subpath}.node must be an object`,
  );
  for (const condition of ['import', 'require']) {
    assertString(
      exportValue.node[condition],
      `${packageName} exports.${subpath}.node.${condition}`,
    );
    assertExistingPublishedPath(
      packageDir,
      packageName,
      exportValue.node[condition].replace(/^\.\//, ''),
    );
  }
}

function validateCreatePublicExports(
  packageDir,
  packageJson,
  sourcePackageJson,
  packageName,
) {
  assertProof(
    isObject(packageJson.exports),
    'export config',
    `${packageName} exports must be an object`,
  );
  assertProof(
    isObject(sourcePackageJson.publishConfig?.exports),
    'export config',
    `${packageName} source publishConfig.exports must be an object`,
  );

  const runtimeExportKeys = Object.keys(packageJson.exports).sort();
  const publishExportKeys = Object.keys(
    sourcePackageJson.publishConfig.exports,
  ).sort();
  assertProof(
    JSON.stringify(runtimeExportKeys) === JSON.stringify(publishExportKeys),
    'export config',
    `${packageName} package exports and source publishConfig.exports must expose the same subpaths`,
  );

  for (const subpath of publicCreateExportSubpaths) {
    validateExportTarget(
      packageDir,
      packageName,
      subpath,
      packageJson.exports[subpath],
    );
    validateExportTarget(
      packageDir,
      packageName,
      subpath,
      sourcePackageJson.publishConfig.exports[subpath],
    );
  }

  return {
    publicSubpaths: publicCreateExportSubpaths,
  };
}

function packagePath(rootDir, packageName) {
  return path.join(rootDir, ...packageName.split('/'));
}

function forceSymlinkPackage(rootDir, packageName, targetDir) {
  const installPath = packagePath(rootDir, packageName);
  fs.rmSync(installPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  fs.symlinkSync(targetDir, installPath, 'dir');
}

function forceCopyPackage(rootDir, packageName, targetDir) {
  const installPath = packagePath(rootDir, packageName);
  fs.rmSync(installPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  fs.cpSync(targetDir, installPath, {
    recursive: true,
    verbatimSymlinks: true,
  });
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...(options.env ?? {}),
    },
  });

  if (result.error) {
    failProof(
      options.category,
      `${command} ${args.join(' ')} failed to start: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
    failProof(
      options.category,
      [`${command} ${args.join(' ')} exited ${result.status}`, output.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return result.stdout;
}

function packStagedCreatePackage(packageDir, tempDir, packageName) {
  const packDir = path.join(tempDir, 'pack');
  fs.mkdirSync(packDir, { recursive: true });
  const stdout = runChecked(
    'npm',
    ['pack', '--json', '--ignore-scripts', packageDir],
    {
      cwd: packDir,
      category: 'package root',
    },
  );

  let packResult;
  try {
    packResult = JSON.parse(stdout);
  } catch (error) {
    failProof(
      'package root',
      `${packageName} npm pack did not return JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const [firstResult] = packResult;
  assertProof(
    packResult.length === 1 && firstResult?.filename,
    'package root',
    `${packageName} npm pack must create exactly one tarball`,
  );

  const tarballPath = path.join(packDir, firstResult.filename);
  assertProof(
    fs.existsSync(tarballPath),
    'package root',
    `${packageName} npm pack tarball was not created`,
  );

  return {
    tarballPath,
    filename: firstResult.filename,
    fileCount: firstResult.files?.length,
  };
}

function extractPackageTarball(tarballPath, targetDir, category) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  runChecked('tar', ['-xzf', tarballPath, '-C', targetDir], {
    cwd: targetDir,
    category,
  });
  const extractedPackageDir = path.join(targetDir, 'package');
  assertProof(
    fs.existsSync(path.join(extractedPackageDir, 'package.json')),
    category,
    `Extracted package from ${tarballPath} is missing package.json`,
  );
  return extractedPackageDir;
}

function findNodeModulesPackageDir(dependencyName, resolutionRoot) {
  let currentDir = path.resolve(resolutionRoot);
  while (true) {
    const packageDir = packagePath(
      path.join(currentDir, 'node_modules'),
      dependencyName,
    );
    if (fs.existsSync(path.join(packageDir, 'package.json'))) {
      return packageDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

function resolveExternalDependencyPackageDir(dependencyName, resolutionRoots) {
  for (const resolutionRoot of resolutionRoots) {
    try {
      return path.dirname(
        requireFromScript.resolve(`${dependencyName}/package.json`, {
          paths: [resolutionRoot],
        }),
      );
    } catch {
      // Try the next resolution root.
    }

    const packageDir = findNodeModulesPackageDir(
      dependencyName,
      resolutionRoot,
    );
    if (packageDir) {
      return packageDir;
    }
  }

  return undefined;
}

function linkExternalDependency(
  consumerNodeModules,
  dependencyName,
  resolutionRoots,
) {
  const externalDependencyPath = resolveExternalDependencyPackageDir(
    dependencyName,
    resolutionRoots.filter(Boolean),
  );
  if (!externalDependencyPath) {
    return false;
  }

  forceSymlinkPackage(
    consumerNodeModules,
    dependencyName,
    fs.realpathSync(externalDependencyPath),
  );
  return true;
}

function runtimeDependencyNames(packageJson) {
  const names = new Set();
  for (const blockName of ['dependencies', 'optionalDependencies']) {
    const block = packageJson[blockName];
    if (!isObject(block)) {
      continue;
    }
    for (const dependencyName of Object.keys(block)) {
      names.add(dependencyName);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function linkExternalRuntimeDependencies({
  consumerNodeModules,
  packageJson,
  packageName,
  repoRoot,
  resolutionRoot,
  sourceNames,
  targetNames,
}) {
  for (const dependencyName of runtimeDependencyNames(packageJson)) {
    if (sourceNames.has(dependencyName) || targetNames.has(dependencyName)) {
      continue;
    }

    assertProof(
      linkExternalDependency(consumerNodeModules, dependencyName, [
        resolutionRoot,
        repoRoot,
      ]),
      'package root',
      `${packageName} external dependency ${dependencyName} is not available for installed-package proof`,
    );
  }
}

function installPackedCreateConsumer({
  createItem,
  createPackageDir,
  manifest,
  packInfo,
  repoRoot,
  sourcePackageDir,
  sourcePackageDirs = {},
  tempDir,
}) {
  const consumerDir = path.join(tempDir, 'consumer');
  const nodeModulesDir = path.join(consumerDir, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });

  const extractedDir = extractPackageTarball(
    packInfo.tarballPath,
    path.join(tempDir, 'extracted-create'),
    'package root',
  );
  const installedCreateDir = packagePath(nodeModulesDir, createItem.targetName);
  fs.mkdirSync(path.dirname(installedCreateDir), { recursive: true });
  fs.renameSync(extractedDir, installedCreateDir);
  forceSymlinkPackage(
    nodeModulesDir,
    createItem.sourceName,
    installedCreateDir,
  );

  const sourceNames = new Set(manifest.packages.map(item => item.sourceName));
  const targetNames = new Set(manifest.packages.map(item => item.targetName));

  for (const item of manifest.packages) {
    if (item.sourceName === createItem.sourceName) {
      continue;
    }

    const packageDir = path.resolve(repoRoot, item.packageDir);
    forceCopyPackage(nodeModulesDir, item.sourceName, packageDir);
    forceCopyPackage(nodeModulesDir, item.targetName, packageDir);
    const packageJson = readJsonFile(path.join(packageDir, 'package.json'));
    linkExternalRuntimeDependencies({
      consumerNodeModules: nodeModulesDir,
      packageJson,
      packageName: item.targetName,
      repoRoot,
      resolutionRoot: sourcePackageDirs[item.sourceName] ?? repoRoot,
      sourceNames,
      targetNames,
    });
  }

  const createPackageJson = readJsonFile(
    path.join(installedCreateDir, 'package.json'),
  );
  linkExternalRuntimeDependencies({
    consumerNodeModules: nodeModulesDir,
    packageJson: createPackageJson,
    packageName: createItem.targetName,
    repoRoot,
    resolutionRoot: sourcePackageDir,
    sourceNames,
    targetNames,
  });

  return {
    consumerDir,
    installedCreateDir,
    nodeModulesDir,
  };
}

function runInstalledCreateSmoke({
  consumerDir,
  createItem,
  installedCreateDir,
  manifest,
}) {
  const env = {
    MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: manifest.dependencyVersion,
  };
  const cliWorkspace = 'cli-proof-workspace';
  runChecked(
    process.execPath,
    [
      path.join(installedCreateDir, 'bin/run.js'),
      cliWorkspace,
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      manifest.dependencyVersion,
    ],
    {
      cwd: consumerDir,
      env,
      category: 'package root',
    },
  );
  assertProof(
    fs.existsSync(
      path.join(
        consumerDir,
        cliWorkspace,
        '.modernjs/ultramodern-workspace-template-manifest.json',
      ),
    ),
    'generated output',
    'Installed create CLI did not generate the workspace template manifest',
  );

  const packageSpecifier = createItem.targetName;
  const esmProgram = `
    import fs from 'node:fs';
    import path from 'node:path';
    import {
      addUltramodernVertical,
      generateUltramodernWorkspace,
      planUltramodernVertical,
    } from ${JSON.stringify(`${packageSpecifier}/ultramodern-workspace`)};
    import adapter from ${JSON.stringify(`${packageSpecifier}/ultramodern-workspace/codesmith`)};

    if (typeof adapter !== 'function') {
      throw new Error('Expected CodeSmith adapter default export');
    }

    const workspaceRoot = path.join(process.cwd(), 'esm-proof-workspace');
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'esm-proof-workspace',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: ${JSON.stringify(manifest.dependencyVersion)},
      },
    });
    const verticalResult = addUltramodernVertical({
      workspaceRoot,
      name: 'catalog',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
    });
    const plan = planUltramodernVertical({
      workspaceRoot,
      name: 'checkout',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
    });

    if (workspaceResult.operation !== 'workspace') {
      throw new Error('Expected workspace generation result');
    }
    if (
      verticalResult.operation !== 'vertical' ||
      verticalResult.assignedPorts.catalog !== 4101 ||
      verticalResult.effectApiPrefixes.catalog !== '/catalog-api'
    ) {
      throw new Error('Expected MicroVertical generation result');
    }
    if (plan.dryRun !== true || plan.selectedPort !== 4102) {
      throw new Error('Expected MicroVertical dry-run plan');
    }
    for (const relativePath of [
      '.modernjs/ultramodern-generated-contract.json',
      'apps/shell-super-app/package.json',
      'verticals/catalog/package.json',
      'verticals/catalog/shared/effect/api.ts',
    ]) {
      if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
        throw new Error('Missing generated output: ' + relativePath);
      }
    }
  `;
  runChecked(process.execPath, ['--input-type=module', '--eval', esmProgram], {
    cwd: consumerDir,
    env,
    category: 'package root',
  });

  const cjsProgram = `
    const fs = require('node:fs');
    const path = require('node:path');
    const publicApi = require(${JSON.stringify(`${packageSpecifier}/ultramodern-workspace`)});
    const adapterModule = require(${JSON.stringify(`${packageSpecifier}/ultramodern-workspace/codesmith`)});
    const adapter = adapterModule.default || adapterModule;
    if (typeof adapter !== 'function') {
      throw new Error('Expected CodeSmith adapter CJS export');
    }
    const workspaceRoot = path.join(process.cwd(), 'cjs-proof-workspace');
    const result = publicApi.generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'cjs-proof-workspace',
      modernVersion: ${JSON.stringify(manifest.dependencyVersion)},
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: ${JSON.stringify(manifest.dependencyVersion)},
      },
    });
    if (result.operation !== 'workspace') {
      throw new Error('Expected CJS workspace generation result');
    }
    if (!fs.existsSync(path.join(workspaceRoot, 'apps/shell-super-app/package.json'))) {
      throw new Error('Missing CJS generated shell package');
    }
  `;
  runChecked(process.execPath, ['--eval', cjsProgram], {
    cwd: consumerDir,
    env,
    category: 'package root',
  });

  return {
    cliWorkspace,
    esmWorkspace: 'esm-proof-workspace',
    cjsWorkspace: 'cjs-proof-workspace',
    importedSubpaths: [
      `${packageSpecifier}/ultramodern-workspace`,
      `${packageSpecifier}/ultramodern-workspace/codesmith`,
    ],
  };
}

function runCreatePackageRuntimeProof({
  createItem,
  createPackageDir,
  manifest,
  repoRoot,
  sourcePackageDir,
  sourcePackageDirs,
}) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-publish-proof-'),
  );

  try {
    const packInfo = packStagedCreatePackage(
      createPackageDir,
      tempDir,
      createItem.targetName,
    );
    const installInfo = installPackedCreateConsumer({
      createItem,
      createPackageDir,
      manifest,
      packInfo,
      repoRoot,
      sourcePackageDir,
      sourcePackageDirs,
      tempDir,
    });
    const smoke = runInstalledCreateSmoke({
      consumerDir: installInfo.consumerDir,
      createItem,
      installedCreateDir: installInfo.installedCreateDir,
      manifest,
    });

    return {
      packedTarball: packInfo.filename,
      packedFileCount: packInfo.fileCount,
      installedPackageName: createItem.targetName,
      ...smoke,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
    writeJsonFile(options.outPath, errorProof({ ...options, error }));
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  await main();
}

export { errorProof, parseArgs, validateSourceProof };
