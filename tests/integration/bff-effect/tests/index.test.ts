import { execSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  ensureWorkspacePackagesBuilt,
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const ensureWorkspacePackages = [
  '@modern-js/plugin-bff',
  '@modern-js/server-core',
  '@modern-js/server-runtime',
];
type AppProcess = Awaited<ReturnType<typeof launchApp>>;
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

function expectTypecheckPasses() {
  execSync('pnpm exec tsgo --noEmit -p tsconfig.json', {
    cwd: appDir,
    stdio: 'pipe',
  });
}

async function expectEffectHttpApiRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/hello`);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    message: 'Hello from Effect HttpApi',
    runtime: 'effect',
  });
}

async function expectEffectPathAndQueryRoute(port: number) {
  const response = await fetch(
    `${host}:${port}/bff-api/effect/user/42?source=runtime`,
  );
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    id: '42',
    source: 'runtime',
  });
}

async function expectEffectPayloadRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/echo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: 'echo-from-runtime',
    }),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    echoed: 'echo-from-runtime',
  });
}

async function expectEffectRpcRoute(port: number) {
  const requestBody = {
    jsonrpc: '2.0',
    method: 'ping',
    params: {
      name: 'modern',
    },
    id: 0,
    headers: [] as string[],
  };

  const response = await fetch(`${host}:${port}/bff-api/rpc/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  expect(response.status).toBe(200);
  const payload = (await response.json()) as
    | {
        result?: {
          message?: string;
        };
      }
    | Array<{
        result?: {
          message?: string;
        };
      }>;
  const firstResult = Array.isArray(payload) ? payload[0] : payload;
  expect(firstResult.result).toEqual({
    message: 'Hello from Effect RPC, modern',
  });
}

async function expectOpenApiRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/openapi.json`);
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(typeof json.openapi).toBe('string');
  expect(json.paths['/effect/hello']).toBeDefined();
  expect(json.paths['/effect/user/{id}']).toBeDefined();
  expect(json.paths['/effect/echo']).toBeDefined();
  expect(json.paths['/effect/managed']).toBeDefined();
}

async function expectManagedEffectErrorRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/managed`);
  expect(response.status).toBe(501);
  await expect(response.json()).resolves.toEqual({
    error: 'customize response in effect serverConfig',
  });
}

async function expectLegacyLambdaRoutesBlocked(port: number) {
  const legacyResponse = await fetch(`${host}:${port}/bff-api/legacy`);
  expect(legacyResponse.status).toBe(404);
  const legacyBody = await legacyResponse.text();
  expect(legacyBody).not.toContain('Hello from lambda in effect mode');

  const managedResponse = await fetch(`${host}:${port}/bff-api/error/managed`);
  expect(managedResponse.status).toBe(404);
}

function expectDurationHeader(
  value: string | null,
  expectedPath: string,
  headerName: string,
) {
  expect(value).toBeTruthy();
  if (!value) {
    return;
  }
  expect(value).toMatch(/^dur=\d+; path=/);
  expect(value).toContain(`path=${expectedPath}`);
  expect(value).toEqual(expect.stringContaining('dur='));
  expect(value).toEqual(expect.stringContaining('path='));
  expect(headerName).toContain('x-effect-');
}

async function expectCustomServerHeaders(port: number) {
  const apiResponse = await fetch(`${host}:${port}/bff-api/effect/hello`);
  expect(apiResponse.status).toBe(200);
  expectDurationHeader(
    apiResponse.headers.get('x-effect-request-middleware'),
    '/bff-api/effect/hello',
    'x-effect-request-middleware',
  );

  const renderResponse = await fetch(`${host}:${port}/`, {
    headers: {
      Accept: 'text/html',
    },
  });
  expect(renderResponse.status).toBe(200);
  expectDurationHeader(
    renderResponse.headers.get('x-effect-request-middleware'),
    '/',
    'x-effect-request-middleware',
  );
  expectDurationHeader(
    renderResponse.headers.get('x-effect-render-middleware'),
    '/',
    'x-effect-render-middleware',
  );
}

async function expectClientSdkInBrowser(page: Page, port: number) {
  await page.goto(`${host}:${port}/`, {
    timeout: 50000,
  });
  await page.waitForFunction(() => {
    const effectEl = document.querySelector('.effect-message');
    const userEl = document.querySelector('.user-message');
    const projectionEl = document.querySelector('.projection-message');
    const echoEl = document.querySelector('.echo-message');
    return (
      effectEl &&
      effectEl.textContent !== null &&
      effectEl.textContent !== 'pending' &&
      effectEl.textContent.trim() !== '' &&
      userEl &&
      userEl.textContent !== null &&
      userEl.textContent !== 'pending' &&
      userEl.textContent.trim() !== '' &&
      projectionEl &&
      projectionEl.textContent !== null &&
      projectionEl.textContent !== 'pending' &&
      projectionEl.textContent.trim() !== '' &&
      echoEl &&
      echoEl.textContent !== null &&
      echoEl.textContent !== 'pending' &&
      echoEl.textContent.trim() !== ''
    );
  });
  const [effectMessage, userMessage, projectionMessage, echoMessage] =
    await Promise.all([
      page.$eval('.effect-message', el => el?.textContent),
      page.$eval('.user-message', el => el?.textContent),
      page.$eval('.projection-message', el => el?.textContent),
      page.$eval('.echo-message', el => el?.textContent),
    ]);
  expect(effectMessage).toBe('Hello from Effect HttpApi');
  expect(userMessage).toBe('42:browser');
  expect(projectionMessage).toBe('42');
  expect(echoMessage).toBe('echo-from-client');
}

async function expectCustomSdkInBrowser(page: Page, port: number) {
  await page.goto(`${host}:${port}/custom-sdk`, {
    timeout: 50000,
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.custom-sdk-message');
    return (
      el &&
      el.textContent !== null &&
      el.textContent !== 'pending' &&
      el.textContent.trim() !== ''
    );
  });
  const message = await page.$eval(
    '.custom-sdk-message',
    el => el?.textContent,
  );
  expect(message).toBe('Hello Effect Custom SDK');
}

async function expectOpenTelemetryTraceInBrowser(page: Page, port: number) {
  await page.goto(`${host}:${port}/trace`, {
    timeout: 50000,
  });
  await page.waitForFunction(() => {
    const el = document.querySelector('.trace-status');
    return (
      el &&
      el.textContent !== null &&
      el.textContent !== 'pending' &&
      el.textContent.trim() !== ''
    );
  });

  const [
    status,
    traceId,
    rootSpanId,
    runSpanId,
    runParentSpanId,
    runTraceId,
    dbParentSpanId,
    dbTraceId,
    spanNames,
  ] = await Promise.all([
    page.$eval('.trace-status', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-root-span-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-run-span-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-run-parent-span-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-run-trace-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-db-parent-span-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-db-trace-id', el => el.textContent?.trim() ?? ''),
    page.$eval('.trace-span-names', el => el.textContent?.trim() ?? ''),
  ]);

  expect(status).toBe('ok');
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(rootSpanId).toMatch(/^[0-9a-f]{16}$/);
  expect(runSpanId).toMatch(/^[0-9a-f]{16}$/);
  expect(runParentSpanId).toBe(rootSpanId);
  expect(runTraceId).toBe(traceId);
  expect(dbParentSpanId).toBe(runSpanId);
  expect(dbTraceId).toBe(traceId);
  expect(spanNames.split(',')).toEqual(
    expect.arrayContaining(['bff.effect.db.query', 'bff.effect.trace.run']),
  );
}

describe('bff effect tests', () => {
  describe('bff effect in dev', () => {
    let app: AppProcess;
    let browser: Browser | undefined;
    let page: Page | undefined;
    let releaseFixtureLock: ReleaseFixtureLock | undefined;
    let port = 8080;

    beforeAll(async () => {
      setSuiteTimeout(1000 * 60 * 2);
      releaseFixtureLock = await acquireFixtureLock(appDir);
      await ensureWorkspacePackagesBuilt(ensureWorkspacePackages);
      expectTypecheckPasses();
      port = await getPort();
      app = await launchApp(appDir, port, { ensureWorkspacePackages });
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('effect http api route works', async () => {
      await expectEffectHttpApiRoute(port);
    });

    test('effect path and query route works', async () => {
      await expectEffectPathAndQueryRoute(port);
    });

    test('effect payload route works', async () => {
      await expectEffectPayloadRoute(port);
    });

    test('effect rpc route works', async () => {
      await expectEffectRpcRoute(port);
    });

    test('openapi route works', async () => {
      await expectOpenApiRoute(port);
    });

    test('managed effect error uses serverConfig.onError', async () => {
      await expectManagedEffectErrorRoute(port);
    });

    test('effect runtime does not serve api/lambda handlers', async () => {
      await expectLegacyLambdaRoutesBlocked(port);
    });

    test('custom server middlewares run for effect runtime', async () => {
      await expectCustomServerHeaders(port);
    });

    test('client sdk import still works in browser', async () => {
      expect(page).toBeDefined();
      await expectClientSdkInBrowser(page!, port);
    });

    test('custom sdk interceptor works for effect client', async () => {
      expect(page).toBeDefined();
      await expectCustomSdkInBrowser(page!, port);
    });

    test('opentelemetry traces from browser to effect spans', async () => {
      expect(page).toBeDefined();
      await expectOpenTelemetryTraceInBrowser(page!, port);
    });

    afterAll(async () => {
      try {
        await killApp(app);
        await page?.close();
        await browser?.close();
      } finally {
        await releaseFixtureLock?.();
      }
    });
  });

  describe('bff effect in prod', () => {
    let app: AppProcess;
    let browser: Browser | undefined;
    let page: Page | undefined;
    let releaseFixtureLock: ReleaseFixtureLock | undefined;
    let port = 8080;

    beforeAll(async () => {
      setSuiteTimeout(1000 * 60 * 2);
      releaseFixtureLock = await acquireFixtureLock(appDir);
      port = await getPort();
      await modernBuild(appDir, [], { ensureWorkspacePackages });
      app = await modernServe(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('effect http api route works', async () => {
      await expectEffectHttpApiRoute(port);
    });

    test('effect path and query route works', async () => {
      await expectEffectPathAndQueryRoute(port);
    });

    test('effect payload route works', async () => {
      await expectEffectPayloadRoute(port);
    });

    test('effect rpc route works', async () => {
      await expectEffectRpcRoute(port);
    });

    test('openapi route works', async () => {
      await expectOpenApiRoute(port);
    });

    test('managed effect error uses serverConfig.onError', async () => {
      await expectManagedEffectErrorRoute(port);
    });

    test('effect runtime does not serve api/lambda handlers', async () => {
      await expectLegacyLambdaRoutesBlocked(port);
    });

    test('custom server middlewares run for effect runtime', async () => {
      await expectCustomServerHeaders(port);
    });

    test('client sdk import still works in browser', async () => {
      expect(page).toBeDefined();
      await expectClientSdkInBrowser(page!, port);
    });

    test('custom sdk interceptor works for effect client', async () => {
      expect(page).toBeDefined();
      await expectCustomSdkInBrowser(page!, port);
    });

    test('opentelemetry traces from browser to effect spans', async () => {
      expect(page).toBeDefined();
      await expectOpenTelemetryTraceInBrowser(page!, port);
    });

    afterAll(async () => {
      try {
        await killApp(app);
        await page?.close();
        await browser?.close();
      } finally {
        await releaseFixtureLock?.();
      }
    });
  });
});
