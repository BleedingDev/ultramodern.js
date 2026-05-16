#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const defaultExcludedPackages = new Set([
  '@modern-js/main-doc',
  '@modern-js/module-tools-docs',
]);

function parseArgs(argv) {
  const options = {
    base: 'HEAD~1',
    head: 'HEAD',
    mode: 'changed',
    exclude: new Set(defaultExcludedPackages),
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

    if (arg === '--base') {
      options.base = readValue();
    } else if (arg === '--head') {
      options.head = readValue();
    } else if (arg === '--mode') {
      options.mode = readValue();
    } else if (arg === '--exclude') {
      for (const packageName of readValue()
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)) {
        options.exclude.add(packageName);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.mode !== 'changed' && options.mode !== 'affected') {
    throw new Error('--mode must be "changed" or "affected"');
  }

  return options;
}

function collectPublicModernPackages() {
  const packagesDir = path.join(repoRoot, 'packages');
  const packages = new Map();

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          visit(entryPath);
        }
        continue;
      }
      if (entry.name !== 'package.json') {
        continue;
      }

      const packageJson = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
      if (packageJson.name?.startsWith('@modern-js/') && !packageJson.private) {
        packages.set(packageJson.name, {
          name: packageJson.name,
          root: path.relative(repoRoot, path.dirname(entryPath)),
        });
      }
    }
  }

  visit(packagesDir);
  return packages;
}

function resolveAffectedProjects(options) {
  const output = execFileSync(
    'pnpm',
    [
      'exec',
      'nx',
      'show',
      'projects',
      '--affected',
      `--base=${options.base}`,
      `--head=${options.head}`,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function resolveChangedProjects(options, publicPackages) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', options.base, options.head],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const changedFiles = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return [...publicPackages.values()]
    .filter(packageInfo =>
      changedFiles.some(
        filePath =>
          filePath === packageInfo.root ||
          filePath.startsWith(`${packageInfo.root}/`),
      ),
    )
    .map(packageInfo => packageInfo.name);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const publicPackages = collectPublicModernPackages();
  const projects =
    options.mode === 'affected'
      ? resolveAffectedProjects(options)
      : resolveChangedProjects(options, publicPackages);
  const publishable = projects
    .filter(projectName => publicPackages.has(projectName))
    .filter(projectName => !options.exclude.has(projectName))
    .sort((a, b) => a.localeCompare(b));

  console.log(publishable.join(','));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
