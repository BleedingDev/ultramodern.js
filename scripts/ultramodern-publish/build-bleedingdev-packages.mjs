#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fsKit from '../lib/fs-kit.js';
import processKit from '../lib/process-kit.js';
import { collectPackageJsonFiles } from './lib/fs-utils.mjs';

const { readJsonFile, repoRoot } = fsKit;
const { runCommand } = processKit;
const excludedPackages = new Set([
  '@modern-js/main-doc',
  '@modern-js/module-tools-docs',
]);

function collectPublicModernPackages() {
  return collectPackageJsonFiles(path.join(repoRoot, 'packages'))
    .map(packageJsonPath => readJsonFile(packageJsonPath))
    .filter(packageJson => packageJson.name?.startsWith('@modern-js/'))
    .filter(packageJson => !packageJson.private)
    .map(packageJson => packageJson.name)
    .filter(packageName => !excludedPackages.has(packageName))
    .sort((a, b) => a.localeCompare(b));
}

function collectBuildProjects() {
  const output = execFileSync(
    'pnpm',
    ['exec', 'nx', 'show', 'projects', '--with-target', 'build', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  return new Set(JSON.parse(output));
}

function run(command, args) {
  const result = runCommand(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NX_DAEMON: 'false',
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.exitCode}`,
    );
  }
}

function main() {
  const buildProjects = collectBuildProjects();
  const packages = collectPublicModernPackages().filter(packageName =>
    buildProjects.has(packageName),
  );

  if (packages.length === 0) {
    throw new Error(
      'No publishable @modern-js packages with build targets found.',
    );
  }

  console.log(`Building ${packages.length} publishable @modern-js package(s).`);
  run('pnpm', [
    'exec',
    'nx',
    'run-many',
    '-t',
    'build',
    '-p',
    packages.join(','),
    '--maxParallel=8',
  ]);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
