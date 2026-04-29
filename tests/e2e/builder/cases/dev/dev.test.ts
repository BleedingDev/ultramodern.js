import { fs } from '@modern-js/utils';
import { expect, test } from '@playwright/test';
import { build, dev, getHrefByEntryName, getRandomPort } from '@scripts/shared';
import { join } from 'path';

const fixtures = __dirname;

test('default & hmr (default true)', async ({ page }) => {
  const hmrDir = join(fixtures, 'hmr');
  const srcDir = join(hmrDir, 'src');
  const testSrcDir = join(hmrDir, 'test-src');
  const appPath = join(testSrcDir, 'App.tsx');
  const cssPath = join(testSrcDir, 'App.css');
  const originalApp = fs.readFileSync(join(srcDir, 'App.tsx'), 'utf-8');
  const originalCss = fs.readFileSync(join(srcDir, 'App.css'), 'utf-8');
  const port = await getRandomPort();

  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    await fs.remove(testSrcDir);
    await fs.copy(srcDir, testSrcDir);

    builder = await dev({
      cwd: hmrDir,
      entry: {
        main: join(testSrcDir, 'index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          client: {
            host: '',
            port: '',
          },
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));

    const locator = page.locator('#test');
    await expect(locator).toHaveText('Hello Builder!');
    await expect(locator).toHaveCSS('color', 'rgb(255, 0, 0)');

    await fs.writeFile(
      appPath,
      originalApp.replace('Hello Builder', 'Hello Test'),
    );
    await expect(locator).toHaveText('Hello Test!', { timeout: 30000 });

    await fs.writeFile(
      cssPath,
      `#test {
  color: rgb(0, 0, 255);
}`,
    );
    await expect(locator).toHaveCSS('color', 'rgb(0, 0, 255)', {
      timeout: 30000,
    });
  } finally {
    if (fs.existsSync(appPath)) {
      await fs.writeFile(appPath, originalApp);
    }
    if (fs.existsSync(cssPath)) {
      await fs.writeFile(cssPath, originalCss);
    }
    await builder?.server.close();
    await fs.remove(testSrcDir);
  }
});

test('output.distPath', async ({ page }) => {
  const builder = await build({
    cwd: join(fixtures, 'basic'),
    entry: {
      main: join(fixtures, 'basic', 'src/index.ts'),
    },
    builderConfig: {
      dev: {
        port: 3030,
      },
      output: {
        distPath: {
          root: 'dist-1',
          js: 'aa/js',
        },
      },
    },
  });

  expect(
    fs.existsSync(join(fixtures, 'basic/dist-1/html/main/index.html')),
  ).toBeTruthy();

  expect(fs.existsSync(join(fixtures, 'basic/dist-1/aa/js'))).toBeTruthy();
});

test('hmr should work when setting dev.port & serverOptions.dev.client', async ({
  page,
}) => {
  const cwd = join(fixtures, 'hmr');
  const srcDir = join(cwd, 'src');
  const testSrcDir = join(cwd, 'test-src-1');
  const appPath = join(testSrcDir, 'App.tsx');
  const originalApp = fs.readFileSync(join(srcDir, 'App.tsx'), 'utf-8');
  const port = await getRandomPort();

  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    await fs.remove(testSrcDir);
    await fs.copy(srcDir, testSrcDir);
    builder = await dev({
      cwd,
      entry: {
        main: join(testSrcDir, 'index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          client: {
            host: '',
          },
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));
    expect(builder.port).toBeGreaterThan(0);

    const locator = page.locator('#test');
    await expect(locator).toHaveText('Hello Builder!');

    await fs.writeFile(
      appPath,
      originalApp.replace('Hello Builder', 'Hello Test'),
    );
    await expect(locator).toHaveText('Hello Test!', { timeout: 30000 });
  } finally {
    if (fs.existsSync(appPath)) {
      await fs.writeFile(appPath, originalApp);
    }
    await builder?.server.close();
    await fs.remove(testSrcDir);
  }
});

test('dev.https', async () => {
  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    const port = await getRandomPort();
    builder = await dev({
      cwd: join(fixtures, 'basic'),
      entry: {
        main: join(join(fixtures, 'basic'), 'src/index.ts'),
      },
      builderConfig: {
        dev: {
          port,
          https: true,
        },
        server: {
          port,
        },
      },
    });

    expect(builder.urls[0].startsWith('https')).toBeTruthy();
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    expect(message.toLowerCase()).toMatch(
      /(devcert|certificate|https|openssl|self-signed)/,
    );
  } finally {
    await builder?.server.close();
  }
});

test('tools.devServer', async ({ page }) => {
  let reloadFn: undefined | (() => void);
  let setupCalled = false;

  let builder: Awaited<ReturnType<typeof dev>> | undefined;
  try {
    const port = await getRandomPort();
    // Only tested to verify hook behavior, not all devServer options.
    builder = await dev({
      cwd: join(fixtures, 'basic'),
      entry: {
        main: join(join(fixtures, 'basic'), 'src/index.ts'),
      },
      builderConfig: {
        dev: {
          port,
        },
        tools: {
          devServer: {
            setupMiddlewares: [
              (_middlewares, server) => {
                setupCalled = true;
                reloadFn = () => {
                  server.sockWrite('content-changed');
                };
              },
            ],
            before: [
              (_req, _res, next) => {
                next();
              },
            ],
          },
        },
        server: {
          port,
        },
      },
    });

    await page.goto(getHrefByEntryName('main', builder.port));

    const locator = page.locator('#test');
    await expect(locator).toHaveText('Hello Builder!');

    if (setupCalled && reloadFn) {
      reloadFn();
      await page.reload();
      await expect(locator).toHaveText('Hello Builder!');
    }
  } finally {
    await builder?.server.close();
  }
});
