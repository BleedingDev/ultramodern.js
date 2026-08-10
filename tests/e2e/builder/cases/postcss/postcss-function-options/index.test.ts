import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import tailwindPostcss from '@tailwindcss/postcss';

const expectEntryStyles = async (
  page: import('@playwright/test').Page,
  port: number,
) => {
  await page.goto(getHrefByEntryName('foo', port));
  await expect(page.locator('h1')).toHaveCSS('font-weight', '700');
  await expect(page.locator('h1')).toHaveCSS(
    'text-decoration-line',
    'underline',
  );

  await page.goto(getHrefByEntryName('bar', port));
  await expect(page.locator('h1')).toHaveCSS('font-size', '30px');
};

test('should allow to use `postcssOptions` function to apply different postcss config for different files and overrides modern.js default plugins', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      foo: './src/foo/index.ts',
      bar: './src/bar/index.ts',
    },
    builderConfig: {
      html: {
        template({ entryName }) {
          return `./src/${entryName}/index.html`;
        },
      },
      tools: {
        postcss: config => {
          config.postcssOptions = loaderContext => {
            const name = loaderContext.resourcePath.includes('foo')
              ? 'foo'
              : 'bar';
            return {
              plugins: [
                tailwindPostcss({
                  base: path.join(__dirname, `./src/${name}`),
                }),
              ],
            };
          };
        },
      },
    },
    runServer: true,
  });

  await expectEntryStyles(page, builder.port);
  builder.close();
});

test('should allow to use `postcssOptions` function to apply different postcss config for different files and apply modern.js default plugins', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      foo: './src/foo/index.ts',
      bar: './src/bar/index.ts',
    },
    builderConfig: {
      html: {
        template({ entryName }) {
          return `./src/${entryName}/index.html`;
        },
      },
      tools: {
        postcss: config => {
          const originalPostcssOptions = config.postcssOptions || {};
          config.postcssOptions = loaderContext => {
            const name = loaderContext.resourcePath.includes('foo')
              ? 'foo'
              : 'bar';
            return {
              plugins: [
                // apply modern.js default plugins
                ...(typeof originalPostcssOptions === 'object'
                  ? (originalPostcssOptions.plugins ?? [])
                  : []),
                tailwindPostcss({
                  base: path.join(__dirname, `./src/${name}`),
                }),
              ],
            };
          };
        },
      },
    },
    runServer: true,
  });

  await expectEntryStyles(page, builder.port);
  builder.close();
});
