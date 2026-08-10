import { join, resolve } from 'path';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';

const fixtures = resolve(__dirname, '../');

test('rem default (disable)', async ({ page }) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/index.ts'),
    },
    runServer: true,
  });
  await page.goto(getHrefByEntryName('main', builder.port));

  const title = page.locator('#title');
  await expect(title).toHaveCSS('font-size', '20px');

  const description = page.locator('#description');
  await expect(description).toHaveCSS('font-size', '16px');

  builder.close();
});

test('rem enable', async ({ page }) => {
  // convert to rem
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      output: {
        convertToRem: true,
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const root = page.locator('html');
  await expect(root).toHaveCSS('font-size', '64px');

  // less convert pxToRem
  const title = page.locator('#title');
  await expect(title).toHaveCSS('font-size', '25.6px');

  // scss convert pxToRem
  const header = page.locator('#header');
  await expect(header).toHaveCSS('font-size', '25.6px');

  // css convert pxToRem
  const description = page.locator('#description');
  await expect(description).toHaveCSS('font-size', '20.48px');

  builder.close();
});

test('should execute the inline runtime without loading a runtime asset', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: { index: join(fixtures, 'src/index.ts') },
    builderConfig: {
      output: {
        convertToRem: {},
      },
    },
    runServer: true,
  });
  await page.goto(getHrefByEntryName('index', builder.port));

  await expect(page.locator('html')).toHaveCSS('font-size', '64px');
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some(entry => entry.name.includes('/convert-rem')),
    ),
  ).toBe(false);

  builder.close();
});

test('should load and execute the extracted runtime when inlineRuntime is false', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: { index: join(fixtures, 'src/index.ts') },
    builderConfig: {
      output: {
        convertToRem: {
          inlineRuntime: false,
        },
      },
    },
    runServer: true,
  });
  await page.goto(getHrefByEntryName('index', builder.port));

  await expect(page.locator('html')).toHaveCSS('font-size', '64px');
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some(entry => entry.name.includes('/convert-rem')),
    ),
  ).toBe(true);

  builder.close();
});
