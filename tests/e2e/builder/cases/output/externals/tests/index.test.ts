import { join, resolve } from 'path';
import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';

const fixtures = resolve(__dirname, '../');

test('externals', async ({ page }) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/index.js'),
    },
    runServer: true,
    builderConfig: {
      output: {
        externals: {
          './aaa': 'aa',
        },
      },
      source: {
        preEntry: './src/ex.js',
      },
    },
  });

  await page.goto(getHrefByEntryName('main', builder.port));

  const test = page.locator('#test');
  await expect(test).toHaveText('Hello Builder!');

  const testExternal = page.locator('#test-external');
  await expect(testExternal).toHaveText('1');

  const externalVar = await page.evaluate(`window.aa`);

  expect(externalVar).toBeDefined();

  builder.clean();
  builder.close();
});

test('should not external dependencies when target is web worker', async () => {
  const builder = await build({
    cwd: fixtures,
    entry: { index: resolve(fixtures, './src/index.js') },
    builderConfig: {
      output: {
        target: 'web-worker',
        externals: {
          react: 'MyReact',
        },
      },
    },
  });
  const files = await builder.unwrapOutputJSON();

  const content = files[Object.keys(files).find(file => file.endsWith('.js'))!];
  expect(content.includes('MyReact')).toBeFalsy();

  builder.clean();
});

test('externalizes node:async_hooks as a module worker import', async () => {
  const builder = await build({
    cwd: fixtures,
    entry: { index: resolve(fixtures, './src/node-async-hooks.js') },
    builderConfig: {
      tools: {
        bundlerChain: (chain: any) => {
          chain.merge({
            experiments: {
              outputModule: true,
            },
            externals: {
              async_hooks: 'module-import node:async_hooks',
              'node:async_hooks': 'module-import node:async_hooks',
            },
            externalsType: 'module-import',
          });
          chain.output
            .module(true)
            .library({ type: 'module' })
            .chunkFormat('module')
            .chunkLoading('import');
        },
      },
    },
  });
  const files = await builder.unwrapOutputJSON();

  const content = files[Object.keys(files).find(file => file.endsWith('.js'))!];
  expect(content).toContain('node:async_hooks');
  expect(content).toMatch(/from\s*["']node:async_hooks["']/);
  expect(content).not.toContain('from "async_hooks"');
  expect(content).not.toContain('Reading from "node:async_hooks"');

  builder.clean();
});
