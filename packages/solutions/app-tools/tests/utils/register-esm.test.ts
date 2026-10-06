import { spawnSync } from 'node:child_process';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDirectory = path.resolve(__dirname, '../..');
const repoDirectory = path.resolve(packageDirectory, '../../..');
const registerUrl = pathToFileURL(
  path.join(packageDirectory, 'src/esm/register-esm.mjs'),
).href;

describe('registerPathsLoader', () => {
  it('resolves CommonJS aliases through native synchronous loader hooks', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'modern-cjs-alias-'));
    writeFileSync(
      path.join(directory, 'fixture.mjs'),
      'export const value = 42;',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
import { createRequire } from 'node:module';
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const hooks = await registerPathsLoader({
  appDir: ${JSON.stringify(directory)},
  baseUrl: ${JSON.stringify(directory)},
  paths: {
    '@fixture/module': ['fixture.mjs'],
    '@modern-js/utils': ['fixture.mjs'],
  },
});
try {
  console.log(createRequire(import.meta.url)('@fixture/module').value);
  console.log(createRequire(${JSON.stringify(registerUrl)})('@modern-js/utils').program ? 'framework' : 'shadowed');
} finally {
  hooks.deregister();
}
`,
        ],
        { cwd: directory, encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('42\nframework');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not use deprecated module.register when registerHooks is available', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--trace-deprecation',
        '--input-type=module',
        '-e',
        `
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const hooks = await registerPathsLoader({
  appDir: process.cwd(),
  baseUrl: process.cwd(),
  paths: {},
});
hooks?.deregister?.();
console.log('registered');
`,
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('registered');
    expect(result.stderr).not.toContain('DEP0205');
    expect(result.stderr).not.toContain('module.register() is deprecated');
  });

  it('loads the installed CommonJS PostCSS plugin through its native relative imports', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const repoDirectory = process.argv[1];
const builderRequire = createRequire(path.join(repoDirectory, 'packages/cli/builder/package.json'));
const vendorEntry = builderRequire.resolve('postcss-flexbugs-fixes');
assert.ok(fs.realpathSync(vendorEntry).startsWith(repoDirectory + path.sep));
const hooks = await registerPathsLoader({ appDir: repoDirectory, baseUrl: repoDirectory, paths: {} });
try {
  const plugin = builderRequire('postcss-flexbugs-fixes');
  assert.equal(typeof plugin, 'function');
  assert.equal(plugin.postcss, true);
  assert.equal(plugin().postcssPlugin, 'postcss-flexbugs-fixes');
  const vendorRequire = createRequire(vendorEntry);
  const bug4Path = vendorRequire.resolve('./bugs/bug4');
  assert.ok(builderRequire.cache[bug4Path]);
  const declaration = { prop: 'flex', value: '1' };
  vendorRequire('./bugs/bug4')(declaration);
  assert.equal(declaration.value, '1 1 0%');
  console.log('native-vendor-loaded');
} finally {
  hooks.deregister();
}`,
        repoDirectory,
      ],
      {
        cwd: repoDirectory,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stdout + result.stderr, { cause: result.error });
    }
    expect(result.stdout).toContain('native-vendor-loaded');
  });

  it.each([
    ['commonjs', 'none'],
    ['module', 'none'],
    ['module', 'require'],
    ['commonjs', 'import'],
  ] as const)(
    'registers real %s paths with added %s condition without changing native failures',
    (format, additionalCondition) => {
      const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-hooks-'));
      try {
        const isCommonJS = format === 'commonjs';
        const extension = isCommonJS ? 'cjs' : 'mjs';
        fs.writeFileSync(
          path.join(appDir, 'package.json'),
          JSON.stringify({
            name: 'loader-fixture',
            exports: {
              './condition': {
                development: './development.cjs',
                default: './default.cjs',
              },
            },
          }),
        );
        fs.writeFileSync(
          path.join(appDir, 'development.cjs'),
          'module.exports = "development";',
        );
        fs.writeFileSync(
          path.join(appDir, 'default.cjs'),
          'module.exports = "default";',
        );
        for (const name of ['alias #?', 'relative #?']) {
          fs.writeFileSync(
            path.join(appDir, `${name}.${extension}`),
            isCommonJS
              ? `module.exports = ${JSON.stringify(name)};`
              : `export default ${JSON.stringify(name)};`,
          );
        }
        fs.writeFileSync(
          path.join(appDir, `entry.${extension}`),
          isCommonJS
            ? `const assert = require('node:assert/strict');
assert.equal(require('@fixture/alias #?'), 'alias #?');
assert.equal(require('./relative #?'), 'relative #?');
assert.equal(require('loader-fixture/condition'), 'development');
assert.throws(() => require('./missing #?'), { code: 'MODULE_NOT_FOUND' });
assert.throws(() => require('@fixture/missing'), { code: 'MODULE_NOT_FOUND' });
module.exports = 'authored-commonjs';`
            : `import assert from 'node:assert/strict';
import alias from '@fixture/alias #?';
import relative from './relative #?';
import condition from 'loader-fixture/condition';
assert.equal(alias, 'alias #?');
assert.equal(relative, 'relative #?');
assert.equal(condition, 'development');
await assert.rejects(import('./missing #?'), { code: 'ERR_MODULE_NOT_FOUND' });
await assert.rejects(import('@fixture/missing'), { code: 'ERR_MODULE_NOT_FOUND' });
export default 'authored-module';`,
        );
        const result = spawnSync(
          process.execPath,
          [
            '--conditions=development',
            ...(additionalCondition === 'none'
              ? []
              : [`--conditions=${additionalCondition}`]),
            '--input-type=module',
            '-e',
            `import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { registerPathsLoader } from ${JSON.stringify(registerUrl)};
const appDir = process.argv[1];
const hooks = await registerPathsLoader({ appDir, baseUrl: appDir, paths: { '@fixture/*': ['./*'] } });
try {
  const entry = path.join(appDir, ${JSON.stringify(`entry.${extension}`)});
  const value = ${isCommonJS ? "createRequire(path.join(appDir, 'package.json'))(entry)" : '(await import(pathToFileURL(entry).href)).default'};
  assert.equal(value, ${JSON.stringify(`authored-${format}`)});
  console.log('authored-native-paths-loaded');
} finally {
  hooks.deregister();
}`,
            appDir,
          ],
          {
            cwd: appDir,
            encoding: 'utf8',
            env: { ...process.env, NODE_PATH: '' },
          },
        );
        if (result.status !== 0) {
          throw new Error(result.stdout + result.stderr, {
            cause: result.error,
          });
        }
        expect(result.stdout).toContain('authored-native-paths-loaded');
      } finally {
        fs.rmSync(appDir, { recursive: true, force: true });
      }
    },
  );
});
