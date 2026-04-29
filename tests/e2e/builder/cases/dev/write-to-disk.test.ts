import { expect, test } from '@playwright/test';
import { dev, getHrefByEntryName, getRandomPort } from '@scripts/shared';
import { join } from 'path';

const fixtures = __dirname;

test('writeToDisk default', async ({ page }) => {
  const port = await getRandomPort();
  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    builder = await dev({
      cwd: join(fixtures, 'basic'),
      entry: {
        main: join(fixtures, 'basic', 'src/index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          client: {
            host: '',
            port: '',
          },
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));

    const locator = page.locator('#test');
    await expect(locator).toHaveText('Hello Builder!');
  } finally {
    await builder?.server.close();
  }
});

test('writeToDisk false', async ({ page }) => {
  const port = await getRandomPort();
  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    builder = await dev({
      cwd: join(fixtures, 'basic'),
      entry: {
        main: join(fixtures, 'basic', 'src/index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          writeToDisk: false,
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));

    const locator = page.locator('#test');
    await expect(locator).toHaveText('Hello Builder!');
  } finally {
    await builder?.server.close();
  }
});

test('writeToDisk true', async ({ page }) => {
  const port = await getRandomPort();
  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    builder = await dev({
      cwd: join(fixtures, 'basic'),
      entry: {
        main: join(fixtures, 'basic', 'src/index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          writeToDisk: true,
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));

    const test = page.locator('#test');
    await expect(test).toHaveText('Hello Builder!');
  } finally {
    await builder?.server.close();
  }
});
