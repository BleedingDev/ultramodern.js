import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

describe('zod stays an optional peer', () => {
  test('does not impose unused compiler tool dependencies', async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    );
    for (const dependency of ['ts-node', 'tsconfig-paths']) {
      expect(Object.hasOwn(manifest.peerDependencies, dependency)).toBe(false);
      expect(Object.hasOwn(manifest.devDependencies, dependency)).toBe(false);
    }
    expect(typeof manifest.peerDependencies.zod).toBe('string');
    expect(manifest.peerDependenciesMeta.zod.optional).toBe(true);
  });

  test.each([
    'src/index.ts',
    'dist/cjs/index.js',
    'dist/esm-node/index.mjs',
  ])('%s bundles without eager optional or unused compiler dependencies', async entry => {
    await expect(
      build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '..', entry)],
        format: 'esm',
        packages: 'external',
        platform: 'node',
        plugins: [
          {
            name: 'reject-eager-optional-or-unused-compiler-dependency',
            setup(buildApi) {
              buildApi.onResolve(
                { filter: /^(?:zod|ts-node|tsconfig-paths)(?:\/|$)/ },
                args => {
                  throw new Error(`${args.path} entered the eager graph`);
                },
              );
            },
          },
        ],
        write: false,
      }),
    ).resolves.toBeDefined();
  });
});
