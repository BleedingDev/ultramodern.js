import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../../lib/fs-kit.js';
import { linkExternalRuntimeDependencies } from './dependency-linking.mjs';
import {
  extractPackageTarball,
  forceCopyPackage,
  forceSymlinkPackage,
  packagePath,
} from './package-store.mjs';

const { readJsonFile } = fsKit;

export function installPackedCreateConsumer({
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
