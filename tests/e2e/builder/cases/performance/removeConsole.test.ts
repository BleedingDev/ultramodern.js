import { expect, test } from '@playwright/test';
import { build, getHrefByEntryName } from '@scripts/shared';
import { join } from 'path';

const cwd = join(__dirname, 'removeConsole');

const expectConsoleType = async (
  builder: Awaited<ReturnType<typeof build>>,
  page: import('@playwright/test').Page,
  consoleType: Record<string, boolean>,
) => {
  const messages: string[] = [];
  page.on('console', message => messages.push(message.text()));
  await page.goto(getHrefByEntryName('main', builder.port));

  Object.entries(consoleType).forEach(([key, value]) => {
    expect(messages.includes(`test-console-${key}`)).toEqual(value);
  });
};

test('should remove specified console correctly', async ({ page }) => {
  const builder = await build({
    cwd,
    entry: {
      main: join(cwd, 'src/index.js'),
    },
    builderConfig: {
      output: {
        distPath: {
          root: 'dist-1',
        },
      },
      performance: {
        removeConsole: ['log', 'warn'],
      },
    },
    runServer: true,
  });

  await expectConsoleType(builder, page, {
    log: false,
    warn: false,
    debug: true,
    error: true,
  });
  builder.close();
  await builder.clean();
});

test('should remove all console correctly', async ({ page }) => {
  const builder = await build({
    cwd,
    entry: {
      main: join(cwd, 'src/index.js'),
    },
    builderConfig: {
      output: {
        distPath: {
          root: 'dist-2',
        },
      },
      performance: {
        removeConsole: true,
      },
    },
    runServer: true,
  });

  await expectConsoleType(builder, page, {
    log: false,
    warn: false,
    debug: false,
    error: false,
  });
  builder.close();
  await builder.clean();
});
