import path from 'node:path';
import { build } from 'esbuild';

describe('zod stays an optional peer', () => {
  test.each([
    'src/index.ts',
    'src/security/operationContracts.ts',
  ])('%s bundles without an eager zod dependency', async entry => {
    await expect(
      build({
        bundle: true,
        entryPoints: [path.resolve(__dirname, '..', entry)],
        format: 'esm',
        packages: 'external',
        platform: 'node',
        plugins: [
          {
            name: 'reject-eager-zod',
            setup(buildApi) {
              buildApi.onResolve({ filter: /^zod$/ }, () => {
                throw new Error('optional zod peer entered the eager graph');
              });
            },
          },
        ],
        write: false,
      }),
    ).resolves.toBeDefined();
  });
});
