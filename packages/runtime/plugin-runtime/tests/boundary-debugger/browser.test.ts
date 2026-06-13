import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

type BrowserType = {
  launch: (options?: Record<string, unknown>) => Promise<{
    close: () => Promise<void>;
    newPage: () => Promise<{
      click: (selector: string) => Promise<void>;
      evaluate: <T>(callback: () => T | Promise<T>) => Promise<T>;
      goto: (url: string) => Promise<unknown>;
      waitForFunction: (
        callback: () => boolean,
        arg?: unknown,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
      on: (event: string, handler: (value: any) => void) => void;
    }>;
  }>;
};

const requireFromRstestBrowserFixture = createRequire(
  path.resolve(
    __dirname,
    '../../../../../tests/integration/rstest/basic-app-rstest-browser/package.json',
  ),
);
const { chromium }: { chromium: BrowserType } =
  requireFromRstestBrowserFixture('playwright');

describe('ultramodern boundary debugger chromium overlay', () => {
  test('keeps overlays out of layout and renders Checkout ownership inside Decide', async () => {
    const tempDir = mkdtempSync(
      path.join(tmpdir(), 'modern-boundary-debugger-'),
    );
    const entryPath = path.join(tempDir, 'entry.tsx');
    const bundlePath = path.join(tempDir, 'bundle.js');
    const htmlPath = path.join(tempDir, 'index.html');

    try {
      writeFileSync(
        entryPath,
        `import React from 'react';
import { createRoot } from 'react-dom/client';
import ultramodernBoundaryDebuggerPlugin from ${JSON.stringify(
          path.resolve(__dirname, '../../src/boundary-debugger/index.tsx'),
        )};

globalThis.React = React;

function App() {
  return (
    <main style={{ minHeight: 1600, padding: 48 }}>
      <button
        data-testid="primary-control"
        style={{ height: 44, width: 180 }}
        type="button"
      >
        Decide
      </button>
      <section
        data-modern-boundary-id="shellSuperApp"
        data-modern-mf-expose="./Decide"
        data-testid="decide-surface"
        style={{
          border: '1px solid #d1d5db',
          height: 260,
          marginTop: 48,
          padding: 36,
          width: 720,
        }}
      >
        <button
          data-modern-boundary-id="verticalCheckout"
          data-modern-mf-expose="./Controls"
          data-testid="checkout-control"
          style={{ height: 48, width: 220 }}
          type="button"
        >
          Pay now
        </button>
      </section>
    </main>
  );
}

let WrappedApp;
ultramodernBoundaryDebuggerPlugin({
  metadata: {
    appId: 'shell',
    boundaries: [
      {
        appId: 'shell',
        label: 'Decide',
        mfName: 'shellSuperApp',
        role: 'host',
      },
      {
        appId: 'checkout',
        label: 'Checkout',
        mfName: 'verticalCheckout',
        ownerTeam: 'checkout-platform',
        role: 'vertical',
      },
    ],
    schemaVersion: 1,
  },
}).setup({
  wrapRoot(factory) {
    WrappedApp = factory(App);
  },
});

createRoot(document.getElementById('root')).render(
  React.createElement(WrappedApp),
);
`,
        'utf8',
      );
      await build({
        absWorkingDir: path.resolve(__dirname, '../..'),
        bundle: true,
        define: {
          'process.env.NODE_ENV': '"test"',
        },
        entryPoints: [entryPath],
        format: 'esm',
        jsx: 'transform',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        nodePaths: [
          path.resolve(__dirname, '../../node_modules'),
          path.resolve(__dirname, '../../../../../node_modules'),
        ],
        outfile: bundlePath,
        platform: 'browser',
      });
      writeFileSync(
        htmlPath,
        `<!doctype html><html><body><div id="root"></div><script type="module">${readFileSync(
          bundlePath,
          'utf8',
        )}</script></body></html>`,
        'utf8',
      );

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const browserErrors: string[] = [];
        page.on('console', message => {
          if (message.type?.() === 'error') {
            browserErrors.push(message.text?.() ?? String(message));
          }
        });
        page.on('pageerror', error => {
          browserErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        });
        await page.goto(pathToFileURL(htmlPath).href);
        try {
          await page.waitForFunction(
            () =>
              Boolean(
                document.querySelector('[data-testid="primary-control"]'),
              ),
            undefined,
            { timeout: 5000 },
          );
        } catch (error) {
          const bodyHtml = await page.evaluate(() => document.body.innerHTML);
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\n` +
              `browserErrors=${JSON.stringify(browserErrors)}\n` +
              `body=${bodyHtml.slice(0, 500)}`,
          );
        }
        expect(browserErrors).toEqual([]);

        const before = await page.evaluate(() => {
          const control = document.querySelector(
            '[data-testid="primary-control"]',
          ) as HTMLElement;
          const rect = control.getBoundingClientRect();
          return {
            rect: {
              height: rect.height,
              left: rect.left,
              top: rect.top,
              width: rect.width,
            },
            scrollHeight: document.documentElement.scrollHeight,
          };
        });

        await page.click('text=show team boundaries');
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[data-modern-boundary-overlay]')
              .length === 2,
          undefined,
          { timeout: 5000 },
        );

        const after = await page.evaluate(() => {
          const control = document.querySelector(
            '[data-testid="primary-control"]',
          ) as HTMLElement;
          const rect = control.getBoundingClientRect();
          const checkoutOverlay = document.querySelector(
            '[data-modern-boundary-overlay-label="Checkout"]',
          ) as HTMLElement | null;
          return {
            checkoutOverlayStyle: checkoutOverlay
              ? {
                  boxSizing: checkoutOverlay.style.boxSizing,
                  pointerEvents: checkoutOverlay.style.pointerEvents,
                  position: checkoutOverlay.style.position,
                }
              : null,
            checkoutOverlayText: checkoutOverlay?.textContent ?? '',
            rect: {
              height: rect.height,
              left: rect.left,
              top: rect.top,
              width: rect.width,
            },
            scrollHeight: document.documentElement.scrollHeight,
          };
        });

        expect(after.scrollHeight).toBe(before.scrollHeight);
        expect(after.rect).toEqual(before.rect);
        expect(after.checkoutOverlayStyle).toEqual({
          boxSizing: 'border-box',
          pointerEvents: 'none',
          position: 'fixed',
        });
        expect(after.checkoutOverlayText).toContain('Checkout');
        expect(after.checkoutOverlayText).toContain('./Controls');
      } finally {
        await browser.close();
      }
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
