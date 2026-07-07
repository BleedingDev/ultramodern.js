import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { assertProof, failProof, isObject } from './assertions.mjs';

const { readJsonFile } = fsKit;
const requireFromScript = createRequire(import.meta.url);

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
      path.join(consumerDir, cliWorkspace, '.modernjs/ultramodern.json'),
    ),
    'generated output',
    'Installed create CLI did not generate compact UltraModern config',
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
      verticalResult.apiPrefixes.catalog !== '/catalog-api'
    ) {
      throw new Error('Expected MicroVertical generation result');
    }
    if (plan.dryRun !== true || plan.selectedPort !== 4102) {
      throw new Error('Expected MicroVertical dry-run plan');
    }
    for (const relativePath of [
      '.modernjs/ultramodern.json',
      'apps/shell-super-app/package.json',
      'scripts/check-ultramodern-api-boundaries.mts',
      'verticals/catalog/package.json',
      'verticals/catalog/api/index.ts',
      'verticals/catalog/shared/api.ts',
      'verticals/catalog/src/api/catalog-client.ts',
    ]) {
      if (!fs.existsSync(path.join(workspaceRoot, relativePath))) {
        throw new Error('Missing generated output: ' + relativePath);
      }
    }
    for (const forbiddenPath of [
      'verticals/catalog/api/effect/index.ts',
      'verticals/catalog/shared/effect/api.ts',
      'verticals/catalog/src/effect/catalog-client.ts',
    ]) {
      if (fs.existsSync(path.join(workspaceRoot, forbiddenPath))) {
        throw new Error('Forbidden strict Effect side path exists: ' + forbiddenPath);
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

export { runCreatePackageRuntimeProof };
