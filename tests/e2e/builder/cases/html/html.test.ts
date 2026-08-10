import { fs } from '@modern-js/utils';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import { join } from 'path';

const fixtures = __dirname;

test.describe('html configure multi', () => {
  let builder: Awaited<ReturnType<typeof build>>;

  test.beforeAll(async () => {
    builder = await build({
      cwd: join(fixtures, 'mount-id'),
      entry: {
        main: join(join(fixtures, 'mount-id'), 'src/index.ts'),
      },
      runServer: true,
      builderConfig: {
        html: {
          mountId: 'app',
        },
      },
    });
  });

  test.afterAll(() => {
    builder.close();
  });

  test('title default', async ({ page }) => {
    await page.goto(getHrefByEntryName('main', builder.port));

    await expect(page.evaluate(`document.title`)).resolves.toBe('');
  });
});

test.describe('html element set', () => {
  let builder: Awaited<ReturnType<typeof build>>;

  test.beforeAll(async () => {
    builder = await build({
      cwd: join(fixtures, 'template'),
      entry: {
        main: join(join(fixtures, 'template'), 'src/index.ts'),
        foo: join(fixtures, 'template/src/index.ts'),
      },
      runServer: true,
      builderConfig: {
        html: {
          meta: {
            description: 'a description of the page',
          },
          inject: 'body',
          favicon: './src/assets/icon.png',
        },
      },
    });
  });

  test.afterAll(() => {
    builder.close();
  });

  test('custom inject', async ({ page }) => {
    await page.goto(getHrefByEntryName('main', builder.port));
    expect(
      await page
        .locator('script')
        .evaluateAll(scripts =>
          scripts.every(script => script.parentElement?.tagName === 'BODY'),
        ),
    ).toBe(true);
  });

  test('custom meta', async ({ page }) => {
    await page.goto(getHrefByEntryName('main', builder.port));
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveCount(1);
    await expect(description).toHaveAttribute(
      'content',
      'a description of the page',
    );
  });
});

test('custom title', async ({ page }) => {
  const builder = await build({
    cwd: join(fixtures, 'template'),
    entry: {
      main: join(join(fixtures, 'template'), 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      html: {
        title: 'custom title',
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  await expect(page.evaluate(`document.title`)).resolves.toBe('custom title');

  builder.close();
});

test('outputStructrue flat', async ({ page }) => {
  const builder = await build({
    cwd: join(fixtures, 'template'),
    entry: {
      main: join(join(fixtures, 'template'), 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      html: {
        outputStructure: 'flat',
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const pagePath = join(builder.distPath, 'html/main.html');

  expect(fs.existsSync(pagePath)).toBeTruthy();

  builder.close();
});

test('outputStructrue nested', async ({ page }) => {
  const builder = await build({
    cwd: join(fixtures, 'template'),
    entry: {
      main: join(join(fixtures, 'template'), 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      html: {
        outputStructure: 'nested',
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const pagePath = join(builder.distPath, 'html/main/index.html');

  expect(fs.existsSync(pagePath)).toBeTruthy();

  builder.close();
});

test('tools.htmlPlugin', async ({ page }) => {
  const builder = await build({
    cwd: join(fixtures, 'template'),
    entry: {
      main: join(join(fixtures, 'template'), 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      tools: {
        htmlPlugin(config, { entryName }) {
          if (entryName === 'main') {
            config.scriptLoading = 'module';
          }
        },
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  expect(
    await page
      .locator('script')
      .evaluateAll(scripts =>
        scripts.every(script => script.type === 'module'),
      ),
  ).toBe(true);

  builder.close();
});
