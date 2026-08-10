import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import path from 'path';

test('security.sri', async ({ page }) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    runServer: true,
    builderConfig: {
      security: {
        sri: true,
      },
    },
  });

  await page.goto(getHrefByEntryName('index', builder.port));

  const test = page.locator('#test');
  await expect(test).toHaveText('Hello Builder!');
  const protectedResources = page.locator('script[integrity], link[integrity]');
  expect(await protectedResources.count()).toBeGreaterThanOrEqual(2);
  expect(
    await protectedResources.evaluateAll(elements =>
      elements.every(element =>
        /^sha384-[A-Za-z0-9+/]+=*$/u.test(
          element.getAttribute('integrity') ?? '',
        ),
      ),
    ),
  ).toBe(true);

  builder.close();
});
