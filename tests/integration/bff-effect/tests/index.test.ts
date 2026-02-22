import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'path';
import {
  makeEffectRpcClient,
  runEffectRequest,
} from '@modern-js/plugin-bff/effect-client';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { bffRpcGroup } from '../shared/effect-rpc';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
type AppProcess = Awaited<ReturnType<typeof launchApp>>;
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

function expectTypecheckPasses() {
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: appDir,
    stdio: 'pipe',
  });
}

async function expectLegacyLambdaRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/legacy`);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    message: 'Hello from lambda in effect mode',
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
  const client = await runEffectRequest(
    makeEffectRpcClient(bffRpcGroup, {
      url: `${host}:${port}/bff-api/rpc`,
    }),
  );
  try {
    const response = await runEffectRequest(
      client.ping({
        name: 'modern',
      }),
    );
    expect(response).toEqual({
      message: 'Hello from Effect RPC, modern',
    });
  } finally {
    await client.dispose();
  }
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

async function expectManagedLambdaErrorRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/error/managed`);
  expect(response.status).toBe(501);
  await expect(response.json()).resolves.toEqual({
    error: 'customize response in effect serverConfig',
  });
}

async function expectManagedEffectErrorRoute(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/managed`);
  expect(response.status).toBe(501);
  await expect(response.json()).resolves.toEqual({
    error: 'customize response in effect serverConfig',
  });
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
    const el = document.querySelector('.legacy-message');
    const effectEl = document.querySelector('.effect-message');
    const userEl = document.querySelector('.user-message');
    const projectionEl = document.querySelector('.projection-message');
    const echoEl = document.querySelector('.echo-message');
    return (
      el &&
      el.textContent !== null &&
      el.textContent !== 'pending' &&
      el.textContent.trim() !== '' &&
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
  const [
    legacyMessage,
    effectMessage,
    userMessage,
    projectionMessage,
    echoMessage,
  ] = await Promise.all([
    page.$eval('.legacy-message', el => el?.textContent),
    page.$eval('.effect-message', el => el?.textContent),
    page.$eval('.user-message', el => el?.textContent),
    page.$eval('.projection-message', el => el?.textContent),
    page.$eval('.echo-message', el => el?.textContent),
  ]);
  expect(legacyMessage).toBe('Hello from lambda in effect mode');
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
    let browser: Browser;
    let page: Page;
    let port = 8080;

    beforeAll(async () => {
      jest.setTimeout(1000 * 60 * 2);
      expectTypecheckPasses();
      port = await getPort();
      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('legacy lambda route still works', async () => {
      await expectLegacyLambdaRoute(port);
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

    test('managed lambda error uses serverConfig.onError', async () => {
      await expectManagedLambdaErrorRoute(port);
    });

    test('managed effect error uses serverConfig.onError', async () => {
      await expectManagedEffectErrorRoute(port);
    });

    test('custom server middlewares run for effect runtime', async () => {
      await expectCustomServerHeaders(port);
    });

    test('client sdk import still works in browser', async () => {
      await expectClientSdkInBrowser(page, port);
    });

    test('custom sdk interceptor works for effect client', async () => {
      await expectCustomSdkInBrowser(page, port);
    });

    test('opentelemetry traces from browser to effect spans', async () => {
      await expectOpenTelemetryTraceInBrowser(page, port);
    });

    afterAll(async () => {
      await killApp(app);
      await page.close();
      await browser.close();
    });
  });

  describe('bff effect in prod', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port = 8080;

    beforeAll(async () => {
      jest.setTimeout(1000 * 60 * 2);
      port = await getPort();
      await modernBuild(appDir, [], {});
      app = await modernServe(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    test('legacy lambda route still works', async () => {
      await expectLegacyLambdaRoute(port);
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

    test('managed lambda error uses serverConfig.onError', async () => {
      await expectManagedLambdaErrorRoute(port);
    });

    test('managed effect error uses serverConfig.onError', async () => {
      await expectManagedEffectErrorRoute(port);
    });

    test('custom server middlewares run for effect runtime', async () => {
      await expectCustomServerHeaders(port);
    });

    test('client sdk import still works in browser', async () => {
      await expectClientSdkInBrowser(page, port);
    });

    test('custom sdk interceptor works for effect client', async () => {
      await expectCustomSdkInBrowser(page, port);
    });

    test('opentelemetry traces from browser to effect spans', async () => {
      await expectOpenTelemetryTraceInBrowser(page, port);
    });

    afterAll(async () => {
      await killApp(app);
      await page.close();
      await browser.close();
    });
  });
});
