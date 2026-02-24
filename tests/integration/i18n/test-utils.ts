import { promises as fs } from 'node:fs';
import path from 'path';
import type { Page } from 'puppeteer';

export const conditionalTest = test;

const LOCK_DIR = path.resolve(__dirname, '.locks');

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function acquireTestLock(
  name: string,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    staleMs?: number;
  },
): Promise<() => Promise<void>> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 200;
  const staleMs = options?.staleMs ?? 15 * 60_000;
  const lockFile = path.join(LOCK_DIR, `${name}.lock`);
  const startedAt = Date.now();

  await fs.mkdir(LOCK_DIR, { recursive: true });

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const handle = await fs.open(lockFile, 'wx');
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await fs.unlink(lockFile).catch(() => {
          // ignore unlock race
        });
      };
    } catch (error) {
      const maybeErr = error as NodeJS.ErrnoException;
      if (maybeErr.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = await fs.stat(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(lockFile).catch(() => {
            // ignore stale lock cleanup race
          });
          continue;
        }
      } catch {
        // lock may have been released between stat/unlink, retry loop
      }

      await sleep(pollIntervalMs);
    }
  }

  throw new Error(`Timed out acquiring test lock "${name}"`);
}

/**
 * Clear all cookies, localStorage, and reset Accept-Language header
 * This ensures a clean state before each test
 */
export async function clearI18nTestState(page: Page): Promise<void> {
  // Clear cookies before each test to ensure clean state
  const cookies = await page.cookies();
  for (const cookie of cookies) {
    await page.deleteCookie(cookie);
  }

  // Clear localStorage to ensure clean state (only if page is loaded)
  try {
    await page.evaluate(() => {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    });
  } catch (error) {
    // Ignore SecurityError if page is not loaded yet
  }

  // Reset header to English to ensure clean state
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
}

/**
 * Navigate to a URL and retry if SSR fallback is detected.
 * During dev server rebuilds, the HTML template may be temporarily unavailable,
 * causing SSR to fall back to CSR. This helper retries navigation until SSR
 * succeeds or the maximum number of retries is reached.
 *
 * @returns The response body text from the final successful navigation
 */
export async function gotoWithSSRRetry(
  page: Page,
  url: string,
  options?: { maxRetries?: number; retryDelay?: number },
): Promise<string | undefined> {
  const { maxRetries = 5, retryDelay = 2000 } = options ?? {};

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await page.goto(url, {
      waitUntil: ['networkidle0'],
    });
    const body = await response?.text();

    // If SSR succeeded (no fallback marker), return immediately
    if (body && !body.includes('__modern_ssr_fallback_reason__')) {
      return body;
    }

    // On last attempt, return whatever we got
    if (attempt === maxRetries) {
      return body;
    }

    // Wait before retrying to allow dev server rebuild to complete
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }

  return undefined;
}

/**
 * Wait for React hydration to complete on a target element.
 * After SSR, the HTML is rendered but React event handlers are not attached
 * until hydration finishes. This helper checks for React internal fiber
 * properties on the element, which are set during hydration.
 */
export async function waitForHydration(
  page: Page,
  selector: string,
  timeout = 15000,
): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      // React attaches __reactFiber$ or __reactProps$ during hydration
      return Object.keys(el).some(
        key =>
          key.startsWith('__reactFiber$') ||
          key.startsWith('__reactProps$') ||
          key.startsWith('__reactInternalInstance$'),
      );
    },
    { timeout },
    selector,
  );
}
