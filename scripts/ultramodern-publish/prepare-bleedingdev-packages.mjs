#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function parseArgs(argv) {
  const options = {
    scope: 'bleedingdev',
    prefix: 'modern-js-',
    version: undefined,
    dependencyVersion: undefined,
    tag: 'ultramodern-canary',
    packages: undefined,
    out: path.join(repoRoot, '.modern', 'bleedingdev-publish'),
    repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    homepage: 'https://github.com/BleedingDev/ultramodern.js#readme',
    bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
    publish: false,
    dryRun: false,
    skipExisting: true,
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

    if (arg === '--scope') {
      options.scope = readValue().replace(/^@/, '');
    } else if (arg === '--prefix') {
      options.prefix = readValue();
    } else if (arg === '--version') {
      options.version = readValue();
    } else if (arg === '--dependency-version') {
      options.dependencyVersion = readValue();
    } else if (arg === '--tag') {
      options.tag = readValue();
    } else if (arg === '--packages') {
      options.packages = readValue()
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    } else if (arg === '--out') {
      options.out = path.resolve(readValue());
    } else if (arg === '--repository-url') {
      options.repositoryUrl = readValue();
    } else if (arg === '--homepage') {
      options.homepage = readValue();
    } else if (arg === '--bugs-url') {
      options.bugsUrl = readValue();
    } else if (arg === '--publish') {
      options.publish = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-skip-existing') {
      options.skipExisting = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.version) {
    throw new Error(
      'Missing --version, for example --version 3.2.0-ultramodern.0',
    );
  }

  options.dependencyVersion ??= options.version;

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${filePath}.tmp`, filePath);
}

function collectPackageJsonFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        results.push(...collectPackageJsonFiles(filePath));
      }
    } else if (entry.name === 'package.json') {
      results.push(filePath);
    }
  }
  return results;
}

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

function matchesPackageFilter(item, options) {
  if (!options.packages) {
    return true;
  }

  const sourceName = item.packageJson.name;
  const targetName = targetPackageName(sourceName, options);
  const unscopedSourceName = sourceName.split('/').at(-1);
  const unscopedTargetName = targetName.split('/').at(-1);
  return options.packages.some(packageName =>
    [
      sourceName,
      targetName,
      unscopedSourceName,
      unscopedTargetName,
      sourceName.replace('@modern-js/', ''),
      targetName.replace(`@${options.scope}/`, ''),
    ].includes(packageName),
  );
}

function collectModernPackages(options) {
  const allPackages = collectPackageJsonFiles(path.join(repoRoot, 'packages'))
    .map(packageJsonPath => {
      const packageJson = readJson(packageJsonPath);
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
  const packages = allPackages.filter(item =>
    matchesPackageFilter(item, options),
  );

  if (options.packages && packages.length !== options.packages.length) {
    const matchedNames = new Set(
      packages.flatMap(item => [
        item.packageJson.name,
        targetPackageName(item.packageJson.name, options),
        item.packageJson.name.split('/').at(-1),
        targetPackageName(item.packageJson.name, options).split('/').at(-1),
      ]),
    );
    const unmatched = options.packages.filter(
      packageName => !matchedNames.has(packageName),
    );
    if (unmatched.length > 0) {
      throw new Error(`Unknown --packages value(s): ${unmatched.join(', ')}`);
    }
  }

  return {
    allPackages,
    packages,
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
      'Use package_mode=all, or pass --dependency-version to intentionally publish a subset against an already coherent framework version.',
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

function rewritePackageJson(packageJson, sourceName, options, sourceNames) {
  packageJson.name = targetPackageName(sourceName, options);
  packageJson.version = options.version;
  rewritePackageMetadata(packageJson, options);
  normalizeBin(packageJson);
  packageJson.publishConfig = {
    ...(packageJson.publishConfig ?? {}),
    access: 'public',
  };
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
}

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

function generateSourceDeclarations(item) {
  if (!shouldGenerateSourceDeclarations(item.dir, item.packageJson)) {
    return;
  }

  run('pnpm', ['-w', 'run', 'tsgo:dts', item.dir]);
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.stdio ?? 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}`,
    );
  }
}

function packSourcePackage(packageName, packDir) {
  const before = new Set(fs.readdirSync(packDir));
  run(
    'pnpm',
    ['--filter', packageName, 'pack', '--pack-destination', packDir],
    {
      stdio: 'pipe',
    },
  );
  const after = fs.readdirSync(packDir);
  const created = after.filter(
    name => !before.has(name) && name.endsWith('.tgz'),
  );
  if (created.length !== 1) {
    throw new Error(
      `Expected one pack artifact for ${packageName}, got ${created.length}`,
    );
  }
  return path.join(packDir, created[0]);
}

function extractTarball(tarball, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', targetDir], { stdio: 'pipe' });
  return path.join(targetDir, 'package');
}

function packageExists(packageName, version) {
  const result = spawnSync(
    'npm',
    ['view', `${packageName}@${version}`, 'version'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  );
  return result.status === 0;
}

function verifyRegistryPackage(packageName, version) {
  const attempts = 12;
  const retryDelayMs = 5000;
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(
      'npm',
      ['view', `${packageName}@${version}`, 'version', '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      },
    );
    if (result.status === 0) {
      const publishedVersion = JSON.parse(result.stdout);
      if (publishedVersion !== version) {
        throw new Error(
          `Published package ${packageName}@${version} resolved unexpected version ${publishedVersion}`,
        );
      }
      return;
    }

    lastError = result.stderr || result.stdout;
    if (attempt < attempts) {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        retryDelayMs,
      );
    }
  }

  throw new Error(
    `Published package ${packageName}@${version} was not visible on npm after ${attempts} attempts: ${lastError}`,
  );
}

function validateNoWorkspaceProtocol(packageJson, packageName, blockName) {
  const block = packageJson[blockName];
  if (!block || typeof block !== 'object') {
    return;
  }

  for (const [dependencyName, specifier] of Object.entries(block)) {
    if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
      throw new Error(
        `${packageName} ${blockName}.${dependencyName} still uses ${specifier}`,
      );
    }
  }
}

function validatePublishManifest(manifest) {
  for (const item of manifest.packages) {
    const packageJson = readJson(
      path.join(repoRoot, item.packageDir, 'package.json'),
    );
    if (packageJson.name !== item.targetName) {
      throw new Error(
        `Publish manifest target mismatch: expected ${item.targetName}, got ${packageJson.name}`,
      );
    }
    if (packageJson.version !== item.version) {
      throw new Error(
        `${item.targetName} has version ${packageJson.version}, expected ${item.version}`,
      );
    }
    if (packageJson.publishConfig?.access !== 'public') {
      throw new Error(`${item.targetName} must publish with public access`);
    }
    for (const blockName of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      validateNoWorkspaceProtocol(packageJson, item.targetName, blockName);
    }
  }
}

function publishPackage(packageDir, options) {
  const packageJson = readJson(path.join(packageDir, 'package.json'));
  const args = [
    'publish',
    packageDir,
    '--access',
    'public',
    '--tag',
    options.tag,
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  } else {
    args.push('--provenance');
  }

  run('npm', args);
  return packageJson.name;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { allPackages, packages, sourceNames, aliases } =
    collectModernPackages(options);
  enforceSingleVersionPolicy(options, packages, allPackages);
  const packDir = path.join(options.out, 'source-tarballs');
  const stageDir = path.join(options.out, 'packages');

  fs.rmSync(options.out, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: options.scope,
    prefix: options.prefix,
    version: options.version,
    dependencyVersion: options.dependencyVersion,
    tag: options.tag,
    aliases,
    packages: [],
  };

  for (const item of packages) {
    const sourceName = item.packageJson.name;
    const targetName = targetPackageName(sourceName, options);
    generateSourceDeclarations(item);
    const tarball = packSourcePackage(sourceName, packDir);
    const packageDir = extractTarball(
      tarball,
      path.join(stageDir, targetName.replaceAll('/', '__')),
    );
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = readJson(packageJsonPath);
    rewritePackageJson(packageJson, sourceName, options, sourceNames);
    normalizeDeclaredTypePaths(packageDir, packageJson);
    writeJson(packageJsonPath, packageJson);
    validateStagedTypeFiles(packageDir, packageJson);

    manifest.packages.push({
      sourceName,
      targetName,
      version: options.version,
      packageDir: path.relative(repoRoot, packageDir),
    });
  }

  writeJson(path.join(options.out, 'manifest.json'), manifest);
  validatePublishManifest(manifest);

  console.log(
    `Prepared ${manifest.packages.length} package(s) under ${path.relative(
      repoRoot,
      options.out,
    )}`,
  );

  if (!options.publish) {
    console.log('Publish skipped. Re-run with --publish to publish packages.');
    return;
  }

  for (const item of manifest.packages) {
    const packageDir = path.join(repoRoot, item.packageDir);
    if (
      options.skipExisting &&
      packageExists(item.targetName, options.version)
    ) {
      console.log(`Skipping existing ${item.targetName}@${options.version}`);
      verifyRegistryPackage(item.targetName, options.version);
      continue;
    }
    const publishedName = publishPackage(packageDir, options);
    console.log(`Published ${publishedName}@${options.version}`);
    if (!options.dryRun) {
      verifyRegistryPackage(publishedName, options.version);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
