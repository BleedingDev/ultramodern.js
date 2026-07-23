import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { collectPackageJsonFiles } from '../fs-utils.mjs';
import { repoRoot } from './constants.mjs';

const { readJsonFile } = fsKit;

function targetPackageName(sourceName, options) {
  const unscopedName = sourceName.split('/').at(-1);
  return `@${options.scope}/${options.prefix}${unscopedName}`;
}

function aliasSpecifier(sourceName, options) {
  return `npm:${targetPackageName(sourceName, options)}@${
    options.dependencyVersion
  }`;
}

function normalizeBinPath(binPath) {
  if (typeof binPath !== 'string') {
    return binPath;
  }

  if (binPath.startsWith('./')) {
    return binPath.slice(2);
  }

  return binPath;
}

function normalizeBin(packageJson) {
  if (typeof packageJson.bin === 'string') {
    packageJson.bin = normalizeBinPath(packageJson.bin);
    return;
  }

  if (!packageJson.bin || typeof packageJson.bin !== 'object') {
    return;
  }

  for (const binName of Object.keys(packageJson.bin)) {
    packageJson.bin[binName] = normalizeBinPath(packageJson.bin[binName]);
  }
}

function rewritePackageMetadata(packageJson, options) {
  const directory =
    packageJson.repository &&
    typeof packageJson.repository === 'object' &&
    typeof packageJson.repository.directory === 'string'
      ? packageJson.repository.directory
      : undefined;

  packageJson.homepage = options.homepage;
  packageJson.bugs = {
    url: options.bugsUrl,
  };
  packageJson.repository = {
    type: 'git',
    url: options.repositoryUrl,
    ...(directory ? { directory } : {}),
  };
}

function collectModernPackages(options) {
  const allPackages = collectPackageJsonFiles(path.join(repoRoot, 'packages'))
    .map(packageJsonPath => {
      const packageJson = readJsonFile(packageJsonPath);
      return {
        packageJsonPath,
        dir: path.dirname(packageJsonPath),
        packageJson,
      };
    })
    .filter(({ packageJson }) => packageJson.name?.startsWith('@modern-js/'))
    .filter(({ packageJson }) => !packageJson.private)
    .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));

  const sourceNames = new Set(allPackages.map(item => item.packageJson.name));
  const aliases = Object.fromEntries(
    allPackages.map(item => [
      item.packageJson.name,
      targetPackageName(item.packageJson.name, options),
    ]),
  );

  return {
    allPackages,
    packages: allPackages,
    sourceNames,
    aliases,
  };
}

function enforceSingleVersionPolicy(options, packages, allPackages) {
  if (options.dependencyVersion !== options.version) {
    return;
  }

  const selected = new Set(packages.map(item => item.packageJson.name));
  const missing = allPackages
    .map(item => item.packageJson.name)
    .filter(packageName => !selected.has(packageName));

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `Single-version policy violation for ${options.version}.`,
      'When dependencyVersion equals version, every public @modern-js/* package must be published together so generated projects cannot reference a partially published framework version.',
      'BleedingDev package publishing does not support subset releases.',
      `Missing packages: ${missing.join(', ')}`,
    ].join('\n'),
  );
}

function rewriteDependencyBlock(
  block,
  options,
  sourceNames,
  { peer = false, optional = false } = {},
) {
  if (!block) {
    return;
  }

  for (const packageName of Object.keys(block)) {
    if (!packageName.startsWith('@modern-js/')) {
      continue;
    }

    if (!sourceNames.has(packageName) && optional) {
      delete block[packageName];
      continue;
    }

    if (!sourceNames.has(packageName)) {
      if (!String(block[packageName]).startsWith('workspace:')) {
        continue;
      }

      throw new Error(
        `Cannot rewrite unpublished internal dependency ${packageName}`,
      );
    }

    block[packageName] = peer
      ? options.dependencyVersion
      : aliasSpecifier(packageName, options);
  }
}

function canonicalizeDependencyMetadata(packageJson) {
  for (const blockName of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    const block = packageJson[blockName];
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }

    packageJson[blockName] = Object.fromEntries(
      Object.keys(block)
        .sort()
        .map(packageName => [packageName, block[packageName]]),
    );
  }
}

function stripModernSourceConditions(exportsValue) {
  if (Array.isArray(exportsValue)) {
    return exportsValue.map(entry => stripModernSourceConditions(entry));
  }
  if (exportsValue && typeof exportsValue === 'object') {
    const next = {};
    for (const [condition, target] of Object.entries(exportsValue)) {
      if (condition === 'modern:source') {
        continue;
      }
      next[condition] = stripModernSourceConditions(target);
    }
    return next;
  }
  return exportsValue;
}

function rewritePackageJson(packageJson, sourceName, options, sourceNames) {
  packageJson.name = targetPackageName(sourceName, options);
  packageJson.version = options.version;
  rewritePackageMetadata(packageJson, options);
  normalizeBin(packageJson);
  packageJson.publishConfig = {
    ...(packageJson.publishConfig ?? {}),
    access: 'public',
  };
  // Trusted publishing supplies the registry and dist-tag; a tarball that
  // pins either would bypass the workflow's authority (policy: forbidden).
  delete packageJson.publishConfig.registry;
  delete packageJson.publishConfig.tag;
  // The in-repo `modern:source` export condition points at src/ files that
  // are not shipped; a published manifest must not advertise them and the
  // exports maps must stay deep-equal for acceptance.
  packageJson.exports = stripModernSourceConditions(packageJson.exports);
  if (packageJson.publishConfig.exports !== undefined) {
    packageJson.publishConfig.exports = stripModernSourceConditions(
      packageJson.publishConfig.exports,
    );
  }
  if (sourceName === '@modern-js/create') {
    packageJson.ultramodern = {
      ...(packageJson.ultramodern ?? {}),
      frameworkVersion: options.dependencyVersion,
    };
  }

  rewriteDependencyBlock(packageJson.dependencies, options, sourceNames);
  rewriteDependencyBlock(
    packageJson.optionalDependencies,
    options,
    sourceNames,
  );
  rewriteDependencyBlock(packageJson.devDependencies, options, sourceNames, {
    optional: true,
  });
  rewriteDependencyBlock(packageJson.peerDependencies, options, sourceNames, {
    peer: true,
  });
  // pnpm pack may append resolved workspace dependencies in a different order
  // depending on the preceding install/build state. npm tarballs preserve JSON
  // key order, so canonicalize only dependency maps (where order has no
  // semantics) and deliberately leave condition-sensitive exports untouched.
  canonicalizeDependencyMetadata(packageJson);
}

export {
  collectModernPackages,
  enforceSingleVersionPolicy,
  rewritePackageJson,
  targetPackageName,
};
