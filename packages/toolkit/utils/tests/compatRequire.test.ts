import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'path';
import {
  cleanRequireCache,
  compatibleRequire,
  dynamicImport,
  tryResolve,
} from '../src';

describe('compat require', () => {
  const fixturePath = path.resolve(__dirname, './fixtures/compat-require');

  test(`should support default property`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'esm.js'))).toEqual({
      name: 'esm',
    });
  });

  test(`should support commonjs module`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'cjs.js'))).toEqual({
      name: 'cjs',
    });
  });

  test(`should return null`, async () => {
    expect(await compatibleRequire(path.join(fixturePath, 'empty.js'))).toEqual(
      null,
    );
  });

  test('resolves ESM packages in directories containing URL-encoded characters', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-RUNNER~1 % # č-'),
    );
    const previousFormat = process.env.MODERN_LIB_FORMAT;
    try {
      const packageDirectory = path.join(directory, 'node_modules/example');
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({ type: 'module', exports: './index.mjs' }),
      );
      const modulePath = path.join(packageDirectory, 'index.mjs');
      fs.writeFileSync(modulePath, 'export default "resolved";');
      process.env.MODERN_LIB_FORMAT = 'esm';

      const resolved = tryResolve('example', directory);
      expect(resolved).toBe(fs.realpathSync(modulePath));
      expect((await dynamicImport(pathToFileURL(resolved).href)).default).toBe(
        'resolved',
      );
    } finally {
      if (previousFormat === undefined) {
        delete process.env.MODERN_LIB_FORMAT;
      } else {
        process.env.MODERN_LIB_FORMAT = previousFormat;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('should clean cache after fn', () => {
    const requirePath = require.resolve('./fixtures/compat-require/foo.js');
    const cachedModule = {
      id: requirePath,
      filename: requirePath,
      loaded: true,
      exports: { name: 'foo' },
      children: [],
      paths: [],
    } as unknown as NodeModule;

    require.cache[requirePath] = cachedModule;
    expect(require.cache[requirePath]).toBeDefined();

    cleanRequireCache([requirePath]);

    const shouldClean = process.env.MODERN_LIB_FORMAT !== 'esm';
    expect(Boolean(require.cache[requirePath])).toBe(!shouldClean);

    delete require.cache[requirePath];
  });
});
