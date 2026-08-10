import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';

test('should load postcss.config.ts correctly', async ({ page }) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.ts') },
    builderConfig: {
      html: {
        template: './src/index.html',
      },
    },
    runServer: true,
  });

  await page.goto(getHrefByEntryName('index', builder.port));
  await expect(page.locator('h1')).toHaveCSS('font-size', '30px');
  await expect(page.locator('h1')).toHaveCSS('font-weight', '700');
  builder.close();
});
