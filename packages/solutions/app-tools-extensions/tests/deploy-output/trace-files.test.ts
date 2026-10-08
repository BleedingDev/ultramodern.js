import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBuildHostIgnore,
  traceDeployFiles,
} from '../../src/deploy-output/trace-files';

const ENTRY = `
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const name = process.argv[2];
try { require(process.env.PLUGIN_ROOT + '/plugin.js'); } catch {}
try { fs.readFileSync(path.join(os.homedir(), name)); } catch {}
try { fs.readFileSync(path.join(os.tmpdir(), name)); } catch {}
try { fs.readFileSync('/proc/self/' + name); } catch {}
try { fs.readdirSync('/dev/' + name); } catch {}
try { require('/etc/' + name); } catch {}
require('./local');
`;

describe('deploy file trace', () => {
  for (const format of ['cjs', 'mjs']) {
    it(`loads the tracing dependency only when a ${format === 'cjs' ? 'CJS' : 'ESM'} public config traces files`, async () => {
      const fixtureRoot = await mkdtemp(
        path.join(os.tmpdir(), 'deploy-trace-admission #%-'),
      );
      try {
        const fixtureDir = await realpath(fixtureRoot);
        const packageLinks = path.join(fixtureDir, 'node_modules/@modern-js');
        await mkdir(packageLinks, { recursive: true });
        await mkdir(path.join(fixtureDir, 'other-cwd'));
        for (const name of ['ultramodern-app-tools', 'app-tools-extensions']) {
          await symlink(
            await realpath(path.resolve(__dirname, '../../../', name)),
            path.join(packageLinks, name),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
        }
        await writeFile(
          path.join(fixtureDir, 'package.json'),
          JSON.stringify({ name: 'deploy-trace-consumer', private: true }),
        );
        await writeFile(
          path.join(fixtureDir, `modern.config.${format}`),
          format === 'cjs'
            ? `const { defineConfig } = require('@modern-js/ultramodern-app-tools');
module.exports = defineConfig({});
`
            : `import { defineConfig } from '@modern-js/ultramodern-app-tools';
export default defineConfig({});
`,
        );
        await writeFile(
          path.join(fixtureDir, 'entry.cjs'),
          "module.exports = require('./local.cjs');\n",
        );
        await writeFile(
          path.join(fixtureDir, 'local.cjs'),
          'module.exports = 1;\n',
        );
        const consumer = path.join(fixtureDir, 'consumer.mjs');
        await writeFile(
          consumer,
          `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const commonJs = process.argv[2] === 'cjs';
const rootSpecifier = '@modern-js/ultramodern-app-tools';
const traceSpecifier = '@modern-js/app-tools-extensions/deploy-output/trace-files';
const resolvePublic = specifier => commonJs
  ? require.resolve(specifier)
  : fileURLToPath(import.meta.resolve(specifier));
for (const specifier of [rootSpecifier, traceSpecifier]) {
  assert.ok(resolvePublic(specifier).split(path.sep).join('/').includes(
    commonJs ? '/dist/cjs/' : '/dist/esm-node/'
  ), 'the consumer must use the public built package');
}
const ownerRequire = createRequire(resolvePublic(traceSpecifier));
const nftEntry = ownerRequire.resolve('@vercel/nft');
assert.equal(Boolean(require.cache[nftEntry]), false, 'NFT starts unloaded');

const fixtureDir = process.cwd();
const configFile = path.join(fixtureDir, 'modern.config.' + process.argv[2]);
const config = commonJs
  ? require(configFile)
  : (await import(pathToFileURL(configFile).href)).default;
assert.equal(config.renderer, 'react');
assert.equal(Boolean(require.cache[nftEntry]), false, 'config import must not load the extensions NFT');

const { traceDeployFiles } = commonJs
  ? require(traceSpecifier)
  : await import(traceSpecifier);
assert.equal(Boolean(require.cache[nftEntry]), false, 'tracer import must not load NFT');
assert.throws(() => traceDeployFiles({
  entryFiles: ['entry.cjs'],
  sourceDir: '.',
  base: 42,
}), TypeError);
assert.equal(Boolean(require.cache[nftEntry]), false, 'invalid base must fail before loading NFT');

const entries = ['entry.cjs'];
const pending = traceDeployFiles({ entryFiles: entries, sourceDir: '.', base: '.' });
entries[0] = 'missing.cjs';
process.chdir(path.join(fixtureDir, 'other-cwd'));
try {
  const { fileList } = await pending;
  assert.ok(fileList.has('entry.cjs'), 'trace must keep the original entry and cwd');
  assert.ok(fileList.has('local.cjs'), 'trace must include the real local dependency');
} finally {
  process.chdir(fixtureDir);
}
assert.ok(require.cache[nftEntry], 'tracing must load the extensions NFT');

async function expectRejectedArgument(options) {
  let rejected;
  assert.doesNotThrow(() => { rejected = traceDeployFiles(options); });
  assert.ok(rejected instanceof Promise);
  await assert.rejects(rejected, TypeError);
}
await expectRejectedArgument({ entryFiles: [42], sourceDir: '.', base: '.' });
await expectRejectedArgument({ entryFiles: ['entry.cjs'], sourceDir: 42, base: '.' });
process.stdout.write('traced entry and local dependency\\n');
`,
        );
        const result = spawnSync(process.execPath, [consumer, format], {
          cwd: fixtureDir,
          encoding: 'utf8',
        });
        expect(
          result.status,
          `stdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`,
        ).toBe(0);
        expect(result.stdout).toBe('traced entry and local dependency\n');
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }

  it('does not enumerate the build host for dynamic paths', async () => {
    const fixtureDir = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'deploy-trace-')),
    );
    try {
      const entry = path.join(fixtureDir, 'index.js');
      await writeFile(entry, ENTRY);
      await writeFile(path.join(fixtureDir, 'local.js'), 'module.exports = 1;');

      const { fileList } = await traceDeployFiles({
        entryFiles: [entry],
        sourceDir: fixtureDir,
      });

      const traced = [...fileList].map(file => path.resolve('/', file));
      // Symlinked ancestors of the fixture (e.g. macOS /var -> /private/var)
      // are recorded too; everything else must come from the fixture itself.
      const outside = traced.filter(
        file =>
          !file.startsWith(`${fixtureDir}${path.sep}`) &&
          !fixtureDir.startsWith(`${file}${path.sep}`),
      );
      expect(outside).toEqual([]);
      expect(traced).toContain(path.join(fixtureDir, 'local.js'));
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('ignores whole-directory globs of root, home and temp only', () => {
    const ignore = createBuildHostIgnore('/');
    const rel = (file: string) => path.relative('/', file);
    const home = os.homedir();

    expect(ignore(rel(path.join(home, '**/*')))).toBe(true);
    expect(ignore(rel(path.join(os.tmpdir(), '*')))).toBe(true);
    expect(ignore('**/*')).toBe(true);
    expect(ignore(rel(path.join(home, 'store/pkg/index.js')))).toBe(false);
    expect(ignore(rel(path.join(home, 'store/pkg/locales/**/*')))).toBe(false);
    if (process.platform !== 'win32') {
      expect(ignore('proc/self/**/*')).toBe(true);
      expect(ignore('dev/null')).toBe(true);
      expect(ignore('var/run/docker.sock')).toBe(true);
      expect(ignore('var/lib/app/index.js')).toBe(false);
    }
  });
});
