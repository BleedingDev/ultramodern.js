import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { build } from '@scripts/shared';
import { join } from 'path';

const fixtures = __dirname;

const getResourceLinks = async (
  page: Page,
  files: Record<string, string>,
  rel: 'prefetch' | 'preload',
) => {
  const html = Object.entries(files).find(([name]) =>
    name.endsWith('index.html'),
  )?.[1];
  expect(html).toBeDefined();
  await page.setContent(html!);
  return page.locator(`link[rel="${rel}"]`).evaluateAll(links =>
    links.map(link => ({
      as: link.getAttribute('as'),
      crossOrigin: link.getAttribute('crossorigin'),
      href: link.getAttribute('href'),
    })),
  );
};

test('should generate prefetch link when prefetch is defined', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      output: {
        assetPrefix: 'https://www.foo.com',
      },
      performance: {
        prefetch: true,
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/js/async/'),
  )!;
  const links = await getResourceLinks(page, files, 'prefetch');

  expect(links).toHaveLength(3);
  expect(links).toContainEqual({
    as: null,
    crossOrigin: null,
    href: `https://www.foo.com${asyncFileName.slice(
      asyncFileName.indexOf('/static/js/async/'),
    )}`,
  });
});

test('should generate prefetch link correctly when assetPrefix do not have a protocol', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      output: {
        assetPrefix: '//www.foo.com',
      },
      performance: {
        prefetch: true,
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/js/async/'),
  )!;
  const links = await getResourceLinks(page, files, 'prefetch');

  expect(links).toContainEqual({
    as: null,
    crossOrigin: null,
    href: `//www.foo.com${asyncFileName.slice(
      asyncFileName.indexOf('/static/js/async/'),
    )}`,
  });
});

test('should generate prefetch link with filter', async ({ page }) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      performance: {
        prefetch: {
          include: [/.*\.png$/],
        },
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/image/test'),
  )!;
  const links = await getResourceLinks(page, files, 'prefetch');

  expect(links).toEqual([
    {
      as: null,
      crossOrigin: null,
      href: asyncFileName.slice(asyncFileName.indexOf('/static/image/test')),
    },
  ]);
});

test('should generate preload link when preload is defined', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      performance: {
        preload: true,
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/js/async/'),
  )!;
  const links = await getResourceLinks(page, files, 'preload');

  expect(links).toHaveLength(3);
  expect(links).toContainEqual({
    as: 'script',
    crossOrigin: null,
    href: asyncFileName.slice(asyncFileName.indexOf('/static/js/async/')),
  });
});

test('should generate preload link with crossOrigin', async ({ page }) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      html: {
        crossorigin: 'anonymous',
      },
      output: {
        assetPrefix: '//aaa.com',
      },
      performance: {
        preload: true,
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/js/async/'),
  )!;
  const links = await getResourceLinks(page, files, 'preload');

  expect(links).toHaveLength(3);
  expect(links).toContainEqual({
    as: 'script',
    crossOrigin: '',
    href: `//aaa.com${asyncFileName.slice(
      asyncFileName.indexOf('/static/js/async/'),
    )}`,
  });
});

test('should generate preload link without crossOrigin when same origin', async ({
  page,
}) => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/page1/index.ts'),
    },
    builderConfig: {
      html: {
        crossorigin: 'anonymous',
      },
      performance: {
        preload: true,
      },
    },
  });

  const files = await builder.unwrapOutputJSON();

  const asyncFileName = Object.keys(files).find(file =>
    file.includes('/static/js/async/'),
  )!;
  const links = await getResourceLinks(page, files, 'preload');

  expect(links).toHaveLength(3);
  expect(links).toContainEqual({
    as: 'script',
    crossOrigin: null,
    href: asyncFileName.slice(asyncFileName.indexOf('/static/js/async/')),
  });
});
