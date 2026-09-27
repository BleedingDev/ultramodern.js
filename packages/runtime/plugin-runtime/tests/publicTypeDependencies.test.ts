import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';

const packageRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
) as {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const runtimeSourceDirectories = [
  path.join(packageRoot, 'src', 'core'),
  path.join(packageRoot, 'src', 'router', 'runtime'),
  path.join(packageRoot, 'src', 'exports'),
];

const collectFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (/\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
};

// The package reaches its own contexts through a self-reference.
const declaredPackages = new Set([
  manifest.name,
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

describe('runtime public type dependencies', () => {
  test('runtime sources never reach into the solution package', () => {
    // A consumer type-checks against this package's declarations. Referencing
    // `@modern-js/app-tools` there forces every consumer to install the
    // solution package purely for tsc, which an isolated (pnpm) layout does
    // not do on its own.
    const offenders = runtimeSourceDirectories
      .flatMap(collectFiles)
      .filter(file =>
        fs.readFileSync(file, 'utf8').includes("from '@modern-js/app-tools'"),
      )
      .map(file => path.relative(packageRoot, file));

    expect(offenders).toEqual([]);
  });

  test('every package the runtime types reference is declared', () => {
    const referenced = new Set<string>();
    for (const file of runtimeSourceDirectories.flatMap(collectFiles)) {
      const contents = fs.readFileSync(file, 'utf8');
      for (const match of contents.matchAll(
        /from '(@modern-js\/[a-z0-9-]+)(?:\/[^']*)?'/gu,
      )) {
        referenced.add(match[1]);
      }
    }

    const undeclared = [...referenced]
      .filter(name => !declaredPackages.has(name))
      .sort();

    expect(undeclared).toEqual([]);
  });
});
