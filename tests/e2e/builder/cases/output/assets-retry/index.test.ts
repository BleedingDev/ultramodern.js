import path from 'path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';

const expectMissingImageWasRetried = async (page: Page) => {
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.id = 'missing-asset';
    image.src = '/definitely-missing-asset.png';
    document.body.appendChild(image);
  });

  await expect(page.locator('#missing-asset')).toHaveAttribute(
    'data-rb-retry-times',
    '3',
  );
};

test('should execute the inline assets retry runtime by default', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    builderConfig: {
      output: {
        assetsRetry: {},
      },
      tools: {
        htmlPlugin: (config: any) => {
          // minify option should works
          config.minify ??= {};
          // minifyJS will minify function name
          if (typeof config.minify === 'object') {
            config.minify.minifyJS = false;
            config.minify.minifyCSS = false;
          }
        },
      },
    },
    runServer: true,
  });
  await page.goto(getHrefByEntryName('index', builder.port));
  await expectMissingImageWasRetried(page);

  const files = await builder.unwrapOutputJSON();
  const retryFile = Object.keys(files).find(
    file => path.basename(file).startsWith('assets-retry.'),
  );

  expect(retryFile).toBeUndefined();
  builder.close();
});

test('should load and execute the extracted assets retry runtime', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    builderConfig: {
      output: {
        assetsRetry: {
          inlineScript: false,
        },
      },
    },
    runServer: true,
  });
  await page.goto(getHrefByEntryName('index', builder.port));
  await expectMissingImageWasRetried(page);

  const files = await builder.unwrapOutputJSON();

  const retryFile = Object.keys(files).find(
    file => path.basename(file).startsWith('assets-retry.'),
  );

  expect(retryFile).toBeTruthy();
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some(entry => entry.name.includes('/assets-retry')),
    ),
  ).toBe(true);
  builder.close();
});
