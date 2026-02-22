import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from '@scripts/shared';
import tailwindPostcss from '@tailwindcss/postcss';

test('should allow to use `postcssOptions` function to apply different postcss config for different files and overrides modern.js default plugins', async () => {
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
  });

  const files = await builder.unwrapOutputJSON();
  const fooCssFile = Object.keys(files).find(
    file => file.includes('foo.') && file.endsWith('.css'),
  )!;

  expect(files[fooCssFile]).toContain('.font-bold');
  expect(files[fooCssFile]).toContain('.underline');

  const barCssFile = Object.keys(files).find(
    file => file.includes('bar.') && file.endsWith('.css'),
  )!;
  expect(files[barCssFile]).toContain('.text-3xl');
});

test('should allow to use `postcssOptions` function to apply different postcss config for different files and apply modern.js default plugins', async () => {
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
  });

  const files = await builder.unwrapOutputJSON();
  const fooCssFile = Object.keys(files).find(
    file => file.includes('foo.') && file.endsWith('.css'),
  )!;
  // apply tailwind config and autoprefixer correctly
  expect(files[fooCssFile]).toContain('.font-bold');
  expect(files[fooCssFile]).toContain('.underline');

  const barCssFile = Object.keys(files).find(
    file => file.includes('bar.') && file.endsWith('.css'),
  )!;
  expect(files[barCssFile]).toContain('.text-3xl');
});
