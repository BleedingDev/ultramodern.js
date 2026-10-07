import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../utils/modernTestUtils';

export type Renderer = 'react' | 'solid' | 'octane';

export type SpecName =
  | 'ssr-html'
  | 'ssr-css'
  | 'hydration'
  | 'lazy'
  | 'client-nav'
  | 'back-forward'
  | 'loader-data'
  | 'action'
  | 'not-found'
  | 'loader-not-found'
  | 'redirect'
  | 'error-route'
  | 'head'
  | 'deferred';

export interface RendererSpecOptions {
  renderer: Renderer;
  /** The fixture app. RENDERER_TARGET_DIR replaces it for packed-release runs. */
  appDir: string;
  /** HTML that marks the not-found UI; React renders the framework default. */
  notFoundMarker?: string;
  /** Specs this renderer cannot meet yet, with the reason. */
  skip?: Partial<Record<SpecName, string>>;
}

const workspaceBin = path.resolve(
  __dirname,
  '../../../packages/solutions/ultramodern-app-tools/bin/ultramodern.mjs',
);

const browserUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const id = (testId: string) => `[data-testid="${testId}"]`;

/**
 * One behavior contract for every renderer. Fixtures share the data-testid
 * names, loader cases and action intents, so each spec runs unchanged.
 */
export function defineRendererSpecs(options: RendererSpecOptions) {
  const { renderer } = options;
  const notFoundMarker =
    options.notFoundMarker ?? 'data-testid="native-not-found"';
  const appDir = process.env.RENDERER_TARGET_DIR ?? options.appDir;
  const modernBin = process.env.RENDERER_TARGET_BIN ?? workspaceBin;
  const spec = (name: SpecName, body: () => Promise<void>) => {
    const reason = options.skip?.[name];
    if (reason) test.skip(`${name} (${reason})`, body);
    else test(name, body);
  };

  describe(`renderer ${renderer}`, () => {
    let origin: string;
    let app: unknown;
    let browser: Browser;
    let page: Page;
    let pageErrors: string[];
    let documentRequests: string[];

    beforeAll(async () => {
      const build = await modernBuild(appDir, [], { modernBin });
      if (build.code !== 0)
        throw new Error(`build failed\n${build.stdout}\n${build.stderr}`);
      const port = await getPort();
      app = await modernServe(appDir, port, { modernBin });
      origin = `http://localhost:${port}`;
      browser = await puppeteer.launch(launchOptions as any);
    });

    afterAll(async () => {
      await browser?.close();
      if (app) await killApp(app);
    });

    beforeEach(async () => {
      pageErrors = [];
      documentRequests = [];
      page = await browser.newPage();
      page.on('pageerror', error => pageErrors.push(String(error)));
      page.on('console', message => {
        if (message.type() === 'error') pageErrors.push(message.text());
      });
      page.on('request', request => {
        if (request.resourceType() === 'document')
          documentRequests.push(request.url());
      });
      // Keep the first native-layout the document gets: the parser inserts
      // the server one before any bundle can render its own, so hydration
      // must leave that same node in place.
      await page.evaluateOnNewDocument(() => {
        const observer = new MutationObserver(records => {
          for (const record of records)
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              const layout = node.matches('[data-testid="native-layout"]')
                ? node
                : node.querySelector('[data-testid="native-layout"]');
              if (!layout) continue;
              (window as any).__ssrLayout = layout;
              observer.disconnect();
              return;
            }
        });
        observer.observe(document, { childList: true, subtree: true });
      });
    });

    afterEach(async () => {
      await page?.close();
    });

    const text = (testId: string) =>
      page.$eval(id(testId), element => element.textContent ?? '');

    const waitForText = (testId: string, expected: string) =>
      page.waitForFunction(
        (selector, value) =>
          document.querySelector(selector)?.textContent?.includes(value),
        { timeout: 15_000 },
        id(testId),
        expected,
      );

    const waitForStyle = (testId: string, property: string, value: string) =>
      page.waitForFunction(
        (selector, name, expected) => {
          const element = document.querySelector(selector);
          return (
            element !== null &&
            getComputedStyle(element).getPropertyValue(name) === expected
          );
        },
        { timeout: 15_000 },
        id(testId),
        property,
        value,
      );

    /** Clicking the counter only updates once the page is hydrated. */
    async function openHydrated(pathname: string) {
      const response = await page.goto(`${origin}${pathname}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector(id('native-increment'));
      await page.click(id('native-increment'));
      await waitForText('native-count', '1');
      return response;
    }

    async function clickAndWait(testId: string, target: string) {
      await page.click(id(testId));
      await page.waitForSelector(id(target), { timeout: 15_000 });
    }

    const fetchHtml = async (pathname: string) => {
      const response = await fetch(`${origin}${pathname}`, {
        redirect: 'manual',
        headers: { accept: 'text/html' },
      });
      return { response, html: await response.text() };
    };

    spec('ssr-html', async () => {
      const { response, html } = await fetchHtml('/');
      expect(response.status).toBe(200);
      expect(html).toContain('data-testid="native-layout"');
      expect(html).toContain(`data-renderer="${renderer}"`);
      // The loader value is also in the hydration data script, so match the
      // rendered element.
      expect(html).toMatch(
        /data-testid="native-loader-value"[^>]*>[^<]*Native loader value/,
      );
    });

    spec('hydration', async () => {
      await openHydrated('/');
      const adopted = await page.$eval(
        id('native-layout'),
        element => element === (window as any).__ssrLayout,
      );
      expect(adopted).toBe(true);
      await waitForStyle('native-layout', 'color', 'rgb(20, 40, 60)');
      expect(pageErrors).toEqual([]);
    });

    spec('ssr-css', async () => {
      // The layout stylesheet must be linked from the server document, so
      // the first paint is styled before any bundle runs.
      const { html } = await fetchHtml('/');
      const hrefs = [...html.matchAll(/<link\b[^>]*>/g)]
        .map(([tag]) => tag)
        .filter(tag => /\brel="stylesheet"/.test(tag))
        .map(tag => /\bhref="([^"]+)"/.exec(tag)![1]);
      const css = await Promise.all(
        hrefs.map(href => fetch(new URL(href, origin)).then(r => r.text())),
      );
      expect(css.join('\n')).toMatch(/native-layout/);
    });

    spec('lazy', async () => {
      await openHydrated('/');
      await page.waitForSelector(id('native-lazy'), { timeout: 15_000 });
      await waitForStyle('native-lazy', 'border-inline-start-width', '2px');
      expect(pageErrors).toEqual([]);
    });

    spec('client-nav', async () => {
      await openHydrated('/');
      await page.evaluate(() => {
        (window as any).__sameWindow = true;
      });
      const before = documentRequests.length;
      await clickAndWait('nav-about', 'native-about');
      expect(new URL(page.url()).pathname).toBe('/about');
      expect(documentRequests.length).toBe(before);
      expect(await page.evaluate(() => (window as any).__sameWindow)).toBe(
        true,
      );
      expect(pageErrors).toEqual([]);
    });

    spec('back-forward', async () => {
      await openHydrated('/');
      await clickAndWait('nav-about', 'native-about');
      const before = documentRequests.length;
      await page.goBack();
      await page.waitForSelector(id('native-route'));
      await page.goForward();
      await page.waitForSelector(id('native-about'));
      expect(documentRequests.length).toBe(before);
    });

    spec('loader-data', async () => {
      const { html } = await fetchHtml('/items/1');
      expect(html).toMatch(/data-testid="native-item-value"[^>]*>[^<]*Item 1/);
      await openHydrated('/');
      await clickAndWait('nav-item', 'native-item');
      await waitForText('native-item-value', 'Item 1');
      expect(new URL(page.url()).pathname).toBe('/items/1');
    });

    spec('action', async () => {
      await openHydrated('/');
      await page.type('input[name="name"]', 'Ada');
      await page.click(id('native-submit'));
      await waitForText('native-action-value', 'Ada');

      await page.$eval('input[name="name"]', input => {
        (input as HTMLInputElement).value = '';
      });
      // The 422 validation outcome reaches the page; each fixture shows its
      // status through the renderer's own action API.
      await page.click(id('native-submit'));
      await page.waitForFunction(
        selector =>
          [...document.querySelectorAll(selector)].some(element =>
            element.textContent?.includes('422'),
          ),
        { timeout: 15_000 },
        `${id('native-action-value')}, ${id('native-action-error')}`,
      );

      await page.type('input[name="name"]', 'Grace');
      await clickAndWait('native-submit-redirect', 'native-about');
      expect(new URL(page.url()).pathname).toBe('/about');
      const cookies = await browser.cookies();
      expect(cookies.some(cookie => cookie.name === 'renderer-saved')).toBe(
        true,
      );
    });

    spec('not-found', async () => {
      const { response, html } = await fetchHtml('/no-such-route');
      expect(response.status).toBe(404);
      expect(html).toContain(notFoundMarker);
    });

    spec('loader-not-found', async () => {
      const { response, html } = await fetchHtml('/?case=not-found');
      expect(response.status).toBe(404);
      expect(html).toContain(notFoundMarker);
    });

    spec('redirect', async () => {
      const { response } = await fetchHtml('/?case=redirect');
      expect(response.status).toBeGreaterThanOrEqual(300);
      expect(response.status).toBeLessThan(400);
      expect(new URL(response.headers.get('location')!, origin).pathname).toBe(
        '/about',
      );
    });

    spec('error-route', async () => {
      const { response } = await fetchHtml('/?case=error');
      expect(response.status).toBe(500);
      await page.goto(`${origin}/?case=error`);
      await page.waitForSelector(id('native-error'), { timeout: 15_000 });
    });

    spec('head', async () => {
      const { html } = await fetchHtml('/');
      expect(html).toMatch(new RegExp(`<title[^>]*>${renderer} fixture home<`));
      expect(html).toContain('content="Renderer fixture"');
      await openHydrated('/');
      await clickAndWait('nav-about', 'native-about');
      await page.waitForFunction(
        expected => document.title === expected,
        { timeout: 15_000 },
        `${renderer} fixture about`,
      );
    });

    spec('deferred', async () => {
      // The late value resolves 1.5s after the shell, so the stream must
      // carry the fallback first and the value afterwards.
      // Bots get the fully resolved document, so ask as a browser would.
      const response = await fetch(`${origin}/?case=deferred`, {
        headers: { 'user-agent': browserUserAgent },
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let html = '';
      let pendingBeforeLate = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (
          html.includes('native-deferred-pending') &&
          !html.includes('Native late value')
        )
          pendingBeforeLate = true;
      }
      expect(pendingBeforeLate).toBe(true);
      // The resolved value also arrives in a data script, so match the
      // streamed boundary markup (Octane streams it JSON-encoded).
      const late = html.search(
        /data-testid=\\?"native-deferred-late\\?"[^>]*>Native late value/,
      );
      expect(late).toBeGreaterThan(html.indexOf('native-deferred-pending'));

      await openHydrated('/');
      await clickAndWait('nav-about', 'native-about');
      await page.click(id('nav-deferred'));
      await page.waitForSelector(id('native-deferred-pending'));
      await waitForText('native-deferred-late', 'Native late value');
      expect(pageErrors).toEqual([]);
    });
  });
}
