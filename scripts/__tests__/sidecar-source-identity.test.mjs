import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parsePnpmLockfile as parse } from '../lib/parse-pnpm-lockfile.mjs';

import { isUnpublishedForkEdge } from '../ultramodern-supply/verify-sidecars.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const recipes = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'scripts/ultramodern-supply/sidecars.json'),
    'utf8',
  ),
);

// Framework packages ship their source edges unchanged, so the graph the
// monorepo tests must already be the corrected sidecar graph: a runtime edge
// of a framework package may not resolve an upstream name that has a recipe.
function upstreamRecipeEdges(lockfileText) {
  const byUpstream = new Map(
    recipes.map(recipe => [recipe.upstream.name, recipe]),
  );
  const edges = [];
  for (const [importer, blocks] of Object.entries(
    parse(lockfileText).importers ?? {},
  )) {
    if (!importer.startsWith('packages/')) continue;
    for (const block of ['dependencies', 'optionalDependencies']) {
      for (const [name, { version }] of Object.entries(blocks[block] ?? {})) {
        const recipe = byUpstream.get(name);
        if (!recipe) continue;
        const fork = `${recipe.fork.name}@${recipe.fork.version}`;
        if (
          version !== fork &&
          !version.startsWith(`${fork}(`) &&
          !isUnpublishedForkEdge(importer, name, version, recipe)
        ) {
          edges.push(`${importer} ${block}.${name} -> ${version}`);
        }
      }
    }
  }
  return edges;
}

test('no framework runtime edge resolves an upstream package that has a recipe', () => {
  assert.deepEqual(
    upstreamRecipeEdges(
      readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    ),
    [],
  );
});

test('a framework package resolving an upstream MF package or another sidecar version fails', () => {
  assert.deepEqual(
    upstreamRecipeEdges(`
lockfileVersion: '9.0'
importers:
  packages/server/server:
    dependencies:
      '@module-federation/enhanced':
        specifier: 2.9.2
        version: 2.9.2
  packages/runtime/federation-runtime:
    dependencies:
      '@module-federation/enhanced':
        specifier: npm:@bleedingdev/mf-enhanced@2.9.20
        version: '@bleedingdev/mf-enhanced@2.9.20(@types/node@26.6.2)'
  tests/integration/mf:
    dependencies:
      '@module-federation/enhanced':
        specifier: 2.9.2
        version: 2.9.2
`),
    [
      'packages/server/server dependencies.@module-federation/enhanced -> 2.9.2',
      'packages/runtime/federation-runtime dependencies.@module-federation/enhanced -> @bleedingdev/mf-enhanced@2.9.20(@types/node@26.6.2)',
    ],
  );
});
