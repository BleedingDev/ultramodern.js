import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { assertProof, isObject } from '../assertions.mjs';
import { forceSymlinkPackage, packagePath } from './package-store.mjs';

const requireFromScript = createRequire(new URL('../runtime-proof.mjs', import.meta.url));

export function findNodeModulesPackageDir(dependencyName, resolutionRoot) {
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

export function resolveExternalDependencyPackageDir(dependencyName, resolutionRoots) {
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

export function linkExternalDependency(
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

export function runtimeDependencyNames(packageJson) {
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

export function linkExternalRuntimeDependencies({
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
