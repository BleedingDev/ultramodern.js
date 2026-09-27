import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

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

test('a framework package resolving upstream ipx or another sidecar version fails', () => {
  assert.deepEqual(
    upstreamRecipeEdges(`
lockfileVersion: '9.0'
importers:
  packages/runtime/plugin-image:
    dependencies:
      ipx:
        specifier: ^3.1.1
        version: 3.1.1
  packages/runtime/image:
    dependencies:
      ipx:
        specifier: npm:@bleedingdev/ipx@3.2.20
        version: '@bleedingdev/ipx@3.2.20(@types/node@26.6.2)'
  tests/integration/image-component:
    dependencies:
      ipx:
        specifier: ^3.1.1
        version: 3.1.1
`),
    [
      'packages/runtime/plugin-image dependencies.ipx -> 3.1.1',
      'packages/runtime/image dependencies.ipx -> @bleedingdev/ipx@3.2.20(@types/node@26.6.2)',
    ],
  );
});
