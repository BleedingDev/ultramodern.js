#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const defaultReadinessRoot = path.join(
  repoRoot,
  '.modern',
  'bleedingdev-publish',
);
const defaultScope = '@bleedingdev/';
const sourceConditionNames = new Set(['modern:source']);
const ignoredPackageDirs = new Set([
  '.git',
  'node_modules',
  'source-tarballs',
  'dist',
  'doc_build',
]);

const allowedPackFiles = [
  /^package\.json$/u,
  /^LICENSE(?:\..*)?$/u,
  /^README(?:\..*)?$/u,
  /^CHANGELOG(?:\..*)?$/u,
  /^SECURITY(?:\..*)?$/u,
  /^dist\//u,
  /^bin\//u,
  /^compiled\//u,
  /^docs?\//u,
  /^lib\//u,
  /^scripts?\//u,
  /^src\//u,
  /^tests?\//u,
  /^templates?\//u,
  /^template-workspace\//u,
  /^types?\//u,
  /^static\//u,
  /(?:^|\/)[^/]+\.d\.[cm]?ts$/u,
  /^[^/]+\.[cm]?js$/u,
  /^[^/]+\.[cm]?ts$/u,
  /^[^/]+\.json$/u,
  /^[^/]+\.config\.[cm]?[jt]s$/u,
  /^rslib\.config\.[cm]?ts$/u,
  /^rstest\.config\.[cm]?ts$/u,
  /^tsconfig(?:\.[^/]+)?\.json$/u,
];

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRelativeTarget(target) {
  if (typeof target !== 'string') {
    return undefined;
  }
  if (target.startsWith('#') || target.startsWith('node:')) {
    return undefined;
  }
  if (target.includes('*')) {
    return undefined;
  }
  if (target.startsWith('./')) {
    return target.slice(2);
  }
  if (target.startsWith('/')) {
    return undefined;
  }
  return target;
}

function collectExportTargets(exportsValue, context = 'exports') {
  const targets = [];

  const visit = (value, trail) => {
    if (typeof value === 'string') {
      const normalized = normalizeRelativeTarget(value);
      if (normalized) {
        targets.push({
          field: trail.join('.'),
          target: normalized,
          isSourceCondition: trail.some(part => sourceConditionNames.has(part)),
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...trail, String(index)]));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        visit(item, [...trail, key]);
      }
    }
  };

  visit(exportsValue, [context]);
  return targets;
}

function collectBinTargets(binValue) {
  if (!binValue) {
    return [];
  }
  if (typeof binValue === 'string') {
    const normalized = normalizeRelativeTarget(binValue);
    return normalized ? [{ field: 'bin', target: normalized }] : [];
  }
  if (typeof binValue !== 'object' || Array.isArray(binValue)) {
    return [];
  }
  return Object.entries(binValue)
    .map(([name, target]) => {
      const normalized = normalizeRelativeTarget(target);
      return normalized ? { field: `bin.${name}`, target: normalized } : null;
    })
    .filter(Boolean);
}

function collectEntryTargets(packageJson) {
  const targets = [];
  for (const field of ['main', 'types', 'typings']) {
    const normalized = normalizeRelativeTarget(packageJson[field]);
    if (normalized) {
      targets.push({ field, target: normalized });
    }
  }
  targets.push(...collectExportTargets(packageJson.exports));
  targets.push(...collectBinTargets(packageJson.bin));

  const seen = new Set();
  return targets.filter(item => {
    const key = `${item.field}\0${item.target}\0${item.isSourceCondition}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function targetExists(packageDir, target) {
  const targetPath = path.join(packageDir, target);
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function fileIsPacked(packFiles, target) {
  return packFiles.has(target.replaceAll(path.sep, '/'));
}

function discoverPackageJsonFiles(searchRoot) {
  const packageJsonFiles = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredPackageDirs.has(entry.name)) {
          walk(path.join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name === 'package.json') {
        packageJsonFiles.push(path.join(directory, entry.name));
      }
    }
  };

  if (fs.existsSync(searchRoot)) {
    walk(searchRoot);
  }
  return packageJsonFiles.sort((left, right) => left.localeCompare(right));
}

function packageDirFromManifestItem(item, manifestPath, rootDir) {
  if (typeof item?.packageDir !== 'string') {
    return undefined;
  }
  if (path.isAbsolute(item.packageDir)) {
    return item.packageDir;
  }
  const repoRelative = path.join(repoRoot, item.packageDir);
  if (fs.existsSync(repoRelative)) {
    return repoRelative;
  }
  return (
    path.resolve(path.dirname(manifestPath), item.packageDir) ||
    path.resolve(rootDir, item.packageDir)
  );
}

function discoverPackages(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? defaultReadinessRoot);
  const manifestPath = options.manifestPath
    ? path.resolve(options.manifestPath)
    : path.join(rootDir, 'manifest.json');
  const skipped = [];
  const packages = [];

  if (fs.existsSync(manifestPath)) {
    const manifest = readJsonFile(manifestPath);
    if (!Array.isArray(manifest.packages)) {
      throw new Error(`${manifestPath} must contain a packages array`);
    }
    for (const item of manifest.packages) {
      const packageDir = packageDirFromManifestItem(
        item,
        manifestPath,
        rootDir,
      );
      const packageJsonPath = packageDir
        ? path.join(packageDir, 'package.json')
        : undefined;
      if (!packageJsonPath || !fs.existsSync(packageJsonPath)) {
        skipped.push({
          name: item?.targetName ?? item?.sourceName ?? '(unknown)',
          packageDir: item?.packageDir ?? '(missing packageDir)',
          reason: 'manifest packageDir does not contain package.json',
        });
        continue;
      }
      const packageJson = readJsonFile(packageJsonPath);
      packages.push({
        packageDir,
        packageJsonPath,
        packageJson,
        manifestItem: item,
      });
    }
    return { packages, skipped, manifestPath, rootDir };
  }

  for (const packageJsonPath of discoverPackageJsonFiles(rootDir)) {
    const packageJson = readJsonFile(packageJsonPath);
    packages.push({
      packageDir: path.dirname(packageJsonPath),
      packageJsonPath,
      packageJson,
      manifestItem: undefined,
    });
  }

  return { packages, skipped, manifestPath: undefined, rootDir };
}

function shouldSkipPackage(packageInfo, targets) {
  const { packageJson, packageDir } = packageInfo;
  if (!packageJson.name) {
    return 'package.json has no name';
  }
  if (packageJson.private === true) {
    return 'private package';
  }
  if (
    !packageJson.exports &&
    !packageJson.main &&
    !packageJson.types &&
    !packageJson.typings &&
    !packageJson.bin
  ) {
    return 'no publish entry surface yet (missing exports/main/types/bin)';
  }
  const referencesDist = targets.some(item => item.target.startsWith('dist/'));
  if (referencesDist && !fs.existsSync(path.join(packageDir, 'dist'))) {
    return 'dist build output is absent; run the package build before readiness';
  }
  return undefined;
}

function validatePackageMetadata(packageInfo, options = {}) {
  const requiredScope = options.requiredScope ?? defaultScope;
  const { packageJson, manifestItem } = packageInfo;
  const failures = [];
  const warnings = [];

  if (!packageJson.name || typeof packageJson.name !== 'string') {
    failures.push('missing string name');
  } else if (requiredScope && !packageJson.name.startsWith(requiredScope)) {
    failures.push(`name must start with ${requiredScope}`);
  }

  if (!packageJson.version || typeof packageJson.version !== 'string') {
    failures.push('missing string version');
  }

  if (manifestItem) {
    if (
      manifestItem.targetName &&
      packageJson.name !== manifestItem.targetName
    ) {
      failures.push(
        `manifest targetName ${manifestItem.targetName} does not match package name ${packageJson.name}`,
      );
    }
    if (manifestItem.version && packageJson.version !== manifestItem.version) {
      failures.push(
        `manifest version ${manifestItem.version} does not match package version ${packageJson.version}`,
      );
    }
  }

  if (
    !packageJson.exports &&
    !packageJson.main &&
    !packageJson.types &&
    !packageJson.typings &&
    !packageJson.bin
  ) {
    failures.push(
      'missing publish entry surface: exports, main, types, or bin',
    );
  }

  if (packageJson.publishConfig !== undefined) {
    if (
      !packageJson.publishConfig ||
      typeof packageJson.publishConfig !== 'object' ||
      Array.isArray(packageJson.publishConfig)
    ) {
      failures.push('publishConfig must be an object when present');
    } else {
      if (
        packageJson.publishConfig.registry !== undefined &&
        packageJson.publishConfig.registry !== 'https://registry.npmjs.org/'
      ) {
        failures.push(
          'publishConfig.registry must be https://registry.npmjs.org/',
        );
      }
      if (packageJson.publishConfig.access !== 'public') {
        failures.push('publishConfig.access must be public');
      }
    }
  }

  if (Array.isArray(packageJson.files) && packageJson.files.length === 0) {
    failures.push('files array must not be empty');
  }

  return { failures, warnings };
}

function validateTargets(packageInfo, targets, packFiles) {
  const failures = [];
  const warnings = [];
  for (const target of targets) {
    if (target.target === 'package.json') {
      continue;
    }
    const exists = targetExists(packageInfo.packageDir, target.target);
    const packed = packFiles ? fileIsPacked(packFiles, target.target) : false;
    const message = `${target.field} -> ${target.target}`;

    if (!exists) {
      if (target.isSourceCondition) {
        warnings.push(`${message} is a missing modern:source condition target`);
        continue;
      }
      failures.push(`${message} does not resolve to a file`);
      continue;
    }

    if (packFiles && !packed) {
      if (target.isSourceCondition) {
        warnings.push(
          `${message} resolves locally but is not included in pack`,
        );
        continue;
      }
      failures.push(`${message} resolves locally but is not included in pack`);
    }
  }
  return { failures, warnings };
}

function validatePackAllowlist(packageJson, packFiles) {
  if (Array.isArray(packageJson.files)) {
    return [];
  }
  return [...packFiles]
    .filter(file => !allowedPackFiles.some(pattern => pattern.test(file)))
    .map(file => `pack file ${file} is outside the fork-owned allowlist`);
}

function runNpmPackDryRun(packageDir, options = {}) {
  const cacheDir =
    options.cacheDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), 'modern-publish-readiness-npm-'));
  const result = spawnSync(
    options.npmBin ?? 'npm',
    ['pack', '--dry-run', '--json', '--cache', cacheDir],
    {
      cwd: packageDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: cacheDir,
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      files: new Set(),
      error:
        result.stderr || result.stdout || `npm pack exited ${result.status}`,
    };
  }

  try {
    const entries = JSON.parse(result.stdout);
    const files = new Set(
      entries.flatMap(entry =>
        Array.isArray(entry.files)
          ? entry.files.map(file => file.path.replaceAll('\\', '/'))
          : [],
      ),
    );
    return {
      ok: true,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      files,
    };
  } catch (error) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      files: new Set(),
      error: `npm pack returned invalid JSON: ${error.message}`,
    };
  }
}

async function checkPublishReadiness(options = {}) {
  const discovery = discoverPackages(options);
  const packages = [];
  const failures = [];
  const skipped = [...discovery.skipped];
  const warnings = [];
  const packRunner = options.packRunner ?? runNpmPackDryRun;

  for (const packageInfo of discovery.packages) {
    const targets = collectEntryTargets(packageInfo.packageJson);
    const skipReason = shouldSkipPackage(packageInfo, targets);
    const name =
      packageInfo.packageJson.name ??
      packageInfo.manifestItem?.targetName ??
      '(unknown)';
    if (skipReason) {
      skipped.push({
        name,
        packageDir: path.relative(repoRoot, packageInfo.packageDir),
        reason: skipReason,
      });
      continue;
    }

    const metadata = validatePackageMetadata(packageInfo, options);
    const packageFailures = [...metadata.failures];
    const packageWarnings = [...metadata.warnings];

    const pack = await packRunner(packageInfo.packageDir, options);
    if (!pack.ok) {
      packageFailures.push(`npm pack --dry-run failed: ${pack.error}`);
    } else {
      const targetValidation = validateTargets(
        packageInfo,
        targets,
        pack.files,
      );
      packageFailures.push(...targetValidation.failures);
      packageWarnings.push(...targetValidation.warnings);
      packageFailures.push(
        ...validatePackAllowlist(packageInfo.packageJson, pack.files),
      );
    }

    packages.push({
      name,
      packageDir: path.relative(repoRoot, packageInfo.packageDir),
      targetCount: targets.length,
      packFileCount: pack.files.size,
      usedPackAllowlist: !Array.isArray(packageInfo.packageJson.files),
    });

    if (packageFailures.length > 0) {
      failures.push({
        name,
        packageDir: packageInfo.packageDir,
        failures: packageFailures,
      });
    }
    if (packageWarnings.length > 0) {
      warnings.push({
        name,
        packageDir: packageInfo.packageDir,
        warnings: packageWarnings,
      });
    }
  }

  return {
    ok: failures.length === 0,
    rootDir: discovery.rootDir,
    manifestPath: discovery.manifestPath,
    packages,
    skipped,
    warnings,
    failures,
  };
}

function formatReport(result) {
  const lines = [];
  lines.push('UltraModern publish readiness');
  lines.push(`Root: ${path.relative(repoRoot, result.rootDir) || '.'}`);
  if (result.manifestPath) {
    lines.push(`Manifest: ${path.relative(repoRoot, result.manifestPath)}`);
  }
  lines.push(
    `Checked ${result.packages.length} package(s); skipped ${result.skipped.length}; warnings ${result.warnings.length}; failures ${result.failures.length}.`,
  );

  if (result.packages.length > 0) {
    lines.push('');
    lines.push('Checked packages:');
    for (const item of result.packages) {
      const allowlist = item.usedPackAllowlist ? ' allowlist' : '';
      lines.push(
        `- ${item.name} (${item.targetCount} target(s), ${item.packFileCount} packed file(s)${allowlist})`,
      );
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('Skipped packages:');
    for (const item of result.skipped) {
      lines.push(`- ${item.name}: ${item.reason}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const item of result.warnings) {
      const sourceWarnings = item.warnings.filter(warning =>
        warning.includes('modern:source'),
      );
      const otherWarnings = item.warnings.filter(
        warning => !warning.includes('modern:source'),
      );
      const parts = [];
      if (sourceWarnings.length > 0) {
        parts.push(`${sourceWarnings.length} missing modern:source target(s)`);
      }
      parts.push(...otherWarnings);
      lines.push(`- ${item.name}: ${parts.join('; ')}`);
      if (otherWarnings.length === 0 && sourceWarnings.length > 0) {
        continue;
      }
    }
  }

  if (result.failures.length > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const item of result.failures) {
      lines.push(`- ${item.name}:`);
      for (const failure of item.failures) {
        lines.push(`  - ${failure}`);
      }
    }
  }

  if (result.ok) {
    lines.push('');
    lines.push('Publish readiness passed.');
  }

  return lines.join('\n');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.rootDir = argv[++index];
      continue;
    }
    if (arg === '--manifest') {
      options.manifestPath = argv[++index];
      continue;
    }
    if (arg === '--scope') {
      const value = argv[++index];
      const normalized = value.startsWith('@') ? value : `@${value}`;
      options.requiredScope = normalized.endsWith('/')
        ? normalized
        : `${normalized}/`;
      continue;
    }
    if (arg === '--no-scope-check') {
      options.requiredScope = '';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function isDirectRun() {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isDirectRun()) {
  try {
    const result = await checkPublishReadiness(
      parseArgs(process.argv.slice(2)),
    );
    console.log(formatReport(result));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export {
  checkPublishReadiness,
  collectEntryTargets,
  discoverPackages,
  formatReport,
  normalizeRelativeTarget,
  parseArgs,
  runNpmPackDryRun,
  validatePackageMetadata,
  validateTargets,
};
