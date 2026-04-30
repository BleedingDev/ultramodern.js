import dns from 'node:dns';
import fs from 'node:fs';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  acquireFixtureLocks,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

// Skip flaky tests on CI, but run them locally
const conditionalTest = process.env.LOCAL_TEST === 'true' ? test : test.skip;

dns.setDefaultResultOrder('ipv4first');

const apiAppDir = path.resolve(__dirname, '../bff-api-app');
const appDir = path.resolve(__dirname, '../bff-client-app');
const indepAppDir = path.resolve(__dirname, '../bff-indep-client-app');
const buildDoneMarker = /(?:^|\n)File \((?:client|server)\)\s+/i;
const generatedProducerSdkDirs = new Set<string>();
const producerSdkArtifacts = [
  path.join('dist-1', 'client', 'index.js'),
  path.join('dist-1', 'runtime', 'index.js'),
  path.join('dist-1', 'plugin', 'index.js'),
];

function getApiOrigin(port: number) {
  return `http://127.0.0.1:${port}`;
}

async function ensureProducerSdkGenerated(projectDir: string) {
  const hasProducerSdkArtifacts = producerSdkArtifacts.every(artifactPath =>
    fs.existsSync(path.join(projectDir, artifactPath)),
  );

  if (generatedProducerSdkDirs.has(projectDir) && hasProducerSdkArtifacts) {
    return;
  }
  await modernBuild(projectDir, [], { stdout: false, stderr: false });
  generatedProducerSdkDirs.add(projectDir);
}

const testApiWorked = async ({
  host,
  port,
  prefix,
}: {
  host: string;
  port: number;
  prefix: string;
}) => {
  const expectedText = 'Hello get bff-api-app';
  const res = await fetch(`${host}:${port}${prefix}`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toBe(JSON.stringify({ message: expectedText }));
};

const testEffectApiWorked = async ({
  host,
  port,
  prefix,
}: {
  host: string;
  port: number;
  prefix: string;
}) => {
  const res = await fetch(`${host}:${port}${prefix}/effect/hello`);
  expect(res.status).toBe(200);
  const info = await res.json();
  expect(info).toEqual({
    message: 'Hello get bff-api-app effect',
    runtime: 'effect',
  });
};

const testEffectOpenApiWorked = async ({
  host,
  port,
  prefix,
}: {
  host: string;
  port: number;
  prefix: string;
}) => {
  const res = await fetch(`${host}:${port}${prefix}/openapi.json`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('"openapi":"3.1.0"');
  expect(text).toContain('"greetings"');
  expect(text).toContain('/effect/hello');
};

describe.sequential('corss project bff', () => {
  describe('bff client-app in dev', () => {
    const expectedText = 'Hello get bff-api-app';
    let port = 0;
    let apiPort = 0;
    const SSR_PAGE = 'ssr';
    const BASE_PAGE = 'base';
    const CUSTOM_PAGE = 'custom-sdk';
    const UPLOAD_PAGE = 'upload';
    const EFFECT_PAGE = 'effect';
    const host = `http://localhost`;
    const prefix = '/api-app';
    let app: any;
    let apiApp: any;
    let page: Page | undefined;
    let browser: Browser | undefined;
    let releaseFixtureLocks: ReleaseFixtureLock | undefined;

    beforeAll(async () => {
      releaseFixtureLocks = await acquireFixtureLocks([apiAppDir, appDir]);
      apiPort = await getPort();
      port = await getPort();
      await ensureProducerSdkGenerated(apiAppDir);
      apiApp = await launchApp(apiAppDir, apiPort, {});

      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
    });

    test('api-app should works', async () => {
      await testApiWorked({
        host,
        port: apiPort,
        prefix,
      });
    });

    test('api-app effect endpoint should work', async () => {
      await testEffectApiWorked({
        host,
        port: apiPort,
        prefix,
      });
      await testEffectOpenApiWorked({
        host,
        port: apiPort,
        prefix,
      });
    });

    test('basic usage', async () => {
      await page.goto(`${host}:${port}/${BASE_PAGE}`, {
        timeout: 50000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe(expectedText);
    });

    conditionalTest('basic usage with csr', async () => {
      await page.goto(`${host}:${port}/${SSR_PAGE}`);
      await page.waitForFunction(() => {
        const loadingEl = document.querySelector('.loading');
        const helloEl = document.querySelector('.hello');
        return !loadingEl && helloEl;
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text1 = await page.$eval('.hello', el => el?.textContent);
      expect(text1).toBe(expectedText);
    });

    test('support useContext', async () => {
      const res = await fetch(`${host}:${port}${prefix}/context`);
      const info = await res.json();
      expect(res.headers.get('x-id')).toBe('1');
      expect(info.message).toBe('Hello Modern.js');
    });

    test('support custom sdk', async () => {
      await page.goto(`${host}:${port}/${CUSTOM_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('Hello Custom SDK');
    });

    test('support upload', async () => {
      await page.goto(`${host}:${port}/${UPLOAD_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.mock_file', el => el?.textContent);
      expect(text).toBe('mock_image.png');
    });

    test('support effect sdk import', async () => {
      await page.goto(`${host}:${port}/${EFFECT_PAGE}`);
      await page.waitForFunction(() => {
        const effect = document.querySelector('.effect')?.textContent;
        const context = document.querySelector('.effect-context')?.textContent;
        return effect?.includes('effect:') && context?.includes('effect:');
      });
      const [text, contextText] = await Promise.all([
        page.$eval('.effect', el => el?.textContent),
        page.$eval('.effect-context', el => el?.textContent),
      ]);
      expect(text).toBe('effect:Hello get bff-api-app effect');
      expect(contextText).toBe(
        'effect:cs-CZ:00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    afterAll(async () => {
      try {
        if (page) {
          await page.close();
        }
        if (browser) {
          await browser.close();
        }
        await killApp(app);
        await killApp(apiApp);
      } finally {
        await releaseFixtureLocks?.();
      }
    });
  });

  describe('bff client-app in prod', () => {
    const expectedText = 'Hello get bff-api-app';
    let port = 0;
    let apiPort = 0;
    const SSR_PAGE = 'ssr';
    const BASE_PAGE = 'base';
    const CUSTOM_PAGE = 'custom-sdk';
    const UPLOAD_PAGE = 'upload';
    const EFFECT_PAGE = 'effect';
    const host = `http://127.0.0.1`;
    const prefix = '/api-app';
    let app: any;
    let apiApp: any;
    let page: Page | undefined;
    let browser: Browser | undefined;
    let releaseFixtureLocks: ReleaseFixtureLock | undefined;

    beforeAll(async () => {
      releaseFixtureLocks = await acquireFixtureLocks([apiAppDir, appDir]);
      apiPort = await getPort();
      port = await getPort();
      await ensureProducerSdkGenerated(apiAppDir);
      await modernBuild(apiAppDir, [], { stdout: false, stderr: false });
      apiApp = await modernServe(apiAppDir, apiPort, {});

      await modernBuild(appDir, [], {
        stdout: false,
        stderr: false,
        marker: buildDoneMarker,
      });
      app = await modernServe(appDir, port, {});

      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
    });

    test('api-app should works', async () => {
      await testApiWorked({
        host,
        port: apiPort,
        prefix,
      });
    });

    test('api-app effect endpoint should work', async () => {
      await testEffectApiWorked({
        host,
        port: apiPort,
        prefix,
      });
      await testEffectOpenApiWorked({
        host,
        port: apiPort,
        prefix,
      });
    });

    test('basic usage', async () => {
      await page.goto(`${host}:${port}/${BASE_PAGE}`, {
        timeout: 50000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe(expectedText);
    });

    conditionalTest('basic usage with csr', async () => {
      await page.goto(`${host}:${port}/${SSR_PAGE}`);
      await page.waitForFunction(() => {
        const loadingEl = document.querySelector('.loading');
        const helloEl = document.querySelector('.hello');
        return !loadingEl && helloEl;
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text1 = await page.$eval('.hello', el => el?.textContent);
      expect(text1).toBe(expectedText);
    });

    test('support useContext', async () => {
      const res = await fetch(`${host}:${port}${prefix}/context`);
      const info = await res.json();
      expect(res.headers.get('x-id')).toBe('1');
      expect(info.message).toBe('Hello Modern.js');
    });

    test('support custom sdk', async () => {
      await page.goto(`${host}:${port}/${CUSTOM_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('Hello Custom SDK');
    });

    test('support upload', async () => {
      await page.goto(`${host}:${port}/${UPLOAD_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.mock_file', el => el?.textContent);
      expect(text).toBe('mock_image.png');
    });

    test('support effect sdk import', async () => {
      await page.goto(`${host}:${port}/${EFFECT_PAGE}`);
      await page.waitForFunction(() => {
        const effect = document.querySelector('.effect')?.textContent;
        const context = document.querySelector('.effect-context')?.textContent;
        return effect?.includes('effect:') && context?.includes('effect:');
      });
      const [text, contextText] = await Promise.all([
        page.$eval('.effect', el => el?.textContent),
        page.$eval('.effect-context', el => el?.textContent),
      ]);
      expect(text).toBe('effect:Hello get bff-api-app effect');
      expect(contextText).toBe(
        'effect:cs-CZ:00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    afterAll(async () => {
      try {
        if (page) {
          await page.close();
        }
        if (browser) {
          await browser.close();
        }
        await killApp(app);
        await killApp(apiApp);
      } finally {
        await releaseFixtureLocks?.();
      }
    });
  });

  describe('bff indep-client-app in dev', () => {
    let apiPort = 0;
    let port = 8080;
    const SSR_PAGE = 'ssr';
    const BASE_PAGE = 'base';
    const CUSTOM_PAGE = 'custom-sdk';
    const UPLOAD_PAGE = 'upload';
    const EFFECT_PAGE = 'effect';
    const host = `http://localhost`;
    const prefix = '/api';
    let indepClientApp: any;
    let apiApp: any;
    let page: Page | undefined;
    let browser: Browser | undefined;
    let releaseFixtureLocks: ReleaseFixtureLock | undefined;

    beforeAll(async () => {
      releaseFixtureLocks = await acquireFixtureLocks([apiAppDir, indepAppDir]);
      apiPort = await getPort();
      await ensureProducerSdkGenerated(apiAppDir);
      apiApp = await launchApp(apiAppDir, apiPort, {});

      port = await getPort();
      indepClientApp = await launchApp(
        indepAppDir,
        port,
        {},
        { MODERN_TEST_API_ORIGIN: getApiOrigin(apiPort) },
      );
      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
    });

    test('basic usage', async () => {
      await page.goto(`${host}:${port}/${BASE_PAGE}`, {
        timeout: 50000,
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('hello：Hello get bff-api-app');
    });

    conditionalTest('basic usage with csr', async () => {
      await page.goto(`${host}:${port}/${SSR_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const text1 = await page.$eval('.hello', el => el?.textContent);
      expect(text1).toBe('node-fetch：Hello get bff-api-app');
    });

    test('support custom sdk', async () => {
      await page.goto(`${host}:${port}/${CUSTOM_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('interceptor return：Hello Custom SDK');
    });

    test('support upload', async () => {
      await page.goto(`${host}:${port}/${UPLOAD_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.mock_file', el => el?.textContent);
      expect(text).toBe('mock_image.png');
    });

    test('support effect sdk import', async () => {
      await page.goto(`${host}:${port}/${EFFECT_PAGE}`);
      await page.waitForFunction(() => {
        const effect = document.querySelector('.effect')?.textContent;
        const context = document.querySelector('.effect-context')?.textContent;
        return effect?.includes('effect:') && context?.includes('effect:');
      });
      const [text, contextText] = await Promise.all([
        page.$eval('.effect', el => el?.textContent),
        page.$eval('.effect-context', el => el?.textContent),
      ]);
      expect(text).toBe('effect:Hello get bff-api-app effect');
      expect(contextText).toBe(
        'effect:cs-CZ:00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    test('bff response should not be compressed', async () => {
      const pageRes = await fetch(`${host}:${port}/${BASE_PAGE}`);
      expect(pageRes.headers.get('content-encoding')).toBe('gzip');
      const bffRes = await fetch(`${host}:${port}${prefix}`);
      expect(bffRes.headers.get('content-encoding')).toBeNull();
    });

    afterAll(async () => {
      try {
        if (page) {
          await page.close();
        }
        if (browser) {
          await browser.close();
        }
        await killApp(indepClientApp);
        await killApp(apiApp);
      } finally {
        await releaseFixtureLocks?.();
      }
    });
  });

  describe('bff indep-client-app in prod', () => {
    let apiPort = 0;
    let port = 8080;
    const SSR_PAGE = 'ssr';
    const BASE_PAGE = 'base';
    const CUSTOM_PAGE = 'custom-sdk';
    const UPLOAD_PAGE = 'upload';
    const EFFECT_PAGE = 'effect';
    const host = `http://localhost`;
    let indepClientApp: any;
    let apiApp: any;
    let page: Page | undefined;
    let browser: Browser | undefined;
    let releaseFixtureLocks: ReleaseFixtureLock | undefined;

    beforeAll(async () => {
      releaseFixtureLocks = await acquireFixtureLocks([apiAppDir, indepAppDir]);
      apiPort = await getPort();
      await ensureProducerSdkGenerated(apiAppDir);
      await modernBuild(apiAppDir, [], { stdout: false, stderr: false });
      apiApp = await modernServe(apiAppDir, apiPort, {});

      port = await getPort();
      await modernBuild(indepAppDir, [], {
        stdout: false,
        stderr: false,
        marker: buildDoneMarker,
        env: {
          MODERN_TEST_API_ORIGIN: getApiOrigin(apiPort),
        },
      });
      indepClientApp = await modernServe(indepAppDir, port, {
        env: {
          MODERN_TEST_API_ORIGIN: getApiOrigin(apiPort),
        },
      });

      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
    });

    test('basic usage', async () => {
      await page.goto(`${host}:${port}/${BASE_PAGE}`, {
        timeout: 50000,
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('hello：Hello get bff-api-app');
    });

    conditionalTest('basic usage with csr', async () => {
      await page.goto(`${host}:${port}/${SSR_PAGE}`);
      const text1 = await page.$eval('.hello', el => el?.textContent);
      expect(text1).toBe('node-fetch：Hello get bff-api-app');
    });

    test('support custom sdk', async () => {
      await page.goto(`${host}:${port}/${CUSTOM_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.hello', el => el?.textContent);
      expect(text).toBe('interceptor return：Hello Custom SDK');
    });

    test('support upload', async () => {
      await page.goto(`${host}:${port}/${UPLOAD_PAGE}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const text = await page.$eval('.mock_file', el => el?.textContent);
      expect(text).toBe('mock_image.png');
    });

    test('support effect sdk import', async () => {
      await page.goto(`${host}:${port}/${EFFECT_PAGE}`);
      await page.waitForFunction(() => {
        const effect = document.querySelector('.effect')?.textContent;
        const context = document.querySelector('.effect-context')?.textContent;
        return effect?.includes('effect:') && context?.includes('effect:');
      });
      const [text, contextText] = await Promise.all([
        page.$eval('.effect', el => el?.textContent),
        page.$eval('.effect-context', el => el?.textContent),
      ]);
      expect(text).toBe('effect:Hello get bff-api-app effect');
      expect(contextText).toBe(
        'effect:cs-CZ:00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    afterAll(async () => {
      try {
        if (page) {
          await page.close();
        }
        if (browser) {
          await browser.close();
        }
        await killApp(indepClientApp);
        await killApp(apiApp);
      } finally {
        await releaseFixtureLocks?.();
      }
    });
  });
});
