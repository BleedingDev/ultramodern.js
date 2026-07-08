import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  checkPublishReadiness,
  collectEntryTargets,
  formatReport,
  validateTargets,
} from './check.mjs';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-publish-readiness-test-'));

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeFile = filePath => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
};

test('collectEntryTargets extracts built, bin, and source-condition targets', () => {
  const targets = collectEntryTargets({
    main: './dist/index.js',
    types: './dist/index.d.ts',
    bin: {
      modern: 'bin/run.js',
    },
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
        'modern:source': './src/index.ts',
      },
      './package.json': './package.json',
    },
  });

  assert.deepEqual(
    targets.map(item => [item.field, item.target, item.isSourceCondition]),
    [
      ['main', 'dist/index.js', undefined],
      ['types', 'dist/index.d.ts', undefined],
      ['exports...types', 'dist/index.d.ts', false],
      ['exports...default', 'dist/index.js', false],
      ['exports...modern:source', 'src/index.ts', true],
      ['exports../package.json', 'package.json', false],
      ['bin.modern', 'bin/run.js', undefined],
    ],
  );
});

test('validateTargets fails missing built entries but warns for source conditions', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'dist/index.js'));
  const result = validateTargets(
    { packageDir: root },
    [
      { field: 'main', target: 'dist/index.js' },
      { field: 'types', target: 'dist/index.d.ts' },
      {
        field: 'exports...modern:source',
        target: 'src/index.ts',
        isSourceCondition: true,
      },
    ],
    new Set(['dist/index.js']),
  );

  assert.deepEqual(result.failures, [
    'types -> dist/index.d.ts does not resolve to a file',
  ]);
  assert.deepEqual(result.warnings, [
    'exports...modern:source -> src/index.ts is a missing modern:source condition target',
  ]);
});

test('checkPublishReadiness aggregates pack failures and skipped packages', async () => {
  const root = makeTempDir();
  const readyPackage = path.join(root, 'packages/ready/package');
  const skippedPackage = path.join(root, 'packages/skipped/package');
  writeJson(path.join(root, 'manifest.json'), {
    packages: [
      {
        sourceName: '@modern-js/ready',
        targetName: '@bleedingdev/modern-js-ready',
        version: '1.0.0-ultramodern.0',
        packageDir: readyPackage,
      },
      {
        sourceName: '@modern-js/skipped',
        targetName: '@bleedingdev/modern-js-skipped',
        version: '1.0.0-ultramodern.0',
        packageDir: skippedPackage,
      },
    ],
  });
  writeJson(path.join(readyPackage, 'package.json'), {
    name: '@bleedingdev/modern-js-ready',
    version: '1.0.0-ultramodern.0',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    publishConfig: {
      registry: 'https://registry.npmjs.org/',
      access: 'public',
    },
  });
  writeFile(path.join(readyPackage, 'dist/index.js'));
  writeFile(path.join(readyPackage, 'dist/index.d.ts'));
  writeJson(path.join(skippedPackage, 'package.json'), {
    name: '@bleedingdev/modern-js-skipped',
    version: '1.0.0-ultramodern.0',
    main: './dist/index.js',
    publishConfig: {
      registry: 'https://registry.npmjs.org/',
      access: 'public',
    },
  });

  const result = await checkPublishReadiness({
    rootDir: root,
    packRunner: async () => ({
      ok: true,
      files: new Set(['dist/index.js', 'dist/index.d.ts', 'package.json']),
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.packages.map(item => item.name),
    ['@bleedingdev/modern-js-ready'],
  );
  assert.deepEqual(result.skipped, [
    {
      name: '@bleedingdev/modern-js-skipped',
      packageDir: path.relative(process.cwd(), skippedPackage),
      reason:
        'dist build output is absent; run the package build before readiness',
    },
  ]);
});

test('formatReport includes clear failure details', () => {
  const report = formatReport({
    ok: false,
    rootDir: process.cwd(),
    manifestPath: path.join(process.cwd(), 'manifest.json'),
    packages: [
      {
        name: '@bleedingdev/modern-js-broken',
        targetCount: 1,
        packFileCount: 2,
        usedPackAllowlist: true,
      },
    ],
    skipped: [],
    warnings: [],
    failures: [
      {
        name: '@bleedingdev/modern-js-broken',
        failures: ['main -> dist/index.js does not resolve to a file'],
      },
    ],
  });

  assert.match(
    report,
    /Checked 1 package\(s\); skipped 0; warnings 0; failures 1\./,
  );
  assert.match(report, /@bleedingdev\/modern-js-broken/);
  assert.match(report, /main -> dist\/index\.js does not resolve to a file/);
});
