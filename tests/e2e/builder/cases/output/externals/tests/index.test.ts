import { join, resolve } from 'path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
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
    entry: { index: resolve(fixtures, './src/web-worker-react.js') },
    runServer: true,
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
  const workerFile = Object.keys(files).find(
    file => file.includes('/static/js/index.') && file.endsWith('.js'),
  )!;
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: value => parentPort.postMessage(value) };
import(${JSON.stringify(pathToFileURL(workerFile).href)}).catch(error => { throw error; });`,
    { eval: true },
  );
  const workerResult = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  expect(workerResult).toEqual({ canCreateElement: true });
  await worker.terminate();

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
              buffer: 'module-import node:buffer',
              crypto: 'module-import node:crypto',
              path: 'module-import node:path',
              util: 'module-import node:util',
              'node:async_hooks': 'module-import node:async_hooks',
              'node:buffer': 'module-import node:buffer',
              'node:crypto': 'module-import node:crypto',
              'node:path': 'module-import node:path',
              'node:util': 'module-import node:util',
            },
            externalsType: 'module-import',
          });
          chain.output
            .module(true)
            .library({ type: 'module' })
            .chunkFormat('module')
            .chunkLoading('import');
          chain.optimization.runtimeChunk(false);
        },
      },
    },
  });
  const files = await builder.unwrapOutputJSON();
  const moduleFile = Object.keys(files).find(file => file.endsWith('.js'))!;
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = globalThis;
  try {
    await import(`${pathToFileURL(moduleFile).href}?test=${Date.now()}`);
    expect((globalThis as any).window.__asyncHooksValue).toMatchObject({
      file: 'index.mjs',
      payload: 'externalized',
    });
    expect((globalThis as any).window.__asyncHooksValue.id).toEqual(
      expect.any(String),
    );
    expect((globalThis as any).window.__asyncHooksInspect).toEqual(
      expect.any(String),
    );
  } finally {
    (globalThis as any).window = previousWindow;
  }

  builder.clean();
});
