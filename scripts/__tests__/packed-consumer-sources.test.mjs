import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripPackedFrameworkSources } from '../../tests/utils/packedConsumerSources.mjs';

function fixture(t) {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-consumer-source-'),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const consumer = path.join(temp, 'consumer');
  const store = path.join(consumer, 'node_modules/.pnpm');
  fs.mkdirSync(path.join(store, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(store, 'lock.yaml'), 'lockfileVersion: 9.0\n');
  function installed(storeEntry, name, manifestName = name) {
    const dir = path.join(store, storeEntry, 'node_modules', name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: manifestName }),
    );
    fs.writeFileSync(
      path.join(dir, 'src/index.ts'),
      'export const source = true;',
    );
    fs.writeFileSync(
      path.join(dir, 'dist/index.js'),
      'exports.published = true;',
    );
    return dir;
  }
  function link(target, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(
      target,
      destination,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  return { temp, consumer, store, installed, link };
}

test('strips every installed version of exact scoped and unscoped packed names', t => {
  const { consumer, installed } = fixture(t);
  const selected = [
    installed('framework@1', '@modern-js/framework'),
    installed('framework@2', '@modern-js/framework'),
    installed('plain@1', 'plain-framework'),
  ];
  const unrelated = [
    installed('other@1', '@modern-js/unrelated'),
    installed('other-scope@1', '@other/framework'),
    installed('plain-other@1', 'other-framework'),
  ];
  const result = stripPackedFrameworkSources(consumer, [
    '@modern-js/framework',
    'plain-framework',
  ]);
  assert.deepEqual(
    result.packages.map(({ packageDir }) => packageDir).sort(),
    selected.map(dir => fs.realpathSync(dir)).sort(),
  );
  for (const dir of selected) {
    assert.equal(fs.existsSync(path.join(dir, 'src')), false);
    assert.equal(
      fs.readFileSync(path.join(dir, 'dist/index.js'), 'utf8'),
      'exports.published = true;',
    );
    assert.equal(fs.existsSync(path.join(dir, 'package.json')), true);
  }
  for (const dir of unrelated)
    assert.equal(fs.existsSync(path.join(dir, 'src/index.ts')), true);
});

test('directory enumeration stays one pass when the packed cohort grows', t => {
  const { consumer, store, installed } = fixture(t);
  const framework = installed('framework@1', '@modern-js/framework');
  installed('unrelated@1', '@other/unrelated');
  // A fixture below a package must never become another traversal root.
  fs.mkdirSync(path.join(framework, 'fixtures/node_modules/.pnpm'), {
    recursive: true,
  });
  const realStore = fs.realpathSync(store);
  const reads = [];
  stripPackedFrameworkSources(
    consumer,
    [
      '@modern-js/framework',
      ...Array.from({ length: 100 }, (_, i) => `@modern-js/absent-${i}`),
    ],
    {
      filesystem: {
        ...fs,
        readdirSync(target, options) {
          reads.push(path.relative(realStore, target));
          return fs.readdirSync(target, options);
        },
        globSync() {
          assert.fail('the consumer scan must not issue a per-package glob');
        },
      },
    },
  );
  assert.deepEqual(
    reads.sort(),
    [
      '',
      path.join('framework@1', 'node_modules'),
      path.join('framework@1', 'node_modules', '@modern-js'),
      path.join('unrelated@1', 'node_modules'),
    ].sort(),
  );
  assert.equal(new Set(reads).size, reads.length);
});

test('deduplicates physical packages referenced from several store entries', t => {
  const { consumer, store, installed, link } = fixture(t);
  const physical = installed('framework@1', '@modern-js/framework');
  installed('dependent@1', 'dependent');
  link(
    physical,
    path.join(store, 'dependent@1/node_modules/@modern-js/framework'),
  );
  const removed = [];
  const result = stripPackedFrameworkSources(
    consumer,
    ['@modern-js/framework'],
    {
      filesystem: {
        ...fs,
        rmSync(target, options) {
          removed.push(target);
          return fs.rmSync(target, options);
        },
      },
    },
  );
  assert.equal(result.packages.length, 1);
  assert.deepEqual(removed, [path.join(fs.realpathSync(physical), 'src')]);
});

test('rejects an external package link before stripping any source', t => {
  const { temp, consumer, store, installed, link } = fixture(t);
  const valid = installed('a-framework@1', '@modern-js/framework');
  const external = path.join(temp, 'external-package');
  fs.mkdirSync(path.join(external, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(external, 'package.json'),
    JSON.stringify({ name: '@modern-js/framework' }),
  );
  fs.writeFileSync(path.join(external, 'src/index.ts'), 'outside');
  link(
    external,
    path.join(store, 'z-framework@2/node_modules/@modern-js/framework'),
  );
  assert.throws(
    () => stripPackedFrameworkSources(consumer, ['@modern-js/framework']),
    /escaped its consumer/u,
  );
  assert.equal(
    fs.readFileSync(path.join(external, 'src/index.ts'), 'utf8'),
    'outside',
  );
  assert.equal(fs.existsSync(path.join(valid, 'src/index.ts')), true);
});

test('rejects an external source link without removing the link or its target', t => {
  const { temp, consumer, installed, link } = fixture(t);
  const framework = installed('framework@1', '@modern-js/framework');
  fs.rmSync(path.join(framework, 'src'), { recursive: true });
  const external = path.join(temp, 'external-source');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'index.ts'), 'outside');
  link(external, path.join(framework, 'src'));
  assert.throws(
    () => stripPackedFrameworkSources(consumer, ['@modern-js/framework']),
    /package source .* escaped its consumer/u,
  );
  assert.equal(
    fs.lstatSync(path.join(framework, 'src')).isSymbolicLink(),
    true,
  );
  assert.equal(
    fs.readFileSync(path.join(external, 'index.ts'), 'utf8'),
    'outside',
  );
});

test('rejects an external scope before enumerating its children', t => {
  const { temp, consumer, store, installed, link } = fixture(t);
  installed('dependent@1', 'dependent');
  const external = path.join(temp, 'external-scope');
  fs.mkdirSync(external);
  link(external, path.join(store, 'dependent@1/node_modules/@modern-js'));
  const reads = [];
  assert.throws(
    () =>
      stripPackedFrameworkSources(consumer, ['@modern-js/framework'], {
        filesystem: {
          ...fs,
          readdirSync(target, options) {
            reads.push(target);
            return fs.readdirSync(target, options);
          },
        },
      }),
    /escaped its consumer/u,
  );
  assert.equal(reads.includes(external), false);
});

test('npm aliases retain every logical name while stripping the physical target once', t => {
  const { consumer, store, installed, link } = fixture(t);
  const target = installed('framework@1', '@bleedingdev/modern-js-framework');
  const unrelated = installed(
    'unrelated@1',
    '@modern-js/unrelated',
    '@bleedingdev/modern-js-framework',
  );
  installed('consumer@1', 'consumer');
  link(
    target,
    path.join(store, 'consumer@1/node_modules/@modern-js/framework'),
  );
  link(
    target,
    path.join(store, 'consumer@1/node_modules/@modern-js/framework-alias'),
  );
  const removed = [];
  const result = stripPackedFrameworkSources(
    consumer,
    ['@modern-js/framework', '@modern-js/framework-alias'],
    {
      filesystem: {
        ...fs,
        rmSync(source, options) {
          removed.push(source);
          return fs.rmSync(source, options);
        },
      },
    },
  );
  const packageDir = fs.realpathSync(target);
  assert.deepEqual(result.packages, [
    { name: '@modern-js/framework', packageDir },
    { name: '@modern-js/framework-alias', packageDir },
  ]);
  assert.deepEqual(removed, [path.join(packageDir, 'src')]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).name,
    '@bleedingdev/modern-js-framework',
  );
  assert.equal(fs.existsSync(path.join(unrelated, 'src/index.ts')), true);
});

test('invalid package paths and filesystem failures propagate without mutation', t => {
  const { consumer, store, installed } = fixture(t);
  const framework = installed('framework@1', '@modern-js/framework');
  for (const name of [
    '../outside',
    '@modern-js/../outside',
    '/absolute',
    '@modern-js',
    '',
  ]) {
    assert.throws(
      () => stripPackedFrameworkSources(consumer, [name]),
      /Invalid packed framework package name/u,
    );
  }
  const failure = Object.assign(new Error('cannot read the virtual store'), {
    code: 'EACCES',
  });
  assert.throws(
    () =>
      stripPackedFrameworkSources(consumer, ['@modern-js/framework'], {
        filesystem: {
          ...fs,
          readdirSync(target, options) {
            if (target === fs.realpathSync(store)) throw failure;
            return fs.readdirSync(target, options);
          },
        },
      }),
    error => error === failure,
  );
  assert.equal(fs.existsSync(path.join(framework, 'src/index.ts')), true);
});

test('absent src is allowed, while a missing expected store directory fails', t => {
  const { consumer, store, installed } = fixture(t);
  const framework = installed('framework@1', '@modern-js/framework');
  fs.rmSync(path.join(framework, 'src'), { recursive: true });
  assert.equal(
    stripPackedFrameworkSources(consumer, ['@modern-js/framework']).packages
      .length,
    1,
  );
  fs.mkdirSync(path.join(store, 'broken@1'));
  assert.throws(
    () => stripPackedFrameworkSources(consumer, ['@modern-js/framework']),
    { code: 'ENOENT' },
  );
});
