import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findReactCohortViolations,
  readReactCohortPin,
} from '../check-react-cohort.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

test('workspace lockfile resolves a single react at the cohort pin', () => {
  const pin = readReactCohortPin(repoRoot);
  const violations = findReactCohortViolations(
    readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    pin,
  );
  assert.deepEqual(violations, []);
});

// Shape of the lockfile before plugin-styled-components and app-tools
// declared react: their react peers resolved to the docs site's react.
const preFixLockfile = `
lockfileVersion: '9.0'
importers:
  packages/cli/plugin-styled-components:
    devDependencies:
      styled-components:
        specifier: ^6.5.3
        version: 6.5.3(react-dom@19.3.0(react@19.3.0))(react@19.2.8)
  packages/solutions/app-tools:
    dependencies:
      '@loadable/component':
        specifier: 5.16.7
        version: 5.16.7(react@19.2.8)
      '@testing-library/react':
        specifier: ^16.3.0
        version: 16.3.3(react@19.3.0)
  packages/document:
    dependencies:
      react:
        specifier: 19.2.8
        version: 19.2.8
snapshots:
  react-dom@19.3.0(react@19.2.8):
    dependencies:
      react: 19.2.8
`;

test('names the importer and devDependency that resolve react off the pin', () => {
  const violations = findReactCohortViolations(preFixLockfile, '19.3.0');
  assert.equal(violations.length, 3, violations.join('\n'));
  assert.match(
    violations[0],
    /^packages\/cli\/plugin-styled-components: .*react@19\.2\.8.*Add "react": "\^19\.3\.0" to devDependencies/,
  );
  assert.match(
    violations[1],
    /^packages\/solutions\/app-tools: @loadable\/component@5\.16\.7\(react@19\.2\.8\)/,
  );
  assert.match(violations[2], /react-dom@19\.3\.0\(react@19\.2\.8\)/);
});

test('reads the pin from ultramodern-create versions', () => {
  assert.match(readReactCohortPin(repoRoot), /^\d+\.\d+\.\d+$/);
});
