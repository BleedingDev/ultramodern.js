import fs from 'node:fs';
import path from 'node:path';
import { findSourceEntry, getUserAlias } from '../src';

describe('getUserAlias', () => {
  it('should filter invalid ts paths that are not array', () => {
    expect(
      getUserAlias({
        foo: ['a', 'b'],
        bar: 'c',
      }),
    ).toEqual({
      foo: ['a', 'b'],
    });
  });
});

describe('findSourceEntry', () => {
  const fixturePath = fs.mkdtempSync(path.join(__dirname, '.module-path-'));
  const nativeExtensions = ['.mts', '.cts', '.mjs', '.cjs'];

  afterAll(() => fs.rmSync(fixturePath, { recursive: true, force: true }));

  it.each(nativeExtensions)('resolves explicit/extensionless %s', extension => {
    const entry = path.join(fixturePath, `entry-${extension.slice(1)}`);
    const target = `${entry}${extension}`;
    fs.writeFileSync(target, 'export {};');
    expect(findSourceEntry(target)).toBe(target);
    expect(findSourceEntry(entry)).toBe(target);
  });
});
