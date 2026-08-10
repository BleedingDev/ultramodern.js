import { type BundlerChain, RUNTIME_CHUNK_NAME } from '@modern-js/builder';
import { expect, type Page, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import path from 'path';

const expectRuntimeWasInlined = async (page: Page) => {
  await expect(
    page.locator(`script[src*="${RUNTIME_CHUNK_NAME}"]`),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      runtimeChunkName =>
        performance
          .getEntriesByType('resource')
          .some(entry => entry.name.includes(runtimeChunkName)),
      RUNTIME_CHUNK_NAME,
    ),
  ).toBe(false);
};

// use source-map for easy to test. By default, builder use hidden-source-map
const toolsConfig = {
  bundlerChain: (chain: BundlerChain) => {
    chain.devtool('source-map');
  },
  htmlPlugin: (config: any) => {
    // minify will remove sourcemap comment
    if (typeof config.minify === 'object') {
      config.minify.minifyJS = false;
      config.minify.minifyCSS = false;
    }
  },
};

test.describe('disableInlineRuntimeChunk', () => {
  let builder: Awaited<ReturnType<typeof build>>;
  let files: Record<string, string>;

  test.beforeAll(async () => {
    builder = await build({
      cwd: __dirname,
      entry: { index: path.resolve(__dirname, './src/index.js') },
      runServer: true,
      builderConfig: {
        tools: toolsConfig,
        output: {
          disableInlineRuntimeChunk: true,
        },
      },
    });

    files = await builder.unwrapOutputJSON(false);
  });

  test.afterAll(async () => {
    builder.close();
  });

  test('should emit builder runtime', async ({ page }) => {
    // test runtime
    await page.goto(getHrefByEntryName('index', builder.port));

    expect(await page.evaluate(`window.test`)).toBe('aaaa');

    // builder-runtime file in output
    expect(
      Object.keys(files).some(
        fileName =>
          fileName.includes(RUNTIME_CHUNK_NAME) && fileName.endsWith('.js'),
      ),
    ).toBe(true);
  });
});

test('runtime chunk is inlined by default', async ({ page }) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    runServer: true,
    builderConfig: {
      tools: toolsConfig,
    },
  });

  // test runtime
  await page.goto(getHrefByEntryName('index', builder.port));

  expect(await page.evaluate(`window.test`)).toBe('aaaa');
  await expectRuntimeWasInlined(page);

  const files = await builder.unwrapOutputJSON(false);

  // builder-runtime is inlined by default instead of emitted as an external JS asset.
  expect(
    Object.keys(files).some(
      fileName =>
        fileName.includes(RUNTIME_CHUNK_NAME) && fileName.endsWith('.js'),
    ),
  ).toBe(false);

  builder.close();
});

test('inline runtime chunk and remove source map when devtool is "hidden-source-map"', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.js') },
    runServer: true,
    builderConfig: {
      tools: {
        bundlerChain(chain) {
          chain.devtool('hidden-source-map');
        },
      },
    },
  });

  const files = await builder.unwrapOutputJSON(false);

  await page.goto(getHrefByEntryName('index', builder.port));
  expect(await page.evaluate(`window.test`)).toBe('aaaa');
  await expectRuntimeWasInlined(page);

  // builder runtime source map is not emitted when the runtime is inlined and
  // devtool is hidden-source-map.
  expect(
    Object.keys(files).some(
      fileName =>
        fileName.includes(RUNTIME_CHUNK_NAME) && fileName.endsWith('.js.map'),
    ),
  ).toBe(false);

  builder.close();
});

test('runtime chunk is inlined by default with multiple entries', async ({
  page,
}) => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
      another: path.resolve(__dirname, './src/another.js'),
    },
    runServer: true,
    builderConfig: {
      tools: toolsConfig,
    },
  });
  const files = await builder.unwrapOutputJSON(false);

  // builder-runtime is inlined by default instead of emitted as an external JS asset.
  expect(
    Object.keys(files).some(
      fileName =>
        fileName.includes(RUNTIME_CHUNK_NAME) && fileName.endsWith('.js'),
    ),
  ).toBe(false);

  await page.goto(getHrefByEntryName('index', builder.port));
  expect(await page.evaluate(`window.test`)).toBe('aaaa');
  await expectRuntimeWasInlined(page);

  await page.goto(getHrefByEntryName('another', builder.port));
  await expect.poll(() => page.evaluate(`window.answer`)).toBe('another foo');
  await expectRuntimeWasInlined(page);

  builder.close();
});

test('using RegExp to inline scripts', async () => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    builderConfig: {
      output: {
        inlineScripts: /\/index\.\w+\.js$/,
      },
      tools: toolsConfig,
    },
  });
  const files = await builder.unwrapOutputJSON(false);

  // no index.js in output
  expect(
    Object.keys(files).filter(
      fileName => fileName.endsWith('.js') && fileName.includes('/index.'),
    ).length,
  ).toEqual(0);

  // all source maps in output
  expect(
    Object.keys(files).filter(fileName => fileName.endsWith('.js.map')).length,
  ).toBeGreaterThanOrEqual(2);
});

test('inline scripts by filename and file size', async () => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    builderConfig: {
      output: {
        inlineScripts({ size, name }) {
          return name.includes('index') && size < 1000;
        },
      },
      tools: toolsConfig,
    },
  });
  const files = await builder.unwrapOutputJSON(false);

  // no index.js in output
  expect(
    Object.keys(files).filter(
      fileName => fileName.endsWith('.js') && fileName.includes('/index.'),
    ).length,
  ).toEqual(0);

  // all source maps in output
  expect(
    Object.keys(files).filter(fileName => fileName.endsWith('.js.map')).length,
  ).toBeGreaterThanOrEqual(2);
});

test('using RegExp to inline styles', async () => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    builderConfig: {
      output: {
        inlineStyles: /\/index\.\w+\.css$/,
      },
      tools: toolsConfig,
    },
  });
  const files = await builder.unwrapOutputJSON(false);

  // no index.css in output
  expect(
    Object.keys(files).filter(
      fileName => fileName.endsWith('.css') && fileName.includes('/index.'),
    ).length,
  ).toEqual(0);
});

test('inline styles by filename and file size', async () => {
  const builder = await build({
    cwd: __dirname,
    entry: {
      index: path.resolve(__dirname, './src/index.js'),
    },
    builderConfig: {
      output: {
        inlineStyles({ size, name }) {
          return name.includes('index') && size < 1000;
        },
      },
      tools: toolsConfig,
    },
  });
  const files = await builder.unwrapOutputJSON(false);

  // no index.css in output
  expect(
    Object.keys(files).filter(
      fileName => fileName.endsWith('.css') && fileName.includes('/index.'),
    ).length,
  ).toEqual(0);
});
