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
  } catch {
    // Ignore SecurityError if page is not loaded yet
  }

  // Reset header to English to ensure clean state
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
}

/**
 * Wait until `selector`'s trimmed text equals `text`. Polls every frame:
 * React rewrites text nodes in place, which `waitForSelector` does not observe.
 */
export async function waitForText(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  await page.waitForFunction(
    (sel: string, expected: string) =>
      document.querySelector(sel)?.textContent?.trim() === expected,
    {},
    selector,
    text,
  );
}
