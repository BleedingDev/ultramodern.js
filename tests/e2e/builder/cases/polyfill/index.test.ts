import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import path from 'path';

test('should add polyfill when set polyfill entry (default)', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    builderConfig: {
      output: {
        polyfill: 'entry',
        overrideBrowserslist: ['> 0.01%', 'not dead', 'not op_mini all'],
      },
    },
    runServer: true,
  });

  await page.addInitScript(() => {
    delete (Array.prototype as { flat?: unknown }).flat;
  });
  await page.goto(getHrefByEntryName('index', builder.port));

  expect(await page.evaluate('window.a')).toEqual([1, 2, 3, 4, 5, 6, [7, 8]]);

  builder.close();
});
