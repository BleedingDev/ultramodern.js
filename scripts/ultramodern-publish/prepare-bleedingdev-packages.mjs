#!/usr/bin/env node
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import cliKit from '../lib/cli-kit.js';
import fsKit from '../lib/fs-kit.js';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const execFileAsync = promisify(execFile);
const { parseCliArgs } = cliKit;
const { readJsonFile, writeJsonFile } = fsKit;
const npmPublishAttempts = 3;
const npmPublishRetryDelayMs = 15_000;
const transientNpmPublishErrorPatterns = [
  /TLOG_CREATE_ENTRY_ERROR/u,
  /error creating tlog entry/u,
  /rekor\.sigstore\.dev/u,
  /ETIMEDOUT/u,
  /ECONNRESET/u,
  /EAI_AGAIN/u,
  /ESOCKETTIMEDOUT/u,
  /socket hang up/u,
];
const createTemplateRequiredFiles = [
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
];
const cliValueOptions = new Set([
  '--scope',
  '--prefix',
  '--version',
  '--tag',
  '--out',
  '--repository-url',
  '--homepage',
  '--bugs-url',
  '--publish-concurrency',
]);
const cliBooleanOptions = new Set([
  '--publish',
  '--publish-existing',
  '--dry-run',
]);

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
    if (cliBooleanOptions.has(arg)) {
      continue;
    }
    return;
  }
}

function parsePublishConcurrency(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('--publish-concurrency must be an integer from 1 to 8');
  }

  const concurrency = Number(value);
  if (concurrency > 8) {
    throw new Error('--publish-concurrency must be an integer from 1 to 8');
  }

  return concurrency;
}

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv);

  const options = parseCliArgs(argv, {
    defaults: {
      scope: 'bleedingdev',
      prefix: 'modern-js-',
      version: undefined,
      dependencyVersion: null,
      tag: 'latest',
      packages: null,
      out: path.join(repoRoot, '.modern', 'bleedingdev-publish'),
      repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
      homepage: 'https://github.com/BleedingDev/ultramodern.js#readme',
      bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
      publish: false,
      publishExisting: false,
      dryRun: false,
      noSkipExisting: false,
      publishConcurrency: 8,
    },
    ignoreTerminator: true,
    options: {
      scope: {},
      prefix: {},
      version: {},
      'dependency-version': {
        key: 'dependencyVersion',
        requiredValue: false,
      },
      tag: {},
      packages: {
        requiredValue: false,
      },
      out: {},
      'repository-url': {
        key: 'repositoryUrl',
      },
      homepage: {},
      'bugs-url': {
        key: 'bugsUrl',
      },
      publish: {
        type: 'boolean',
      },
      'publish-existing': {
        key: 'publishExisting',
        type: 'boolean',
      },
      'dry-run': {
        key: 'dryRun',
        type: 'boolean',
      },
      'no-skip-existing': {
        key: 'noSkipExisting',
        type: 'boolean',
      },
      'publish-concurrency': {
        key: 'publishConcurrency',
      },
    },
  });

  if (options.dependencyVersion !== null) {
    throw new Error(
      '--dependency-version is forbidden; BleedingDev publishes a single full framework cohort per version',
    );
  }

  if (options.packages !== null) {
    throw new Error(
      '--packages is forbidden; BleedingDev publishes every public @modern-js/* package together',
    );
  }

  if (options.noSkipExisting) {
    throw new Error(
      '--no-skip-existing is forbidden; exact-version reuse is controlled by the full-cohort registry gate',
    );
  }

  if (!options.version) {
    throw new Error(
      'Missing --version, for example --version 3.2.0-ultramodern.0',
    );
  }

  options.scope = options.scope.replace(/^@/, '');
  options.out = path.resolve(options.out);
  options.publish = options.publish || options.publishExisting;
  options.publishConcurrency = parsePublishConcurrency(
    options.publishConcurrency,
  );
  options.dependencyVersion = options.version;
  delete options.packages;
  delete options.noSkipExisting;

  if (
    !Number.isInteger(options.publishConcurrency) ||
    options.publishConcurrency < 1 ||
    options.publishConcurrency > 8
  ) {
    throw new Error('--publish-concurrency must be an integer from 1 to 8');
  }

  return options;
}

function assertTrustedPublishContext() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'Publishing is only allowed from the GitHub Actions trusted publishing workflow. Run without --publish locally to prepare and validate packages.',
    );
  }

  if (process.env.GITHUB_REPOSITORY !== 'BleedingDev/ultramodern.js') {
    throw new Error(
      'Publishing is only allowed from BleedingDev/ultramodern.js.',
    );
  }

  if (process.env.GITHUB_REF !== 'refs/heads/main-ultramodern') {
    throw new Error(
      'Publishing is only allowed from refs/heads/main-ultramodern.',
    );
  }
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

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.captureOutput
        ? ['ignore', 'pipe', 'pipe']
        : (options.stdio ?? 'inherit'),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    const stdout = [];
    const stderr = [];
    if (options.captureOutput) {
      child.stdout?.on('data', chunk => {
        stdout.push(chunk);
        process.stdout.write(chunk);
      });
      child.stderr?.on('data', chunk => {
        stderr.push(chunk);
        process.stderr.write(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', status => {
      if (status === 0) {
        resolve();
        return;
      }

      const error = new Error(
        `${command} ${args.join(' ')} failed with ${status}`,
      );
      error.status = status;
      error.stdout = Buffer.concat(stdout).toString('utf-8');
      error.stderr = Buffer.concat(stderr).toString('utf-8');
      reject(error);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientNpmPublishError(error) {
  const output = [
    error instanceof Error ? error.message : '',
    typeof error?.stdout === 'string' ? error.stdout : '',
    typeof error?.stderr === 'string' ? error.stderr : '',
  ].join('\n');

  return transientNpmPublishErrorPatterns.some(pattern => pattern.test(output));
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

async function packageExists(packageName, version) {
  try {
    return (
      (await resolveRegistryPackageVersion(packageName, version)) === version
    );
  } catch {
    return false;
  }
}

async function resolveRegistryPackageVersion(packageName, version) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', `${packageName}@${version}`, 'version', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  return JSON.parse(stdout);
}

async function resolveRegistryDistTag(packageName, tag) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', packageName, 'dist-tags', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  const distTags = JSON.parse(stdout);
  return typeof distTags?.[tag] === 'string' ? distTags[tag] : undefined;
}

async function resolveRegistryPackageDist(packageName, version) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', `${packageName}@${version}`, 'dist', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  return JSON.parse(stdout);
}

async function assertRegistryTarballReachable(
  packageName,
  version,
  dist,
  fetchImpl = globalThis.fetch,
) {
  if (!dist || typeof dist.tarball !== 'string') {
    throw new Error(`${packageName}@${version} is missing dist.tarball`);
  }

  const response = await fetchImpl(dist.tarball, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(
      `${packageName}@${version} tarball ${dist.tarball} returned HTTP ${response.status}`,
    );
  }
}

async function verifyRegistryPackage(packageName, version) {
  const attempts = 12;
  const retryDelayMs = 5000;
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const publishedVersion = await resolveRegistryPackageVersion(
        packageName,
        version,
      );
      if (publishedVersion !== version) {
        throw new Error(
          `Published package ${packageName}@${version} resolved unexpected version ${publishedVersion}`,
        );
      }
      await assertRegistryTarballReachable(
        packageName,
        version,
        await resolveRegistryPackageDist(packageName, version),
      );
      return;
    } catch (error) {
      lastError =
        error instanceof Error && 'stderr' in error
          ? String(error.stderr)
          : error instanceof Error
            ? error.message
            : String(error);
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Published package ${packageName}@${version} was not visible on npm after ${attempts} attempts: ${lastError}`,
  );
}

async function verifyRegistryDistTag(packageName, tag, version) {
  const resolvedVersion = await resolveRegistryDistTag(packageName, tag);
  if (resolvedVersion !== version) {
    throw new Error(
      `${packageName} dist-tag ${tag} points at ${resolvedVersion ?? '<missing>'}, expected ${version}`,
    );
  }
}

function validateFullCohortManifest(manifest) {
  const selectedSources = new Set(
    manifest.packages.map(item => item.sourceName),
  );
  const missing = Object.keys(manifest.aliases)
    .filter(sourceName => !selectedSources.has(sourceName))
    .sort((a, b) => a.localeCompare(b));

  if (missing.length > 0) {
    throw new Error(
      [
        `BleedingDev publish manifest is missing ${missing.length} public package(s).`,
        'Every public @modern-js/* package must be in the exact-version cohort before any final dist-tag promotion.',
        `Missing packages: ${missing.join(', ')}`,
      ].join('\n'),
    );
  }
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
  validateFullCohortManifest(manifest);
  for (const item of manifest.packages) {
    const packageJson = readJsonFile(
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
    if (item.sourceName === '@modern-js/create') {
      validateCreateTemplateFiles(
        path.join(repoRoot, item.packageDir),
        item.targetName,
      );
    }
  }
}

async function publishPackage(
  packageDir,
  options,
  runner = runAsync,
  wait = sleep,
  registry = { packageExists },
) {
  const packageJson = readJsonFile(path.join(packageDir, 'package.json'));
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

  const maxAttempts = options.dryRun ? 1 : npmPublishAttempts;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runner('npm', args, { captureOutput: true });
      return packageJson.name;
    } catch (error) {
      if (
        !options.dryRun &&
        (await registry.packageExists(packageJson.name, packageJson.version))
      ) {
        console.log(
          `Reusing existing ${packageJson.name}@${packageJson.version} after npm publish returned an error`,
        );
        return packageJson.name;
      }

      const shouldRetry =
        attempt < maxAttempts && isTransientNpmPublishError(error);
      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `npm publish for ${packageJson.name}@${packageJson.version} failed with a transient registry/provenance error; retrying attempt ${
          attempt + 1
        }/${maxAttempts} in ${npmPublishRetryDelayMs}ms.`,
      );
      await wait(npmPublishRetryDelayMs);
    }
  }

  return packageJson.name;
}

async function validateRegistryCohort(
  manifest,
  options,
  registry = { verifyRegistryDistTag, verifyRegistryPackage },
) {
  if (options.dryRun) {
    console.log('Skipping registry cohort validation for dry-run publish');
    return;
  }

  const failures = [];
  for (const item of manifest.packages) {
    try {
      await registry.verifyRegistryPackage(item.targetName, manifest.version);
      await registry.verifyRegistryDistTag(
        item.targetName,
        options.tag,
        manifest.version,
      );
    } catch (error) {
      failures.push(
        `${item.targetName}@${manifest.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Registry cohort validation failed for ${manifest.version}.`,
        `The ${options.tag} dist-tag is not coherent for the full cohort.`,
        ...failures,
      ].join('\n'),
    );
  }
}

function dependencyTargetForSpecifier(dependencyName, specifier, manifest) {
  const targetNames = new Set(manifest.packages.map(item => item.targetName));
  const aliasedTarget = manifest.aliases?.[dependencyName];
  if (targetNames.has(aliasedTarget)) {
    return aliasedTarget;
  }
  if (targetNames.has(dependencyName)) {
    return dependencyName;
  }
  if (typeof specifier !== 'string') {
    return undefined;
  }

  const match = /^npm:(?<packageName>@[^/]+\/[^@]+|[^@]+)@/u.exec(specifier);
  const packageName = match?.groups?.packageName;
  return packageName && targetNames.has(packageName) ? packageName : undefined;
}

function publishDependenciesForItem(item, manifest) {
  const packageJsonPath = path.join(repoRoot, item.packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }
  const packageJson = readJsonFile(packageJsonPath);
  const dependencies = ['dependencies', 'optionalDependencies'].flatMap(
    blockName => Object.entries(packageJson[blockName] ?? {}),
  );

  return [
    ...new Set(
      dependencies
        .map(([dependencyName, specifier]) =>
          dependencyTargetForSpecifier(dependencyName, specifier, manifest),
        )
        .filter(
          dependencyTarget =>
            dependencyTarget !== undefined &&
            dependencyTarget !== item.targetName,
        ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function orderPublishItems(packages, manifest = { aliases: {}, packages }) {
  const sourceOrderedPackages = [...packages].sort((left, right) => {
    if (left.sourceName === '@modern-js/create') {
      return 1;
    }
    if (right.sourceName === '@modern-js/create') {
      return -1;
    }
    return left.sourceName.localeCompare(right.sourceName);
  });
  const byTargetName = new Map(
    sourceOrderedPackages.map(item => [item.targetName, item]),
  );
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  const visit = item => {
    if (visited.has(item.targetName)) {
      return;
    }
    if (visiting.has(item.targetName)) {
      throw new Error(
        `BleedingDev publish dependency cycle includes ${item.targetName}`,
      );
    }

    visiting.add(item.targetName);
    for (const dependencyTarget of publishDependenciesForItem(item, manifest)) {
      const dependency = byTargetName.get(dependencyTarget);
      if (dependency) {
        visit(dependency);
      }
    }
    visiting.delete(item.targetName);
    visited.add(item.targetName);
    ordered.push(item);
  };

  for (const item of sourceOrderedPackages) {
    visit(item);
  }

  return ordered;
}

async function publishManifestPackages(manifest, options) {
  const publishItems = orderPublishItems(manifest.packages, manifest);

  const publishOne = async item => {
    const packageDir = path.join(repoRoot, item.packageDir);
    if (
      !options.dryRun &&
      (await packageExists(item.targetName, options.version))
    ) {
      console.log(
        `Reusing existing ${item.targetName}@${options.version} for full-cohort publish`,
      );
      await verifyRegistryPackage(item.targetName, options.version);
      await verifyRegistryDistTag(
        item.targetName,
        options.tag,
        options.version,
      );
      return;
    }

    const publishedName = await publishPackage(packageDir, options);
    console.log(`Published ${publishedName}@${options.version}`);
    if (!options.dryRun) {
      await verifyRegistryPackage(publishedName, options.version);
    }
  };

  console.log(
    `Publishing ${manifest.packages.length} package(s) in dependency order`,
  );
  if (options.publishConcurrency !== 1) {
    console.log(
      `Ignoring publish concurrency ${options.publishConcurrency}; full-cohort packages publish sequentially so dependency tarballs are fetchable before consumers.`,
    );
  }
  for (const item of publishItems) {
    await publishOne(item);
  }

  await validateRegistryCohort(manifest, options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.publishExisting) {
    const manifest = readJsonFile(path.join(options.out, 'manifest.json'));
    if (manifest.version !== options.version) {
      throw new Error(
        `Publish manifest version ${manifest.version} does not match --version ${options.version}`,
      );
    }
    validatePublishManifest(manifest);
    assertTrustedPublishContext();
    await publishManifestPackages(manifest, options);
    return;
  }

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
    const packageJson = readJsonFile(packageJsonPath);
    rewritePackageJson(packageJson, sourceName, options, sourceNames);
    normalizeDeclaredTypePaths(packageDir, packageJson);
    writeJsonFile(packageJsonPath, packageJson);
    validateStagedTypeFiles(packageDir, packageJson);

    manifest.packages.push({
      sourceName,
      targetName,
      version: options.version,
      packageDir: path.relative(repoRoot, packageDir),
    });
  }

  writeJsonFile(path.join(options.out, 'manifest.json'), manifest);
  validatePublishManifest(manifest);

  console.log(
    `Prepared ${manifest.packages.length} package(s) under ${path.relative(
      repoRoot,
      options.out,
    )}`,
  );

  if (!options.publish) {
    console.log(
      'Publish skipped. GitHub Actions trusted publishing is required for npm publish.',
    );
    return;
  }

  assertTrustedPublishContext();
  await publishManifestPackages(manifest, options);
}

function isDirectRun() {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isDirectRun()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export {
  assertRegistryTarballReachable,
  isTransientNpmPublishError,
  orderPublishItems,
  parseArgs,
  publishPackage,
  validateFullCohortManifest,
  validateRegistryCohort,
};
