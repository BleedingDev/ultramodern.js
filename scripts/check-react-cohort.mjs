#!/usr/bin/env node
// Fails when the workspace lockfile resolves more than one React.
//
// A package that uses a react-peer library (styled-components,
// @loadable/component, ...) without declaring react itself lets pnpm satisfy
// that peer from any react in the store. Two Reacts in one test run break
// hooks and context, so every importer must resolve react and react-dom to
// the cohort pin from ultramodern-create's versions.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

// Docs and storybook ship their own React through rspress/storybook.
const EXEMPT_IMPORTERS = new Set(['packages/document', 'examples/storybook']);

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
];

// Matches `react@X` / `react-dom@X` as a whole package name: either the
// start of `name@version` or a peer suffix `(react@X)`.
const REACT_REF = /(?:^|\()(react|react-dom)@([^()]+)/g;

export function readReactCohortPin(root = repoRoot) {
  const source = readFileSync(
    path.join(
      root,
      'packages/toolkit/ultramodern-create/src/ultramodern-workspace/versions.ts',
    ),
    'utf8',
  );
  const match = source.match(/export const REACT_VERSION = '([^']+)'/);
  if (!match) {
    throw new Error(
      'check-react-cohort: REACT_VERSION not found in ultramodern-create versions.ts',
    );
  }
  return match[1];
}

export function findReactCohortViolations(lockfileText, pin) {
  const lockfile = parse(lockfileText);
  const violations = [];

  for (const [importer, manifest] of Object.entries(lockfile.importers ?? {})) {
    if (EXEMPT_IMPORTERS.has(importer)) continue;
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, entry] of Object.entries(manifest[field] ?? {})) {
        const resolved = `${name}@${entry.version}`;
        for (const [, reactName, version] of resolved.matchAll(REACT_REF)) {
          if (version === pin) continue;
          violations.push(
            `${importer}: ${resolved} resolves ${reactName}@${version}, not the cohort pin ${reactName}@${pin}. ` +
              `Add "${reactName}": "^${pin}" to devDependencies of ${importer}/package.json and run pnpm install.`,
          );
        }
      }
    }
  }

  const keys = [
    ...Object.keys(lockfile.packages ?? {}),
    ...Object.keys(lockfile.snapshots ?? {}),
  ];
  const mismatched = new Set();
  for (const key of keys) {
    for (const [, domVersion, reactVersion] of key.matchAll(
      /(?:^|\()react-dom@([^()]+)\(react@([^()]+)\)/g,
    )) {
      if (domVersion !== reactVersion) {
        mismatched.add(`react-dom@${domVersion}(react@${reactVersion})`);
      }
    }
  }
  for (const pair of mismatched) {
    violations.push(
      `lockfile pairs ${pair}: react-dom and react versions differ. ` +
        'Declare matching react and react-dom devDependencies in the importer that pulls this snapshot.',
    );
  }

  return violations;
}

function main() {
  const pin = readReactCohortPin();
  const violations = findReactCohortViolations(
    readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    pin,
  );
  if (violations.length > 0) {
    console.error(
      `check-react-cohort: ${violations.length} importer(s) resolve react off the cohort pin ${pin}:\n` +
        violations.map(line => `  - ${line}`).join('\n'),
    );
    process.exit(1);
  }
  console.log(`check-react-cohort: every importer resolves react@${pin}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
