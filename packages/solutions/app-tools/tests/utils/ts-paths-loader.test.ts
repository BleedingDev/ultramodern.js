import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('ts-paths-loader', () => {
  it('should ignore non-file parent urls', async () => {
    const loader = await import('../../src/esm/ts-paths-loader.mjs');

    await loader.initialize({
      appDir: '/project',
      baseUrl: '/project',
      paths: {
        '@/*': ['./src/*'],
      },
    });

    const defaultResolve = rstest.fn(value => ({ url: value }));
    const context = { parentURL: 'data:' };

    const result = loader.resolve('./postcss.config', context, defaultResolve);

    expect(defaultResolve).toBeCalledWith(
      './postcss.config',
      context,
      defaultResolve,
    );
    expect(result).toEqual({ url: './postcss.config' });
  });

  it.each(['require', 'import'] as const)(
    'preserves the native %s resolver context and result for authored paths',
    async condition => {
      const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-paths-'));
      try {
        const target = path.join(appDir, 'target #?.cjs');
        fs.writeFileSync(target, 'module.exports = "authored";');
        const loader = await import('../../src/esm/ts-paths-loader.mjs');
        await loader.initialize({
          appDir,
          baseUrl: appDir,
          paths: { '@fixture/*': ['./*'] },
        });
        const context = {
          conditions:
            condition === 'require'
              ? ['require', 'node', 'development', 'import']
              : ['node', 'import', 'development', 'require'],
          parentURL: pathToFileURL(path.join(appDir, 'entry.cjs')).href,
        };
        const nativeResult = { url: 'native-result', format: 'commonjs' };
        const nextResolve = rstest.fn(() => nativeResult);
        for (const specifier of ['./target #?', '@fixture/target #?']) {
          expect(loader.resolve(specifier, context, nextResolve)).toBe(
            nativeResult,
          );
          expect(nextResolve).toHaveBeenLastCalledWith(
            condition === 'require' ? target : pathToFileURL(target).href,
            context,
            nextResolve,
          );
        }
      } finally {
        fs.rmSync(appDir, { recursive: true, force: true });
      }
    },
  );
});
