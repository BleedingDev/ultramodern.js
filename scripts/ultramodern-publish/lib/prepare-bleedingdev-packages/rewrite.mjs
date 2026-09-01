import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { collectPackageJsonFiles } from '../fs-utils.mjs';
import {
  incorporatedModernCreateSourceName,
  repoRoot,
  ultramodernCreateSourceName,
} from './constants.mjs';

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

  const packages = allPackages.filter(
    ({ packageJson }) =>
      packageJson.name !== incorporatedModernCreateSourceName,
  );
  if (
    !packages.some(
      ({ packageJson }) => packageJson.name === ultramodernCreateSourceName,
    )
  ) {
    throw new Error(
      `BleedingDev publishing requires ${ultramodernCreateSourceName}; the upstream ${incorporatedModernCreateSourceName} package is only the incorporated Modern.js version anchor.`,
    );
  }

  const sourceNames = new Set(packages.map(item => item.packageJson.name));
  const aliases = Object.fromEntries(
    packages.map(item => [
      item.packageJson.name,
      targetPackageName(item.packageJson.name, options),
    ]),
  );

  return {
    allPackages,
    packages,
    sourceNames,
    aliases,
  };
}

function assertReleaseBaseMatchesSource(options, allPackages) {
  const sourcePackage = allPackages.find(
    item => item.packageJson.name === incorporatedModernCreateSourceName,
  );
  const sourceVersion = sourcePackage?.packageJson.version;
  if (
    typeof sourceVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(sourceVersion)
  ) {
    throw new Error(
      'Cannot determine the incorporated Modern.js source version from @modern-js/create.',
    );
  }

  const releaseMatch = /^(\d+\.\d+\.\d+)-ultramodern\.([1-9]\d*)$/.exec(
    options.version,
  );
  if (!releaseMatch) {
    throw new Error(
      `Release version ${options.version} must use the form ${sourceVersion}-ultramodern.<revision>.`,
    );
  }

  const releaseBase = releaseMatch[1];
  if (releaseBase !== sourceVersion) {
    throw new Error(
      `Release base ${releaseBase} does not match the incorporated Modern.js source version ${sourceVersion}.`,
    );
  }
}

function enforceSingleVersionPolicy(options, packages, allPackages) {
  assertReleaseBaseMatchesSource(options, allPackages);

  if (options.dependencyVersion !== options.version) {
    return;
  }

  const selected = new Set(packages.map(item => item.packageJson.name));
  const missing = allPackages
    .map(item => item.packageJson.name)
    .filter(packageName => packageName !== incorporatedModernCreateSourceName)
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

// The rewriter renames dependency KEYS but never the target inside an
// `npm:<name>@<range>` alias specifier. A published package that still aliases
// an upstream @modern-js/* name would point consumers at a name this fork does
// not publish, so the specifier is rejected instead of silently rewritten.
function assertNoModernAliasTarget(
  specifier,
  { blockName, dependencyName, packageName },
) {
  if (
    typeof specifier !== 'string' ||
    !/^npm:@modern-js\//u.test(specifier)
  ) {
    return;
  }

  throw new Error(
    [
      `${packageName} ${blockName}.${dependencyName} uses the alias specifier ${specifier}.`,
      'BleedingDev package rewriting renames dependency keys but never npm: alias targets, so this would publish a dependency on the unpublished upstream name.',
      'Point the alias at a published @bleedingdev/* target (or drop the alias) before releasing.',
    ].join('\n'),
  );
}

function rewriteDependencyBlock(
  block,
  options,
  sourceNames,
  {
    peer = false,
    optional = false,
    blockName = 'dependencies',
    packageName: ownerName = 'package',
  } = {},
) {
  if (!block) {
    return;
  }

  for (const packageName of Object.keys(block)) {
    assertNoModernAliasTarget(block[packageName], {
      blockName,
      dependencyName: packageName,
      packageName: ownerName,
    });

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
  if (sourceName === ultramodernCreateSourceName) {
    packageJson.ultramodern = {
      ...(packageJson.ultramodern ?? {}),
      frameworkVersion: options.dependencyVersion,
    };
  }

  const ownerName = packageJson.name;
  rewriteDependencyBlock(packageJson.dependencies, options, sourceNames, {
    blockName: 'dependencies',
    packageName: ownerName,
  });
  rewriteDependencyBlock(
    packageJson.optionalDependencies,
    options,
    sourceNames,
    {
      blockName: 'optionalDependencies',
      packageName: ownerName,
    },
  );
  rewriteDependencyBlock(packageJson.devDependencies, options, sourceNames, {
    blockName: 'devDependencies',
    optional: true,
    packageName: ownerName,
  });
  rewriteDependencyBlock(packageJson.peerDependencies, options, sourceNames, {
    blockName: 'peerDependencies',
    peer: true,
    packageName: ownerName,
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
