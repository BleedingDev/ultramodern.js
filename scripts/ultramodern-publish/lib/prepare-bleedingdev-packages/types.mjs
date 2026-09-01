// Consumer: publish-bleedingdev.yml validates shipped declarations and create templates.
import fs from 'node:fs';
import path from 'node:path';
import { createTemplateRequiredFiles } from './constants.mjs';

function collectExportedTypePaths(value, typePaths = new Set()) {
  if (!value || typeof value !== 'object') {
    return typePaths;
  }

  if (typeof value.types === 'string') {
    typePaths.add(value.types);
  }

  for (const child of Object.values(value)) {
    collectExportedTypePaths(child, typePaths);
  }

  return typePaths;
}

function collectDeclaredTypePaths(packageJson) {
  const typePaths = collectExportedTypePaths(packageJson.exports);
  if (typeof packageJson.types === 'string') {
    typePaths.add(packageJson.types);
  }
  if (typeof packageJson.publishConfig?.types === 'string') {
    typePaths.add(packageJson.publishConfig.types);
  }
  return typePaths;
}

function normalizeTypePath(packageDir, typePath) {
  if (typeof typePath !== 'string') {
    return typePath;
  }

  if (!typePath.startsWith('.') && !typePath.startsWith('dist/')) {
    return typePath;
  }

  if (fs.existsSync(path.join(packageDir, typePath))) {
    return typePath;
  }

  const prefixedPath = typePath.startsWith('./') ? typePath : `./${typePath}`;
  if (!prefixedPath.startsWith('./dist/')) {
    return typePath;
  }

  const candidate = prefixedPath.replace('./dist/', './dist/types/');
  if (fs.existsSync(path.join(packageDir, candidate))) {
    return typePath.startsWith('./') ? candidate : candidate.slice(2);
  }

  return typePath;
}

function normalizeExportTypePaths(packageDir, value) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (typeof value.types === 'string') {
    value.types = normalizeTypePath(packageDir, value.types);
  }

  for (const child of Object.values(value)) {
    normalizeExportTypePaths(packageDir, child);
  }
}

function normalizeDeclaredTypePaths(packageDir, packageJson) {
  if (typeof packageJson.types === 'string') {
    packageJson.types = normalizeTypePath(packageDir, packageJson.types);
    const hasRootEntrypoint =
      typeof packageJson.main === 'string' ||
      (packageJson.exports &&
        typeof packageJson.exports === 'object' &&
        Object.hasOwn(packageJson.exports, '.'));
    if (
      !hasRootEntrypoint &&
      !fs.existsSync(path.join(packageDir, packageJson.types))
    ) {
      delete packageJson.types;
    }
  }
  normalizeExportTypePaths(packageDir, packageJson.exports);
}

function isWithinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function declaredTypePathExists(packageDir, typePath) {
  const candidate = path.resolve(packageDir, typePath);
  if (fs.existsSync(candidate)) {
    return isWithinDirectory(packageDir, candidate);
  }
  if (!typePath.includes('*')) {
    return false;
  }

  const wildcardIndex = typePath.indexOf('*');
  const staticPrefix = typePath.slice(0, wildcardIndex);
  const prefixDirectory = staticPrefix.endsWith('/')
    ? staticPrefix
    : path.dirname(staticPrefix);
  if (
    !isWithinDirectory(packageDir, path.resolve(packageDir, prefixDirectory))
  ) {
    return false;
  }

  return fs.globSync(typePath, { cwd: packageDir }).some(match => {
    const matchPath = path.resolve(packageDir, match);
    return (
      isWithinDirectory(packageDir, matchPath) &&
      fs.statSync(matchPath, { throwIfNoEntry: false })?.isFile()
    );
  });
}

function validateStagedTypeFiles(packageDir, packageJson) {
  const typePaths = collectDeclaredTypePaths(packageJson);

  const missing = [...typePaths]
    .filter(typePath => typePath.startsWith('.'))
    .filter(typePath => !declaredTypePathExists(packageDir, typePath));

  if (missing.length > 0) {
    throw new Error(
      `${packageJson.name}@${packageJson.version} declares missing type files: ${missing.join(
        ', ',
      )}`,
    );
  }
}

function validateCreateTemplateFiles(packageDir, packageName) {
  const missing = createTemplateRequiredFiles.filter(
    relativePath => !fs.existsSync(path.join(packageDir, relativePath)),
  );

  if (missing.length > 0) {
    throw new Error(
      `${packageName} staged package is missing required create template file(s): ${missing.join(
        ', ',
      )}`,
    );
  }
}

export {
  normalizeDeclaredTypePaths,
  validateCreateTemplateFiles,
  validateStagedTypeFiles,
};
