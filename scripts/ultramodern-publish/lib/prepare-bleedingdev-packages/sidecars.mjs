// Consumer: prepare-bleedingdev-packages.mjs version-preserving sidecar staging lane.
//
// Sidecars are fork-owned republications of upstream packages that the shipped
// @modern-js/image dependency cone cannot redirect any other way (plain
// dependencies are not reachable from a consumer's overrides). They are NOT
// part of the Modern.js cohort:
//   * their names are never prefixed with the cohort prefix (`modern-js-`) -
//     npm-normalize-package-bin derives a string-form bin's key from
//     basename(name), so a prefixed name would silently rename `ipx` to
//     `modern-js-ipx` and break `npx ipx`;
//   * their versions are never forced to the cohort's
//     X.Y.Z-ultramodern.N revision - npm evaluates the non-wildcard peer
//     `ipx: >=3.0.3` (declared by @rsbuild-image/core and
//     @rsbuild-image/react) with a loose-only semver check that EXCLUDES
//     prereleases, so a prerelease sidecar would satisfy pnpm but fail every
//     strict npm/yarn-classic consumer;
//   * their dependency keys are never rewritten - a sidecar manifest is
//     published exactly as it is vendored.
import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import {
  repoRoot as defaultRepoRoot,
  sidecarManifestFile,
  sidecarScope,
} from './constants.mjs';

const { readJsonFile, writeJsonFile } = fsKit;

const SIDECAR_PACKAGE_ROOTS = [
  'packages/sidecar/ipx',
  'packages/sidecar/image-size',
  'packages/sidecar/rsbuild-image-core',
];

// Upstream CLI contracts that must survive republication verbatim.
const sidecarBinNames = new Map([
  ['@bleedingdev/ipx', 'ipx'],
  ['@bleedingdev/image-size', 'image-size'],
]);

const stableVersionPattern = /^\d+\.\d+\.\d+$/u;

const aliasSpecifierPattern =
  /^npm:(?<target>@[^/]+\/[^@]+|[^@][^@]*)@(?<version>.+)$/u;

const dependencyBlockNames = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

const stagedDirectoryName = name => name.replaceAll('/', '__');

function unscopedName(name) {
  return name.slice(sidecarScope.length + 1);
}

function normalizeBinPath(binPath) {
  return typeof binPath === 'string' && binPath.startsWith('./')
    ? binPath.slice(2)
    : binPath;
}

/**
 * Mirror of npm-normalize-package-bin for the cases a sidecar can hit: a
 * string bin becomes `{ [basename(name)]: value }`. This is the reason a
 * sidecar name may never carry the cohort prefix.
 */
function normalizeSidecarBin(packageJson) {
  const { bin, name } = packageJson;
  if (bin === undefined || bin === null) {
    return undefined;
  }

  if (typeof bin === 'string') {
    return { [path.basename(String(name))]: normalizeBinPath(bin) };
  }

  if (typeof bin !== 'object' || Array.isArray(bin)) {
    throw new Error(
      `Sidecar ${name} declares an unsupported bin of type ${typeof bin}`,
    );
  }

  return Object.fromEntries(
    Object.entries(bin).map(([binName, binPath]) => [
      binName,
      normalizeBinPath(binPath),
    ]),
  );
}

function assertSidecarName(name, root) {
  if (typeof name !== 'string' || !name.startsWith(`${sidecarScope}/`)) {
    throw new Error(
      `Sidecar package at ${root} must be named ${sidecarScope}/<name>, found ${String(name)}`,
    );
  }

  const unscoped = unscopedName(name);
  if (unscoped.length === 0 || unscoped.includes('/')) {
    throw new Error(`Sidecar package at ${root} has an unusable name ${name}`);
  }

  if (unscoped.startsWith('modern-js-')) {
    throw new Error(
      [
        `Sidecar ${name} must not carry the Modern.js cohort prefix.`,
        'Sidecars are independent republications; the cohort prefix would rename their string-form bins via npm-normalize-package-bin (basename of the package name) and break the upstream CLI contract.',
      ].join('\n'),
    );
  }
}

function assertSidecarVersion(name, version) {
  if (typeof version !== 'string' || !stableVersionPattern.test(version)) {
    throw new Error(
      [
        `Sidecar ${name} version ${String(version)} must be stable semver (X.Y.Z).`,
        "npm resolves the peer range 'ipx: >=3.0.3' with a prerelease-excluding check, so a prerelease sidecar passes pnpm and fails npm and yarn-classic consumers.",
      ].join('\n'),
    );
  }
}

function assertSidecarBin(packageJson, root) {
  const expectedBinName = sidecarBinNames.get(packageJson.name);
  const normalizedBin = normalizeSidecarBin(packageJson);
  if (!expectedBinName) {
    return normalizedBin;
  }

  if (!normalizedBin) {
    throw new Error(
      `Sidecar ${packageJson.name} at ${root} must keep the upstream '${expectedBinName}' bin`,
    );
  }

  if (typeof packageJson.bin === 'string') {
    const derivedBinName = path.basename(packageJson.name);
    if (derivedBinName !== expectedBinName) {
      throw new Error(
        [
          `Sidecar ${packageJson.name} declares a string bin, which npm normalizes to the key '${derivedBinName}'.`,
          `The upstream CLI contract requires '${expectedBinName}'.`,
        ].join('\n'),
      );
    }
    return normalizedBin;
  }

  if (!Object.hasOwn(normalizedBin, expectedBinName)) {
    throw new Error(
      `Sidecar ${packageJson.name} must expose the '${expectedBinName}' bin, found ${Object.keys(normalizedBin).join(', ') || 'none'}`,
    );
  }

  return normalizedBin;
}

function assertSidecarDependencies(packageJson, root) {
  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }

    for (const [dependencyName, specifier] of Object.entries(block)) {
      if (typeof specifier !== 'string') {
        continue;
      }
      if (specifier.startsWith('workspace:')) {
        throw new Error(
          `Sidecar ${packageJson.name} at ${root} ${blockName}.${dependencyName} uses ${specifier}; sidecars publish verbatim and cannot carry workspace protocol specifiers`,
        );
      }
      if (specifier.startsWith('npm:@modern-js/')) {
        throw new Error(
          `Sidecar ${packageJson.name} at ${root} ${blockName}.${dependencyName} aliases the unpublished upstream name ${specifier}`,
        );
      }
    }
  }
}

function readSidecarManifest(repoRoot, root) {
  const dir = path.resolve(repoRoot, root);
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `Sidecar package root ${root} has no package.json; vendor the sidecar before staging it`,
    );
  }
  return { dir, packageJson: readJsonFile(packageJsonPath), packageJsonPath };
}

/**
 * Read every sidecar package root and enforce the fail-closed invariants that
 * keep a sidecar publishable to strict npm consumers.
 */
function collectSidecarPackages(
  repoRoot = defaultRepoRoot,
  { roots = SIDECAR_PACKAGE_ROOTS } = {},
) {
  const sidecars = roots.map(root => {
    const { dir, packageJson, packageJsonPath } = readSidecarManifest(
      repoRoot,
      root,
    );

    assertSidecarName(packageJson.name, root);
    assertSidecarVersion(packageJson.name, packageJson.version);

    if (packageJson.private) {
      throw new Error(
        `Sidecar ${packageJson.name} at ${root} must not be private`,
      );
    }
    if (packageJson.publishConfig?.access !== 'public') {
      throw new Error(
        `Sidecar ${packageJson.name} at ${root} must declare publishConfig.access "public"`,
      );
    }

    const bin = assertSidecarBin(packageJson, root);
    assertSidecarDependencies(packageJson, root);

    return {
      bin,
      dir,
      name: packageJson.name,
      packageJson,
      packageJsonPath,
      root,
      version: packageJson.version,
    };
  });

  const seen = new Set();
  for (const sidecar of sidecars) {
    if (seen.has(sidecar.name)) {
      throw new Error(`Duplicate sidecar package name ${sidecar.name}`);
    }
    seen.add(sidecar.name);
  }

  return sidecars;
}

function sidecarAliasEntries(packageJson) {
  const entries = [];
  for (const blockName of dependencyBlockNames) {
    const block = packageJson[blockName];
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      continue;
    }
    for (const [dependencyName, specifier] of Object.entries(block)) {
      if (typeof specifier !== 'string') {
        continue;
      }
      const match = aliasSpecifierPattern.exec(specifier);
      const target = match?.groups?.target;
      if (!target || !target.startsWith(`${sidecarScope}/`)) {
        continue;
      }
      entries.push({
        blockName,
        dependencyName,
        specifier,
        target,
        version: match.groups.version,
      });
    }
  }
  return entries;
}

/**
 * Order sidecars so a sidecar publishes after everything it aliases.
 */
function sidecarPublishOrder(sidecars) {
  const byName = new Map(sidecars.map(sidecar => [sidecar.name, sidecar]));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  const visit = sidecar => {
    if (visited.has(sidecar.name)) {
      return;
    }
    if (visiting.has(sidecar.name)) {
      throw new Error(`Sidecar dependency cycle includes ${sidecar.name}`);
    }
    visiting.add(sidecar.name);
    for (const entry of sidecarAliasEntries(sidecar.packageJson)) {
      const dependency = byName.get(entry.target);
      if (dependency && dependency !== sidecar) {
        visit(dependency);
      }
    }
    visiting.delete(sidecar.name);
    visited.add(sidecar.name);
    ordered.push(sidecar);
  };

  for (const sidecar of [...sidecars].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    visit(sidecar);
  }

  return ordered;
}

/**
 * Copy a sidecar package into the staging directory VERBATIM: no name
 * prefixing, no cohort-version forcing, no dependency rewriting. A sidecar
 * never passes through enforceSingleVersionPolicy or the cohort
 * X.Y.Z-ultramodern.N gate.
 */
function stageSidecarPackage(
  sidecar,
  stageDir,
  { repoRoot = defaultRepoRoot } = {},
) {
  const packageDir = path.join(stageDir, stagedDirectoryName(sidecar.name));
  fs.rmSync(packageDir, { force: true, recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.cpSync(sidecar.dir, packageDir, {
    recursive: true,
    filter: source => {
      const base = path.basename(source);
      return base !== 'node_modules' && base !== '.git';
    },
  });

  const stagedPackageJsonPath = path.join(packageDir, 'package.json');
  const stagedBytes = fs.readFileSync(stagedPackageJsonPath);
  const sourceBytes = fs.readFileSync(sidecar.packageJsonPath);
  if (!stagedBytes.equals(sourceBytes)) {
    throw new Error(
      `Staged sidecar ${sidecar.name} manifest differs from ${sidecar.root}/package.json; sidecars must stage verbatim`,
    );
  }

  return {
    ...sidecar,
    packageDir: path.relative(repoRoot, packageDir),
    stagedDir: packageDir,
  };
}

/**
 * Every hard-coded `npm:@bleedingdev/<name>@<version>` alias in the staged
 * cohort (notably @modern-js/image) and inside the sidecar manifests
 * themselves (rsbuild-image-core -> image-size) must name a sidecar that this
 * run actually stages, at exactly that version. The cohort collector forces
 * the cohort version onto package versions but never touches alias TARGETS,
 * so this is the only seam that keeps those literals honest.
 */
function validateAliasConsistency(
  stagedManifests,
  sidecars,
  { cohortTargetNames = new Set() } = {},
) {
  const byName = new Map(sidecars.map(sidecar => [sidecar.name, sidecar]));
  const manifests = [
    ...stagedManifests.map(item => ({
      name: item.name ?? item.targetName ?? item.packageJson?.name,
      packageJson: item.packageJson ?? item,
    })),
    ...sidecars.map(sidecar => ({
      name: sidecar.name,
      packageJson: sidecar.packageJson,
    })),
  ];

  for (const manifest of manifests) {
    for (const entry of sidecarAliasEntries(manifest.packageJson)) {
      if (cohortTargetNames.has(entry.target)) {
        continue;
      }

      const sidecar = byName.get(entry.target);
      if (!sidecar) {
        throw new Error(
          [
            `${manifest.name} ${entry.blockName}.${entry.dependencyName} aliases ${entry.specifier}, which is neither a staged sidecar nor a cohort package.`,
            `Staged sidecars: ${[...byName.keys()].sort().join(', ') || 'none'}`,
          ].join('\n'),
        );
      }

      if (sidecar.version !== entry.version) {
        throw new Error(
          [
            `${manifest.name} ${entry.blockName}.${entry.dependencyName} pins ${entry.specifier} but sidecar ${sidecar.name} stages version ${sidecar.version}.`,
            'Alias targets are never rewritten by the publisher; update the alias or the sidecar version so they match.',
          ].join('\n'),
        );
      }
    }
  }

  return manifests.length;
}

/**
 * Record the sidecar publication lane for the CI step that publishes sidecars
 * BEFORE the cohort (the aliases in @modern-js/image only resolve once the
 * sidecar versions exist on the registry).
 */
function writeSidecarStagingManifest(
  outDir,
  stagedSidecars,
  { publishBefore } = {},
) {
  const ordered = sidecarPublishOrder(stagedSidecars);
  const manifest = {
    schemaVersion: 1,
    ...(publishBefore ? { publishBefore } : {}),
    publishOrder: ordered.map(sidecar => sidecar.name),
    packages: ordered.map(sidecar => ({
      name: sidecar.name,
      version: sidecar.version,
      packageDir: sidecar.packageDir,
      root: sidecar.root,
    })),
  };

  const manifestPath = path.join(outDir, sidecarManifestFile);
  writeJsonFile(manifestPath, manifest);
  return { manifest, manifestPath };
}

export {
  SIDECAR_PACKAGE_ROOTS,
  collectSidecarPackages,
  normalizeSidecarBin,
  sidecarAliasEntries,
  sidecarPublishOrder,
  stageSidecarPackage,
  validateAliasConsistency,
  writeSidecarStagingManifest,
};
