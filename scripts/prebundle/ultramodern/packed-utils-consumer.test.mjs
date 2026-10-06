import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import tsgoInvocation from '../../lib/tsgo-invocation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const utils = join(root, 'packages/toolkit/utils');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

test('prebundle distinguishes native CommonJS paths from separate ESM entries', async () => {
  const require = createRequire(import.meta.url);
  const { parseTasks } = require('../dist/helper.js');
  for (const name of ['debug', 'minimist', 'json5', 'fs-extra', 'lodash']) {
    const [task] = await parseTasks(name);
    assert.equal(task.depEsmEntry, '', name);
  }
  const [dual] = await parseTasks('glob');
  assert.notEqual(dual.depEsmEntry, dual.depEntry);
  assert.ok(existsSync(dual.depEsmEntry));
  const [esm] = await parseTasks('execa');
  assert.equal(esm.depEsmEntry, esm.depEntry);
});

test('prebundle selects one dependency and rejects unsupported CLI arguments', () => {
  const producer = join(root, 'scripts/prebundle/dist/index.js');
  const output = run(process.execPath, [producer, 'commander'], root);
  assert.equal((output.match(/Start prebundle/g) ?? []).length, 1);
  assert.match(output, /Start prebundle "commander"/);
  for (const args of [['unknown-dependency'], ['commander', 'extra']]) {
    const result = spawnSync(process.execPath, [producer, ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Start prebundle/);
  }
});

test('packed utils contains generated bundles and works without workspace source in Node import and require', () => {
  const fixture = mkdtempSync(
    join(process.env.OWNED_TEMP_DIR ?? tmpdir(), 'packed-utils-'),
  );
  try {
    const tarballs = join(fixture, 'tarballs');
    const consumer = join(fixture, 'consumer');
    mkdirSync(tarballs);
    mkdirSync(consumer);
    run(pnpm, ['pack', '--pack-destination', tarballs], utils);
    const tarball = join(
      tarballs,
      readdirSync(tarballs).find(file => file.endsWith('.tgz')),
    );
    const manifest = JSON.parse(
      readFileSync(join(utils, 'package.json'), 'utf8'),
    );
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { [manifest.name]: `file:${tarball}` },
        devDependencies: { '@types/node': '26.6.3' },
      }),
    );
    writeFileSync(
      join(consumer, 'pnpm-workspace.yaml'),
      'packages: [.]\nautoInstallPeers: false\npackageImportMethod: clone-or-copy\n',
    );
    run(pnpm, ['install', '--ignore-scripts', '--prefer-offline'], consumer);
    const installed = join(consumer, 'node_modules/@modern-js/utils');
    assert.equal(existsSync(join(installed, 'src')), false);
    assert.equal(existsSync(join(installed, 'compiled')), false);
    const compiled = join(installed, 'dist/compiled');
    assert.equal(
      JSON.parse(readFileSync(join(compiled, 'lodash/package.json'), 'utf8'))
        .name,
      'lodash-compiled',
    );
    const lockfileSha256 = JSON.parse(
      readFileSync(join(compiled, 'execa/provenance.json'), 'utf8'),
    ).lockfileSha256;
    assert.match(lockfileSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      lockfileSha256,
      createHash('sha256')
        .update(readFileSync(join(root, 'pnpm-lock.yaml')))
        .digest('hex'),
    );
    for (const name of readdirSync(compiled)) {
      const files = readdirSync(join(compiled, name));
      assert.ok(files.includes('index.js'), name);
      assert.ok(files.includes('index.d.ts'), name);
      assert.ok(
        files.some(file => /^licen[cs]e/i.test(file)),
        name,
      );
      const provenance = JSON.parse(
        readFileSync(join(compiled, name, 'provenance.json'), 'utf8'),
      );
      assert.equal(provenance.name, name);
      assert.equal(provenance.lockfileSha256, lockfileSha256);
      assert.ok(provenance.version, name);
      assert.ok(provenance.declarationSources.length > 0, name);
    }
    const subpaths = Object.keys(manifest.exports).map(key =>
      key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`,
    );
    for (const mode of ['cjs', 'mjs']) {
      const source = `
        ${mode === 'mjs' ? "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" : ''}
        const assert = require('node:assert/strict');
        const load = ${mode === 'mjs' ? 'specifier => import(specifier)' : 'async specifier => require(specifier)'};
        (async () => {
          for (const path of ${JSON.stringify(subpaths)}) await load(path);
          const execa = await load('@modern-js/utils/execa');
          assert.equal((await execa.execa(process.execPath, ['-e', 'console.log("packed")'])).stdout, 'packed');
          const glob = await load('@modern-js/utils/glob');
          assert.deepEqual(await glob.glob('package.json'), ['package.json']);
          const commander = await load('@modern-js/utils/commander');
          assert.equal(new commander.Command().name('packed').name(), 'packed');
          const semver = await load('@modern-js/utils/semver');
          assert.equal((semver.default ?? semver).satisfies('26.10.0', '>=26'), true);
          const ansi = await load('@modern-js/utils/strip-ansi');
          assert.equal(ansi.default('\\u001b[31mpacked\\u001b[39m'), 'packed');
          const lodash = await load('@modern-js/utils/lodash');
          assert.deepEqual(lodash.map([{ value: 1 }], item => item.value), [1]);
          const utils = await load('@modern-js/utils');
          assert.deepEqual(utils.lodash.merge({ nested: { a: 1 } }, { nested: { b: 2 } }), { nested: { a: 1, b: 2 } });
          assert.equal(utils.fs.existsSync('package.json'), true);
          assert.equal(typeof utils.debug('packed'), 'function');
          assert.equal(await utils.pkgUp({ cwd: process.cwd() }), require('node:path').join(process.cwd(), 'package.json'));
          assert.equal(utils.pkgUp.sync({ cwd: process.cwd() }), require('node:path').join(process.cwd(), 'package.json'));
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const file = join(consumer, `consumer.${mode}`);
      writeFileSync(file, source);
      run(process.execPath, [file], consumer);
    }
    for (const extension of ['mts', 'cts']) {
      writeFileSync(
        join(consumer, `types.${extension}`),
        `
        import { execa } from '@modern-js/utils/execa';
        import { Command } from '@modern-js/utils/commander';
        import { glob } from '@modern-js/utils/glob';
        import semver from '@modern-js/utils/semver';
        const command: Command = new Command();
        const files: Promise<string[]> = glob('*.json');
        const valid: boolean = semver.satisfies('26.10.0', '>=26');
        const execution = execa('node', ['--version']);
        void command; void files; void valid; void execution;
      `,
      );
    }
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ESNext',
          types: ['node'],
        },
        include: ['types.mts', 'types.cts'],
      }),
    );
    const invocation = tsgoInvocation.createTsgoInvocation({
      args: ['--project', join(consumer, 'tsconfig.json')],
      requireFrom: createRequire(join(root, 'package.json')),
    });
    run(invocation.command, invocation.argv, consumer);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
