import path from 'path';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';

test('output.charset default (ascii)', async ({ page }) => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    runServer: true,
  });

  await page.goto(getHrefByEntryName('index', builder.port));
  expect(await page.evaluate('window.a')).toBe('你好 world!');

  builder.close();
});

test('output.charset (utf8)', async ({ page }) => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    builderConfig: {
      output: {
        charset: 'utf8',
      },
    },
    runServer: true,
  });

  await page.goto(getHrefByEntryName('index', builder.port));
  expect(await page.evaluate('window.a')).toBe('你好 world!');

  builder.close();
});
