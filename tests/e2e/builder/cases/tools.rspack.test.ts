import { expect, test } from '@playwright/test';
import { join } from 'path';
import { build, getHrefByEntryName } from '../scripts/shared';

const fixtures = __dirname;

test('tools.rspack', async ({ page }) => {
  const uniqueDistRoot = `dist-tools-rspack-${process.pid}-${Date.now()}`;
  const builder = await build({
    cwd: join(fixtures, 'source/global-vars'),
    entry: {
      main: join(fixtures, 'source/global-vars/src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      output: {
        distPath: {
          root: uniqueDistRoot,
        },
      },
      source: {
        define: {
          ENABLE_TEST: JSON.stringify(true),
        },
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const testEl = page.locator('#test-el');
  await expect(testEl).toHaveText('aaaaa');

  builder.close();
});
