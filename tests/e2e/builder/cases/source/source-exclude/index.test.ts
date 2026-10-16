import { expect, test } from '@playwright/test';
import { build, proxyConsole } from '@scripts/shared';
import path from 'path';

test('should not compile specified file when source.exclude', async () => {
  const { restore } = proxyConsole();
  await expect(
    build({
      cwd: __dirname,
      entry: { index: path.resolve(__dirname, './src/index.js') },
      builderConfig: {
        source: {
          exclude: [path.resolve(__dirname, './src/test.js')],
        },
        output: {
          overrideBrowserslist: ['chrome 40'],
        },
        security: {
          checkSyntax: true,
        },
      },
    }),
  ).rejects.toThrowError('incompatible syntax');

  restore();
});
