import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { beforeAll, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { launchOptions } = require('./launchOptions');

const DIR = path.join(os.tmpdir(), 'vitest_puppeteer_global_setup');
const WS_ENDPOINT_PATH = path.join(DIR, 'wsEndpoint');

globalThis.jest ??= {
  setTimeout: () => {},
  retryTimes: () => {},
};

expect.extend({
  async toMatchTextContent(received, expected) {
    if (!received || typeof received.$eval !== 'function') {
      return {
        pass: false,
        message: () =>
          'toMatchTextContent expects a Puppeteer Page-like value.',
      };
    }

    const textContent = await received.$eval(
      'body',
      el => el.textContent || '',
    );
    const pass =
      expected instanceof RegExp
        ? expected.test(textContent)
        : String(textContent).includes(String(expected));

    return {
      pass,
      message: () =>
        `Expected page text ${pass ? 'not ' : ''}to match ${String(expected)}. Received: ${textContent}`,
    };
  },
});

beforeAll(async () => {
  if (globalThis.browser) {
    return;
  }

  if (existsSync(WS_ENDPOINT_PATH)) {
    const wsEndpoint = readFileSync(WS_ENDPOINT_PATH, 'utf8').trim();
    if (wsEndpoint) {
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
      });
      globalThis.__BROWSER_GLOBAL__ = browser;
      globalThis.browser = browser;
      return;
    }
  }

  const browser = await puppeteer.launch({
    ...launchOptions,
    dumpio: false,
  });
  globalThis.__BROWSER_GLOBAL__ = browser;
  globalThis.browser = browser;
});
