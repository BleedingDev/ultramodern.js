import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';

const owningModule = path.resolve(__dirname, '../../package.json');
const bootstrapSource = pathToFileURL(
  path.resolve(
    __dirname,
    '../../src/native-composition/config-evaluator/native-bootstrap.ts',
  ),
).href;

function isolated(
  run: (root: string, execute: (body: string) => string) => void,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-native-bootstrap-',
      ),
    ),
  );
  try {
    const execute = (body: string) =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import assert from 'node:assert/strict';
      import {createRequire, registerHooks} from 'node:module';
      const {initializeOwningConfigNativeBinding} = await import(${JSON.stringify(bootstrapSource)});
      const owningModule = ${JSON.stringify(owningModule)};
      for (const key of ['RSPACK_BINDING','NAPI_RS_NATIVE_LIBRARY_PATH','NAPI_RS_FORCE_WASI']) delete process.env[key];
      ${body}
    `,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
        },
      );
    run(root, execute);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('fixed owning native configuration bootstrap', () => {
  it('initializes the actual declared binding without importing framework filesystem helpers', () =>
    isolated((_root, execute) => {
      expect(
        JSON.parse(
          execute(`
      const req = createRequire(owningModule);
      const rsbuild = createRequire(req.resolve('@rsbuild/core/package.json'));
      const rspack = createRequire(rsbuild.resolve('@rspack/core/package.json'));
      const binding = rspack.resolve('@rspack/binding');
      const rsbuildEntry = req.resolve('@rsbuild/core');
      const rspackEntry = rsbuild.resolve('@rspack/core');
      const resolutions = [];
      const loads = [];
      const hooks = registerHooks({resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context); resolutions.push(result.url); return result;
      }, load(url, context, nextLoad) {
        loads.push(url); return nextLoad(url, context);
      }});
      const bindingOwner = initializeOwningConfigNativeBinding();
      hooks.deregister();
      assert(req.cache[binding]);
      assert(!loads.some(url => url.endsWith('/dist/index.js') && (url.includes('@rsbuild') || url.includes('@rspack/core'))));
      assert(!req.cache[rsbuildEntry]);
      assert(!req.cache[rspackEntry]);
      const nativeUrls = resolutions.filter(url => url.endsWith('.node'));
      assert(nativeUrls.length > 0, 'actual installed platform binding must be resolved');
      const {fileURLToPath} = await import('node:url');
      assert(nativeUrls.every(url => req.cache[fileURLToPath(url)]), 'actual installed platform binding must be initialized');
      assert.equal(rspack('@rspack/binding').EXPECTED_RSPACK_CORE_VERSION, rspack('@rspack/core/package.json').version);
      assert.equal(initializeOwningConfigNativeBinding(), bindingOwner);
      const native = true;
      console.log(JSON.stringify({native, frameworkHelpersLoaded: false}));
    `),
        ),
      ).toEqual({ native: true, frameworkHelpersLoaded: false });
    }));

  it.each([
    'RSPACK_BINDING',
    'NAPI_RS_NATIVE_LIBRARY_PATH',
    'NAPI_RS_FORCE_WASI',
  ])('rejects a genuine %s override attempt before foreign module execution', name =>
    isolated((root, execute) => {
      const marker = path.join(root, 'executed');
      const foreign = path.join(root, 'foreign.cjs');
      fs.writeFileSync(
        foreign,
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = {};`,
      );
      const output = execute(`
      process.env[${JSON.stringify(name)}] = ${JSON.stringify(foreign)};
      assert.throws(() => initializeOwningConfigNativeBinding(), /native binding override ${name}/);
      console.log('rejected');
    `);
      expect(output.trim()).toBe('rejected');
      expect(fs.existsSync(marker)).toBe(false);
    }));

  it('rejects WebContainer discovery before its external bootstrap fallback', () =>
    isolated((_root, execute) => {
      expect(
        execute(`
      Object.defineProperty(process.versions, 'webcontainer', {value: 'fixture'});
      assert.throws(() => initializeOwningConfigNativeBinding(), /WebContainer native binding discovery/);
      console.log('rejected');
    `).trim(),
      ).toBe('rejected');
    }));
});
