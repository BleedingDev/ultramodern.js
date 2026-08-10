import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveEffectTsgoCompiler } from '@modern-js/app-tools/config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('critical Effect TS-Go compiler resolves through the public framework API', () => {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  );
  assert.equal(
    packageJson.devDependencies?.['@modern-js/app-tools'],
    'workspace:*',
  );
  const compiler = resolveEffectTsgoCompiler({ from: import.meta.url });
  assert.equal(existsSync(compiler), true);
  assert.equal(compiler.includes('node_modules/.bin/effect-tsgo'), false);
});
