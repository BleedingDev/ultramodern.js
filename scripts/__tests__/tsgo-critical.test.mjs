import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('critical Effect TS-Go checks use the immutable framework resolver', () => {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  );
  const source = readFileSync(
    join(repoRoot, 'scripts/tsgo-critical.mjs'),
    'utf-8',
  );

  assert.equal(
    packageJson.devDependencies?.['@modern-js/app-tools'],
    'workspace:*',
  );
  assert.match(
    source,
    /import \{ resolveEffectTsgoCompiler \} from '@modern-js\/app-tools\/config';/u,
  );
  assert.match(
    source,
    /resolveEffectTsgoCompiler\(\{ from: import\.meta\.url \}\)/u,
  );
  assert.doesNotMatch(source, /\bchmod(?:Sync)?\b/u);
  assert.doesNotMatch(source, /node_modules\/\.bin\/effect-tsgo/u);
});
