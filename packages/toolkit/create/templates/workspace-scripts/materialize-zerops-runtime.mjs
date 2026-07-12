#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workspaceRoot = path.resolve(
  process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd(),
);
const args = process.argv.slice(2);

function fail(message) {
  console.error(`[ultramodern:zerops] ${message}`);
  process.exit(1);
}

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    fail(`${name} requires a value`);
  }

  return value;
}

function assertRelativePath(label, value) {
  if (path.isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
    fail(`${label} must be a workspace-relative path`);
  }
}

function assertInsideWorkspace(label, targetPath) {
  const relativePath = path.relative(workspaceRoot, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    fail(`${label} resolved outside the workspace`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readOptionalJson(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : undefined;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      MODERNJS_DEPLOY: 'node',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const sourceSnapshotSkipSegments = new Set([
  '.git',
  '.output',
  '.zerops',
  'dist',
  'node_modules',
  'repos',
]);

function shouldSnapshotSourcePath(relativePath) {
  return !relativePath
    .split(path.sep)
    .some(segment => sourceSnapshotSkipSegments.has(segment));
}

function listWorkspaceSourceFiles() {
  const files = [];
  const queue = [workspaceRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relativePath = path.relative(workspaceRoot, absolute);
      if (!shouldSnapshotSourcePath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  return files.sort();
}

function snapshotWorkspaceSourceFiles() {
  return new Map(
    listWorkspaceSourceFiles().map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceRoot, relativePath)),
    ]),
  );
}

function restoreWorkspaceSourceFiles(snapshot) {
  for (const relativePath of listWorkspaceSourceFiles()) {
    if (!snapshot.has(relativePath)) {
      fs.rmSync(path.join(workspaceRoot, relativePath), { force: true });
    }
  }
  for (const [relativePath, content] of snapshot) {
    const absolute = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (
      !fs.existsSync(absolute) ||
      !fs.readFileSync(absolute).equals(content)
    ) {
      fs.writeFileSync(absolute, content);
    }
  }
}

const appId = readFlag('--app');
const packageName = readFlag('--package');
const packageDir = readFlag('--package-dir');

if (!appId) {
  fail('--app is required');
}

if (!packageName) {
  fail('--package is required');
}

if (!packageDir) {
  fail('--package-dir is required');
}

assertRelativePath('--package-dir', packageDir);

const appRoot = path.resolve(workspaceRoot, packageDir);
const appOutputDir = path.join(appRoot, '.output');
const runtimeDir = path.join(workspaceRoot, '.zerops/runtime', appId);

assertInsideWorkspace('package directory', appRoot);
assertInsideWorkspace('runtime directory', runtimeDir);

const sourceSnapshot = snapshotWorkspaceSourceFiles();
try {
  run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
    '--filter',
    packageName,
    'run',
    'deploy',
    '--skip-build',
  ]);
} finally {
  restoreWorkspaceSourceFiles(sourceSnapshot);
}

if (!fs.existsSync(appOutputDir)) {
  fail(
    `Modern.js Node deploy did not produce ${path.relative(
      workspaceRoot,
      appOutputDir,
    )}`,
  );
}

fs.rmSync(runtimeDir, { force: true, recursive: true });
fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
fs.cpSync(appOutputDir, runtimeDir, { recursive: true });

const entryPath = path.join(runtimeDir, 'index.js');
if (!fs.existsSync(entryPath)) {
  fail(
    `Modern.js Node deploy output is missing ${path.relative(
      workspaceRoot,
      entryPath,
    )}`,
  );
}

const packageJsonPath = path.join(runtimeDir, 'package.json');
const runtimePackage = fs.existsSync(packageJsonPath)
  ? readJson(packageJsonPath)
  : {};
normalizeRuntimePackageDependencies(runtimePackage);

runtimePackage.private = true;
runtimePackage.name ??= `${appId}-zerops-runtime`;
runtimePackage.scripts = {
  ...(runtimePackage.scripts ?? {}),
  serve: runtimePackage.scripts?.serve ?? 'node index.js',
};

writeJson(packageJsonPath, runtimePackage);
installRuntimeDependencies(runtimePackage);

console.log(
  `[ultramodern:zerops] materialized ${appId} runtime at ${path.relative(
    workspaceRoot,
    runtimeDir,
  )}`,
);

function normalizeRuntimePackageDependencies(packageJson) {
  const compactConfig = readOptionalJson(
    path.join(workspaceRoot, '.modernjs/ultramodern.json'),
  );
  const packageSource = compactConfig?.packageSource;
  const modernPackageVersion = packageSource?.modernPackageVersion;
  const aliasScope = packageSource?.aliasScope;
  const aliasPackageNamePrefix = packageSource?.aliasPackageNamePrefix;

  if (!modernPackageVersion || !aliasScope || !aliasPackageNamePrefix) {
    return;
  }

  const aliasPrefix = `@${aliasScope}/${aliasPackageNamePrefix}`;
  for (const section of ['dependencies', 'optionalDependencies']) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (dependencyName.startsWith(aliasPrefix)) {
        const officialPackageName = `@modern-js/${dependencyName.slice(
          aliasPrefix.length,
        )}`;
        dependencies[dependencyName] = modernPackageVersion;
        dependencies[officialPackageName] ??=
          `npm:${dependencyName}@${modernPackageVersion}`;
      }
    }
  }
}

function installRuntimeDependencies(runtimePackage) {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `ultramodern-zerops-${appId}-`),
  );

  try {
    const workspacePackages = collectWorkspacePackages();
    const installPackage = JSON.parse(JSON.stringify(runtimePackage));
    const localDependencies = removeWorkspaceDependencies(
      installPackage,
      workspacePackages,
    );

    writeJson(path.join(installDir, 'package.json'), installPackage);
    run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      [
        'install',
        '--omit=dev',
        '--no-audit',
        '--fund=false',
        '--legacy-peer-deps',
      ],
      { cwd: installDir },
    );

    fs.rmSync(path.join(runtimeDir, 'node_modules'), {
      force: true,
      recursive: true,
    });
    fs.cpSync(
      path.join(installDir, 'node_modules'),
      path.join(runtimeDir, 'node_modules'),
      { recursive: true },
    );

    for (const dependency of localDependencies) {
      copyWorkspacePackage(dependency, workspacePackages);
    }
  } finally {
    fs.rmSync(installDir, { force: true, recursive: true });
  }
}

function collectWorkspacePackages() {
  const packages = new Map();

  for (const directory of ['packages', 'apps', 'verticals']) {
    const absoluteDirectory = path.join(workspaceRoot, directory);
    if (!fs.existsSync(absoluteDirectory)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageDirectory = path.join(absoluteDirectory, entry.name);
      const packageJsonPath = path.join(packageDirectory, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = readJson(packageJsonPath);
      if (typeof packageJson.name === 'string') {
        packages.set(packageJson.name, packageDirectory);
      }
    }
  }

  return packages;
}

function removeWorkspaceDependencies(packageJson, workspacePackages) {
  const localDependencies = [];
  for (const section of ['dependencies', 'optionalDependencies']) {
    const dependencies = packageJson[section];
    if (
      !dependencies ||
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies)
    ) {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (workspacePackages.has(dependencyName)) {
        localDependencies.push(dependencyName);
        delete dependencies[dependencyName];
      }
    }
  }

  return localDependencies;
}

function copyWorkspacePackage(packageName, workspacePackages) {
  const sourceDirectory = workspacePackages.get(packageName);
  if (!sourceDirectory) {
    return;
  }

  const targetDirectory = path.join(
    runtimeDir,
    'node_modules',
    ...packageName.split('/'),
  );
  fs.rmSync(targetDirectory, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
  fs.cpSync(sourceDirectory, targetDirectory, {
    filter: sourcePath => !sourcePath.includes(`${path.sep}node_modules`),
    recursive: true,
  });
  makeWorkspacePackageRuntimeSafe(targetDirectory);
}

function makeWorkspacePackageRuntimeSafe(packageDirectory) {
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = readJson(packageJsonPath);
    packageJson.exports = rewriteTsExports(packageJson.exports);
    writeJson(packageJsonPath, packageJson);
  }

  for (const tsFile of listTsFiles(packageDirectory)) {
    const jsFile = tsFile.replace(/\.ts$/u, '.js');
    fs.writeFileSync(
      jsFile,
      transpileGeneratedPackageTs(fs.readFileSync(tsFile, 'utf-8')),
      'utf-8',
    );
  }
}

function rewriteTsExports(value) {
  if (typeof value === 'string') {
    return value.replace(/\.ts$/u, '.js');
  }

  if (Array.isArray(value)) {
    return value.map(rewriteTsExports);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteTsExports(entry)]),
    );
  }

  return value;
}

function listTsFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

function transpileGeneratedPackageTs(source) {
  return source
    .replace(/^\s*import\s+type\s+[^;]+;\s*$/gmu, '')
    .replace(/^\s*export\s+type\s+[^;]+;\s*$/gmu, '')
    .replace(/^\s*type\s+\w+\s*=\s*[^;]+;\s*$/gmu, '')
    .replace(/^\s*interface\s+\w+\s*\{[^}]*\}\s*$/gmsu, '')
    .replace(
      /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=]+=/gu,
      '$1 $2 =',
    )
    .replace(/\(([^)]*)\)\s*:\s*[^=]+=>/gu, (_, params) => `(${stripParameterTypes(params)}) =>`)
    .replace(/\(([^)]*)\)\s*=>/gu, (_, params) => `(${stripParameterTypes(params)}) =>`)
    .replace(/function(\s+\w+\s*)\(([^)]*)\)/gu, (_, name, params) => `function${name}(${stripParameterTypes(params)})`)
    .replace(/\s+as\s+const\b/gu, '')
    .replace(/\s+satisfies\s+[A-Za-z_$][\w$]*(?:<[^>]+>)?/gu, '');
}

function stripParameterTypes(params) {
  return params.replace(/([A-Za-z_$][\w$]*)\??:\s*[^,]+/gu, '$1');
}
