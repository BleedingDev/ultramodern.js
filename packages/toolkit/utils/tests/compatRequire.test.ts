import path from 'path';
import { cleanRequireCache, compatibleRequire } from '../src';

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
