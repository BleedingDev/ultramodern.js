import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import path from 'path';
import { cases, copyPkgToNodeModules, shareTest } from './helper';

test('should import with template config', async ({ page }) => {
  copyPkgToNodeModules();

  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    builderConfig: {
      source: {
        transformImport: [
          {
            libraryName: 'foo',
            customName: 'foo/lib/{{ member }}',
          },
        ],
      },
      splitChunks: false,
    },
    runServer: true,
  });
  const messages: string[] = [];
  page.on('console', message => messages.push(message.text()));
  await page.goto(getHrefByEntryName('index', builder.port));
  expect(messages).toContain('transformImport test succeed');
  builder.close();
});

cases.forEach(c => {
  const [name, entry, config] = c;
  shareTest(`${name}-rspack`, entry, config);
});
