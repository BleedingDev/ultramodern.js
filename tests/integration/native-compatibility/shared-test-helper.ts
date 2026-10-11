import type { ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';
import {
  createNativeConsumer,
  readNativeErrorBody,
} from '../../../scripts/native-compatibility/consumer.mjs';
import { getPort } from '../../utils/modernTestUtils';

/**
 * A dev server can accept TCP before it answers HTTP. Poll until it responds
 * (any status) so the first assertion never races server startup.
 */
async function waitForHttp(origin: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

// Both targets execute the same application source and observable assertions.
// Tests use the installed native CLI; the upstream target never sees fork code.
export function registerNativeCompatibilityCases(target: 'upstream' | 'fork') {
  for (const mode of ['string', 'stream']) {
    test(`${target}: native ${mode} SSR, redirects, BFF and client navigation in dev and production`, async () => {
      const consumer = createNativeConsumer(target);
      let app: ChildProcess | undefined;
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ args: ['--no-sandbox'] });
        for (const phase of ['dev', 'serve']) {
          if (phase === 'serve') {
            await consumer.build(mode);
          }
          const port = await getPort();
          app = await consumer.start(phase, mode, port);
          // The readiness probe connects to 127.0.0.1; `localhost` can
          // resolve to ::1 first on Windows, so requests use the same host.
          const origin = `http://127.0.0.1:${port}`;
          await waitForHttp(origin);
          const home = await fetch(origin);
          expect(home.status).toBe(200);
          expect(await home.text()).toMatch(
            /<p\b[^>]*\bid="home"[^>]*>Native home<\/p>/,
          );
          const greetingController = new AbortController();
          const greeting = await fetch(`${origin}/greeting`, {
            signal: greetingController.signal,
          });
          const greetingHtml =
            greeting.status === 200
              ? await greeting.text()
              : await readNativeErrorBody(greeting, greetingController);
          expect(
            greeting.status,
            `${target}/${mode}/${phase} GET /greeting\n${greetingHtml}`,
          ).toBe(200);
          expect(greetingHtml).toMatch(
            /<p\b[^>]*\bid="greeting"[^>]*>Hello from native loader<\/p>/,
          );
          const redirect = await fetch(`${origin}/redirect`, {
            redirect: 'manual',
          });
          expect(redirect.status).toBe(302);
          expect(redirect.headers.get('location')).toBe('/greeting');
          const bff = await fetch(`${origin}/api/contract`);
          expect(bff.status).toBe(200);
          expect(await bff.json()).toEqual({
            message: 'Hello from native BFF',
          });

          if (mode === 'stream') {
            const response = await fetch(`${origin}/stream`, {
              headers: {
                'Accept-Encoding': 'identity',
                // Modern.js deliberately waits for all content for bots;
                // Node fetch's default "node" User-Agent is classified as one.
                'User-Agent':
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
              signal: AbortSignal.timeout(30_000),
            });
            expect(response.status).toBe(200);
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let html = '';
            try {
              while (
                !html.includes('id="stream-fallback"') &&
                !html.includes('id="stream-complete"')
              ) {
                const chunk = await reader.read();
                if (chunk.done) break;
                html += decoder.decode(chunk.value, { stream: true });
              }
              expect(html).toContain(
                '<p id="stream-fallback">Waiting for native stream</p>',
              );
              expect(html).not.toContain(
                '<p id="stream-complete">Native stream completed</p>',
              );
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                html += decoder.decode(chunk.value, { stream: true });
              }
              expect(html).toContain(
                '<p id="stream-complete">Native stream completed</p>',
              );
            } finally {
              await reader.cancel();
            }
          }

          const page = await browser.newPage();
          try {
            await page.goto(origin);
            await page.waitForFunction(() =>
              Object.keys(document.querySelector('#greeting-link') ?? {}).some(
                key => key.startsWith('__reactProps$'),
              ),
            );
            const documentIdentity = await page.evaluate(() => {
              const identity = crypto.randomUUID();
              Object.assign(window, { nativeCompatibilityDocument: identity });
              return identity;
            });
            await page.locator('#greeting-link').click();
            await page.waitForURL(`${origin}/greeting`);
            await expect
              .poll(() => page.locator('#greeting').textContent())
              .toBe('Hello from native loader');
            expect(
              await page.evaluate(() =>
                Reflect.get(window, 'nativeCompatibilityDocument'),
              ),
            ).toBe(documentIdentity);
          } finally {
            await page.close();
          }
          await consumer.stop(app);
          app = undefined;
        }
      } catch (error) {
        console.error(
          `[native-compatibility] ${target}/${mode} failed\n${consumer.diagnostics()}`,
        );
        throw error;
      } finally {
        try {
          if (app) await consumer.stop(app);
        } finally {
          try {
            await browser?.close();
          } finally {
            await consumer.cleanup();
          }
        }
      }
    }, 600_000);
  }
}
