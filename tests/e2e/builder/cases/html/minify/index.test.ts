import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import { join } from 'path';

const fixtures = __dirname;

test('should minify template js & css', async ({ page }) => {
  const consoleMessages: Array<{ text: string; type: string }> = [];
  page.on('console', message => {
    consoleMessages.push({ text: message.text(), type: message.type() });
  });

  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/index.ts'),
    },
    runServer: true,
    builderConfig: {
      html: {
        template: './static/index.html',
      },
      performance: {
        removeConsole: ['log', 'warn'],
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const test = page.locator('#test');

  await expect(test).toHaveCSS('text-align', 'center');
  await expect(test).toHaveCSS('font-size', '146px');
  await expect(test).toHaveText('Hello Builder!');
  await expect(page.evaluate(`window.a`)).resolves.toBe(1);
  await expect(page.evaluate(`window.b`)).resolves.toBe(2);
  expect(consoleMessages).toContainEqual({ text: '111111', type: 'info' });
  expect(consoleMessages).not.toContainEqual({ text: '111111', type: 'log' });
  expect(consoleMessages).not.toContainEqual({
    text: '111111',
    type: 'warning',
  });

  builder.close();
});
