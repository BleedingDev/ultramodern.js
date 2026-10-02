import type { ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';
import { createNativeConsumer } from '../../../scripts/native-compatibility/consumer.mjs';
import { getPort } from '../../utils/modernTestUtils';

const target = process.env.NATIVE_COMPATIBILITY_TARGET ?? 'all';
const targets = target === 'all' ? ['upstream', 'fork'] : [target];

// Both targets execute the same application source and observable assertions.
// Tests use the installed native CLI; the upstream target never sees fork code.
for (const target of targets) {
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
          const origin = `http://localhost:${port}`;
          const home = await fetch(origin);
          expect(home.status).toBe(200);
          expect(await home.text()).toMatch(
            /<p\b[^>]*\bid="home"[^>]*>Native home<\/p>/,
          );
          const greeting = await fetch(`${origin}/greeting`);
          expect(greeting.status).toBe(200);
          expect(await greeting.text()).toMatch(
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
