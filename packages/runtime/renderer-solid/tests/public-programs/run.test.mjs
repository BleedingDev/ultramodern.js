import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  createPublicProgram,
  publicEntries,
  publicPackageName,
} from './run.mjs';

test('each public entry is a separate canonical strict program', () => {
  assert.deepEqual(Object.keys(publicEntries), [
    'client',
    'router',
    'server',
    'manifest',
  ]);
  for (const [entry, { extension }] of Object.entries(publicEntries)) {
    const fixture = `./${entry}.${extension}`;
    const program = createPublicProgram(entry, fixture);
    assert.deepEqual(program.files, [fixture]);
    assert.deepEqual(program.include, []);
    assert.deepEqual(program.exclude, []);
    assert.equal(program.compilerOptions.strict, true);
    assert.equal(program.compilerOptions.noEmit, true);
    assert.equal(program.compilerOptions.noCheck, false);
    assert.equal(program.compilerOptions.skipLibCheck, false);
    assert.equal(program.compilerOptions.jsxImportSource, '@solidjs/web');
    assert.equal(program.compilerOptions.exactOptionalPropertyTypes, true);
    assert.equal(program.compilerOptions.noUncheckedIndexedAccess, true);
    assert.equal(Object.hasOwn(program, 'extends'), false);
    assert.equal(Object.hasOwn(program.compilerOptions, 'paths'), false);
    assert.equal(
      Object.hasOwn(program.compilerOptions, 'customConditions'),
      false,
    );
  }
});

test('browser and host programs have explicit independent ambient scopes', () => {
  for (const entry of ['client', 'router'])
    assert.deepEqual(
      createPublicProgram(entry, `./${entry}.tsx`).compilerOptions.types,
      [],
    );
  for (const entry of ['server', 'manifest'])
    assert.deepEqual(
      createPublicProgram(entry, `./${entry}.ts`).compilerOptions.types,
      ['node'],
    );
  const changed = createPublicProgram('client', './client.tsx');
  changed.compilerOptions.types.push('node');
  assert.deepEqual(
    createPublicProgram('client', './client.tsx').compilerOptions.types,
    [],
  );
  assert.throws(
    () => createPublicProgram('unknown', './unknown.ts'),
    /Unknown Solid public entry/u,
  );
});

test('authored fixtures retain their literal mapped public imports without suppressions', async () => {
  for (const [entry, { extension }] of Object.entries(publicEntries)) {
    const source = await fs.readFile(
      new URL(`./fixtures/${entry}.${extension}`, import.meta.url),
      'utf8',
    );
    assert.ok(source.includes(`'${publicPackageName}/${entry}'`));
    assert.doesNotMatch(
      source,
      /@ts-(?:ignore|expect-error|nocheck)|@jsxImportSource|\bdeclare\b|\bas\s+[\w<{[]/u,
    );
    assert.doesNotMatch(
      source,
      /\bfrom\s+['"](?:react|react-dom|octane|\.\/|\.\.\/)/u,
    );
  }
});
