// Consumer: publish-bleedingdev.yml validates shipped declarations and create templates.
import fs from 'node:fs';
import path from 'node:path';
import { createTemplateRequiredFiles } from './constants.mjs';
import { runAsync } from './commands.mjs';

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

function hasDeclaredTypeFile(packageDir, typePath) {
  if (typeof typePath !== 'string') {
    return true;
  }

  const prefixedPath = typePath.startsWith('./') ? typePath : `./${typePath}`;
  const candidates = [typePath];
  if (prefixedPath.startsWith('./dist/')) {
    candidates.push(
      typePath.startsWith('./')
        ? prefixedPath.replace('./dist/', './dist/types/')
        : prefixedPath.replace('./dist/', './dist/types/').slice(2),
    );
  }

  return candidates.some(candidate =>
    fs.existsSync(path.join(packageDir, candidate)),
  );
}

function shouldGenerateSourceDeclarations(packageDir, packageJson) {
  if (
    !fs.existsSync(path.join(packageDir, 'src')) ||
    !fs.existsSync(path.join(packageDir, 'tsconfig.json'))
  ) {
    return false;
  }

  return [...collectDeclaredTypePaths(packageJson)].some(
    typePath =>
      typeof typePath === 'string' &&
      (typePath.includes('/dist/types/') ||
        typePath.startsWith('dist/types/') ||
        /^\.?\/?dist\/.+\.d\.[cm]?ts$/.test(typePath)) &&
      !hasDeclaredTypeFile(packageDir, typePath),
  );
}

// Strict pre-pass over the whole cohort, fully joined before any staging or
// packing begins. Each tsgo invocation only reads committed src/tsconfig and
// writes dist/types plus a pid+timestamp-unique temp tsconfig under its own
// package root, so mutually independent roots can generate concurrently
// without changing any emitted byte; nested or duplicated roots would race
// and are rejected instead of serialized.
async function generateSourceDeclarationsBatch(items, runAsyncImpl = runAsync) {
  const pending = items.filter(item =>
    shouldGenerateSourceDeclarations(item.dir, item.packageJson),
  );
  const roots = pending.map(item => path.resolve(item.dir));
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (
        roots[left] === roots[right] ||
        roots[left].startsWith(`${roots[right]}${path.sep}`) ||
        roots[right].startsWith(`${roots[left]}${path.sep}`)
      ) {
        throw new Error(
          `Parallel declaration generation requires mutually independent package dirs; found ${roots[left]} and ${roots[right]}`,
        );
      }
    }
  }
  await Promise.all(
    pending.map(item =>
      runAsyncImpl('pnpm', ['-w', 'run', 'tsgo:dts', item.dir]),
    ),
  );
  return pending.length;
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

function validateStagedTypeFiles(packageDir, packageJson) {
  const typePaths = collectDeclaredTypePaths(packageJson);

  const missing = [...typePaths]
    .filter(typePath => typePath.startsWith('.'))
    .filter(typePath => !fs.existsSync(path.join(packageDir, typePath)));

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
  generateSourceDeclarationsBatch,
  normalizeDeclaredTypePaths,
  validateCreateTemplateFiles,
  validateStagedTypeFiles,
};
