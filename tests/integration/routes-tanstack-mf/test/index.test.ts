import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  acquireFixtureLock,
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
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

setSuiteTimeout(1000 * 60 * 8);

async function waitForAppReady(url: string, maxRetries = 60) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status < 500) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`App did not become ready: ${url}`);
}

const remoteDir = path.resolve(__dirname, '../mf-remote');
const remoteTwoDir = path.resolve(__dirname, '../mf-remote-2');
const hostDir = path.resolve(__dirname, '../mf-host');
const fixtureRoot = path.resolve(__dirname, '..');

type FederatedPorts = {
  remote: number;
  remoteTwo: number;
  host: number;
};

async function createFederatedPorts(): Promise<FederatedPorts> {
  const ports = new Set<number>();
  while (ports.size < 3) {
    ports.add(await getPort());
  }
  const [remote, remoteTwo, host] = Array.from(ports);
  return {
    remote,
    remoteTwo,
    host,
  };
}

function isIgnorableWindowsTaskkillError(error: unknown) {
  if (process.platform !== 'win32' || !(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes('Access is denied') ||
    error.message.includes('operation attempted is not supported')
  );
}

function createFederatedEnv(ports: FederatedPorts) {
  return {
    MF_REMOTE_PORT: String(ports.remote),
    MF_REMOTE_TWO_PORT: String(ports.remoteTwo),
    MF_HOST_PORT: String(ports.host),
    MF_HOST_ORIGIN: `http://localhost:${ports.host}`,
    MF_REMOTE_ORIGIN: `http://localhost:${ports.remote}`,
  };
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html',
    },
  });
  return {
    status: res.status,
    html: await res.text(),
  };
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  const json = await res.json();
  return {
    status: res.status,
    json,
  };
}

async function assertSharedTreeShakingStats(port: number) {
  const statsResponse = await fetchJson(
    `http://localhost:${port}/mf-stats.json`,
  );
  expect(statsResponse.status).toBe(200);
  const shared = (
    statsResponse.json as {
      shared?: Array<{
        name?: string;
        treeShaking?: {
          mode?: string;
        };
      }>;
    }
  ).shared;
  expect(Array.isArray(shared)).toBe(true);
  expect((shared || []).length).toBeGreaterThan(0);
  const runtimeInferPackages = new Set([
    'react',
    'react-dom',
    '@tanstack/react-router',
  ]);
  for (const item of shared || []) {
    if (item.name === '@modern-js/runtime') {
      expect(item.treeShaking ?? false).toBe(false);
      continue;
    }
    if (runtimeInferPackages.has(item.name || '')) {
      expect(item.treeShaking?.mode).toBe('runtime-infer');
    }
  }
}

function runTypecheck(appDir: string, tsconfig = 'tsconfig.json') {
  try {
    execFileSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', tsconfig],
      {
        cwd: appDir,
        stdio: 'pipe',
      },
    );
  } catch (error: any) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    throw new Error(
      `TypeScript typecheck failed for ${path.basename(appDir)}:\n${stdout}\n${stderr}`,
    );
  }
}

type TraceSpanSnapshot = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

function findLatestSpanByName(
  spans: TraceSpanSnapshot[],
  name: string,
): TraceSpanSnapshot | undefined {
  for (let index = spans.length - 1; index >= 0; index--) {
    if (spans[index].name === name) {
      return spans[index];
    }
  }
  return undefined;
}

function randomHex(bytes: number) {
  return randomBytes(bytes).toString('hex');
}

function createTraceparent() {
  const traceId = randomHex(16);
  const rootSpanId = randomHex(8);
  return {
    traceId,
    rootSpanId,
    traceparent: `00-${traceId}-${rootSpanId}-01`,
  };
}

async function assertEffectLocalePropagation(
  page: Page,
  hostPort: number,
  remotePort: number,
  errors: string[],
) {
  const initialErrorCount = errors.length;
  const acceptLanguage = 'zh-CN,zh;q=0.9';

  await page.goto(`http://localhost:${hostPort}/mf`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });

  const trace = createTraceparent();
  const runResult = (await page.evaluate(
    input =>
      fetch('/host-api/effect/trace/reset', {
        method: 'POST',
      }).then(resetHost =>
        fetch(
          `http://localhost:${input.remotePort}/remote-api/effect/trace/reset`,
          {
            method: 'POST',
          },
        ).then(resetRemote =>
          fetch('/host-api/effect/trace/run', {
            method: 'GET',
            headers: {
              traceparent: input.traceparent,
              'accept-language': input.acceptLanguage,
            },
          }).then(runResponse =>
            runResponse.json().then(runBody => ({
              resetHostStatus: resetHost.status,
              resetRemoteStatus: resetRemote.status,
              runStatus: runResponse.status,
              runBody,
            })),
          ),
        ),
      ),
    {
      traceparent: trace.traceparent,
      acceptLanguage,
      remotePort,
    },
  )) as {
    resetHostStatus: number;
    resetRemoteStatus: number;
    runStatus: number;
    runBody: {
      status?: 'ok';
      remoteStatus?: 'ok';
      traceparent?: string;
      locale?: string;
      remoteLocale?: string;
    };
  };

  expect(runResult.resetHostStatus).toBe(200);
  expect(runResult.resetRemoteStatus).toBe(200);
  expect(runResult.runStatus).toBe(200);
  expect(runResult.runBody).toEqual({
    status: 'ok',
    traceparent: trace.traceparent,
    remoteStatus: 'ok',
    locale: acceptLanguage,
    remoteLocale: acceptLanguage,
  });

  expect(errors.slice(initialErrorCount)).toEqual([]);
}

async function waitForTraceSpans(
  url: string,
  expectedNames: string[],
): Promise<TraceSpanSnapshot[]> {
  let lastSpanNames: string[] = [];
  for (let index = 0; index < 40; index++) {
    const response = await fetchJson(url);
    if (response.status === 200) {
      const spans =
        (response.json as { spans?: TraceSpanSnapshot[] }).spans || [];
      const spanNames = spans.map(span => span.name);
      lastSpanNames = spanNames;
      const hasAllExpected = expectedNames.every(name =>
        spanNames.includes(name),
      );
      if (hasAllExpected) {
        return spans;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for expected spans from ${url}. Last spans: ${lastSpanNames.join(
      ', ',
    )}`,
  );
}

async function waitForTraceSpansWithFallback(
  baseUrl: string,
  traceId: string,
  expectedNames: string[],
) {
  try {
    return {
      spans: await waitForTraceSpans(
        `${baseUrl}?traceId=${traceId}`,
        expectedNames,
      ),
      strictTracePropagation: true,
    };
  } catch {
    return {
      spans: await waitForTraceSpans(baseUrl, expectedNames),
      strictTracePropagation: false,
    };
  }
}

async function assertModuleFederationAssets(remotePort: number) {
  const manifestResponse = await fetch(
    `http://localhost:${remotePort}/mf-manifest.json`,
  );
  expect(manifestResponse.status).toBe(200);
  const manifestContentType =
    manifestResponse.headers.get('content-type') || '';
  expect(manifestContentType).toContain('application/json');

  const manifest = (await manifestResponse.json()) as {
    metaData?: {
      remoteEntry?: {
        path?: string;
        name?: string;
      };
      publicPath?: string;
    };
    exposes?: Array<{
      name?: string;
      path?: string;
      assets?: {
        js?: {
          sync?: string[];
          async?: string[];
        };
      };
    }>;
  };
  const publicPath = manifest.metaData?.publicPath;
  expect(typeof publicPath).toBe('string');
  expect(publicPath).toBe(`http://localhost:${remotePort}/`);
  const exposes = manifest.exposes || [];
  expect(exposes.length).toBeGreaterThan(0);
  for (const expose of exposes) {
    expect(expose.path).toMatch(/^\.\//);
    expect((expose.assets?.js?.sync || []).length).toBeGreaterThan(0);
  }
  const mutatorExpose = exposes.find(expose => expose.name === 'Mutator');
  if (mutatorExpose) {
    expect((mutatorExpose.assets?.js?.async || []).length).toBeGreaterThan(0);
  }
  const remoteEntryName = manifest.metaData?.remoteEntry?.name;
  expect(remoteEntryName).toBeTruthy();
  if (!remoteEntryName) {
    throw new Error('Expected remoteEntry name in mf-manifest');
  }

  const remoteEntryPath = manifest.metaData?.remoteEntry?.path || '';
  const normalizedRemoteEntryPath =
    remoteEntryPath === '' || remoteEntryPath.endsWith('/')
      ? remoteEntryPath
      : `${remoteEntryPath}/`;
  const remoteEntryUrl = new URL(
    `${normalizedRemoteEntryPath}${remoteEntryName}`,
    `http://localhost:${remotePort}/`,
  );
  const remoteEntryResponse = await fetch(remoteEntryUrl);
  expect(remoteEntryResponse.status).toBe(200);
  const remoteEntryContentType =
    remoteEntryResponse.headers.get('content-type') || '';
  expect(remoteEntryContentType).toContain('javascript');

  const remoteEntryCode = await remoteEntryResponse.text();
  expect(remoteEntryCode.startsWith('<!DOCTYPE html>')).toBe(false);
}

async function buildFederatedFixtureApp(
  appDir: string,
  env: Record<string, string>,
) {
  await modernBuild(appDir, [], {
    marker: /ready\s+built in/i,
    env,
  });
}

async function killAppBestEffort(app: unknown) {
  if (!app) {
    return;
  }
  try {
    await killApp(app);
  } catch (error) {
    if (isIgnorableWindowsTaskkillError(error)) {
      return;
    }
    throw error;
  }
}

async function stopFederatedApps(apps: unknown[]) {
  const results = await Promise.allSettled(apps.map(killAppBestEffort));
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) {
    throw rejected.reason;
  }
}

async function assertRemoteLoadFailureFallback(input: {
  page: Page;
  hostPort: number;
  mode: 'timeout' | 'network' | 'contract';
  target: 'remote/Widget' | 'remote/Mutator' | 'remote2/Panel';
  fallbackSelector:
    | '#remote-error'
    | '#remote-mutator-error'
    | '#remote2-error';
  expectedErrorName: 'RemoteLoadError' | 'RemoteComponentContractError';
}) {
  const url = new URL(`http://localhost:${input.hostPort}/mf`);
  url.searchParams.set('mfRemoteFailure', input.mode);
  url.searchParams.set('mfRemoteTarget', input.target);

  await input.page.goto(url.toString(), {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });
  await input.page.waitForSelector(input.fallbackSelector, {
    timeout: 50000,
  });

  const fallbackText = await input.page.$eval(
    input.fallbackSelector,
    el => el.textContent || '',
  );
  expect(fallbackText).toContain(
    `remote-load-error:${input.expectedErrorName}`,
  );

  const hostLoaderText = await input.page.$eval(
    '#host-loader',
    el => el.textContent || '',
  );
  expect(hostLoaderText).toBe('host-mf-loader');
}

async function assertRemoteComponentInteraction(
  page: Page,
  hostPort: number,
  errors: string[],
) {
  await page.goto(`http://localhost:${hostPort}/mf`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });

  await page.waitForSelector('#remote-widget', { timeout: 50000 });
  const remoteText = await page.$eval('#remote-widget', el => el.textContent);
  expect(remoteText).toContain('remote-widget:ok');
  const remoteWidgetStyle = await page.$eval('#remote-widget', el => {
    const style = window.getComputedStyle(el);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontWeight: style.fontWeight,
    };
  });
  expect(remoteWidgetStyle.color).toBe('rgb(124, 58, 237)');
  expect(remoteWidgetStyle.backgroundColor).toBe('rgb(243, 232, 255)');
  expect(remoteWidgetStyle.fontWeight).toBe('700');

  await page.waitForSelector('#remote-mutator', { timeout: 50000 });
  await page.waitForSelector('#remote2-panel', { timeout: 50000 });
  const remoteTwoText = await page.$eval(
    '#remote2-panel',
    el => el.textContent,
  );
  expect(remoteTwoText).toContain('remote2-panel:ok');
  const remoteTwoStyle = await page.$eval('#remote2-panel', el => {
    const style = window.getComputedStyle(el);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontWeight: style.fontWeight,
    };
  });
  expect(remoteTwoStyle.color).toBe('rgb(21, 128, 61)');
  expect(remoteTwoStyle.backgroundColor).toBe('rgb(240, 253, 244)');
  expect(remoteTwoStyle.fontWeight).toBe('700');

  const hostLoaderText = await page.$eval('#host-loader', el => el.textContent);
  expect(hostLoaderText).toBe('host-mf-loader');
  const hostLoaderStyle = await page.$eval('#host-loader', el => {
    const style = window.getComputedStyle(el);
    return {
      color: style.color,
      fontWeight: style.fontWeight,
    };
  });
  expect(hostLoaderStyle.color).toBe('rgb(3, 105, 161)');
  expect(hostLoaderStyle.fontWeight).toBe('700');
  await page.waitForFunction(
    () =>
      document.querySelector('#host-effect-message')?.textContent ===
      'host-effect:Hello from host Effect API',
    { timeout: 50000 },
  );

  const getHostCount = async () => {
    const text = await page.$eval('#host-mf-count', el => el.textContent || '');
    return Number(text.replace('host-mf-count:', ''));
  };

  const initialCount = await getHostCount();

  await page.click('[data-testid="remote-fetcher-submit"]');
  await page.waitForFunction(
    expected =>
      document.querySelector('#host-mf-count')?.textContent ===
      `host-mf-count:${expected}`,
    {},
    initialCount + 2,
  );

  await page.click('[data-testid="remote-fetcher-load"]');
  await page.waitForFunction(
    expected =>
      document.querySelector('#remote-fetcher-data')?.textContent ===
      `remote-fetcher:${expected}`,
    {},
    initialCount + 2,
  );
  expect(page.url()).toBe(`http://localhost:${hostPort}/mf`);

  const remoteFetcherState = await page.$eval(
    '#remote-fetcher-state',
    el => el.textContent,
  );
  expect(remoteFetcherState).toBe('idle');
  expect(errors).toEqual([]);
}

async function assertDistributedTraceFromBrowser(
  page: Page,
  hostPort: number,
  remotePort: number,
  errors: string[],
) {
  const initialErrorCount = errors.length;

  await page.goto(`http://localhost:${hostPort}/mf`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });

  const trace = createTraceparent();
  const runResult = (await page.evaluate(
    input =>
      fetch('/host-api/effect/trace/reset', {
        method: 'POST',
      }).then(resetHost =>
        fetch(
          `http://localhost:${input.remotePort}/remote-api/effect/trace/reset`,
          {
            method: 'POST',
          },
        ).then(resetRemote =>
          fetch('/host-api/effect/trace/run', {
            method: 'GET',
            headers: {
              traceparent: input.traceparent,
            },
          }).then(runResponse =>
            runResponse.json().then(runBody => ({
              resetHostStatus: resetHost.status,
              resetRemoteStatus: resetRemote.status,
              runStatus: runResponse.status,
              runBody,
            })),
          ),
        ),
      ),
    {
      traceparent: trace.traceparent,
      remotePort,
    },
  )) as {
    resetHostStatus: number;
    resetRemoteStatus: number;
    runStatus: number;
    runBody: {
      status?: 'ok';
      remoteStatus?: 'ok';
      traceparent?: string;
      remoteLocale?: string;
    };
  };

  expect(runResult.resetHostStatus).toBe(200);
  expect(runResult.resetRemoteStatus).toBe(200);
  expect(runResult.runStatus).toBe(200);
  expect(runResult.runBody).toEqual({
    status: 'ok',
    traceparent: trace.traceparent,
    remoteStatus: 'ok',
    remoteLocale: '*',
  });

  const hostTrace = await waitForTraceSpansWithFallback(
    `http://localhost:${hostPort}/host-api/effect/trace/spans`,
    trace.traceId,
    ['mf.host.trace.run', 'mf.host.trace.remote.call'],
  );
  const remoteTrace = await waitForTraceSpansWithFallback(
    `http://localhost:${remotePort}/remote-api/effect/trace/spans`,
    trace.traceId,
    ['mf.remote.trace.run', 'mf.remote.trace.db.query'],
  );
  const hostSpans = hostTrace.spans;
  const remoteSpans = remoteTrace.spans;

  const hostRunSpan = findLatestSpanByName(hostSpans, 'mf.host.trace.run');
  const hostRemoteCallSpan = findLatestSpanByName(
    hostSpans,
    'mf.host.trace.remote.call',
  );
  const remoteRunSpan = findLatestSpanByName(
    remoteSpans,
    'mf.remote.trace.run',
  );
  const remoteDbSpan = findLatestSpanByName(
    remoteSpans,
    'mf.remote.trace.db.query',
  );

  expect(hostRunSpan).toBeDefined();
  expect(hostRemoteCallSpan).toBeDefined();
  expect(remoteRunSpan).toBeDefined();
  expect(remoteDbSpan).toBeDefined();

  if (!hostRunSpan || !hostRemoteCallSpan || !remoteRunSpan || !remoteDbSpan) {
    throw new Error('Expected distributed trace spans were not found');
  }

  if (hostTrace.strictTracePropagation && remoteTrace.strictTracePropagation) {
    expect(hostRunSpan.traceId).toBe(trace.traceId);
    expect(hostRemoteCallSpan.traceId).toBe(trace.traceId);
    expect(remoteRunSpan.traceId).toBe(trace.traceId);
    expect(remoteDbSpan.traceId).toBe(trace.traceId);

    expect(hostRunSpan.parentSpanId).toBe(trace.rootSpanId);
    expect(hostRemoteCallSpan.parentSpanId).toBe(hostRunSpan.spanId);
    expect(remoteRunSpan.parentSpanId).toBe(hostRemoteCallSpan.spanId);
    expect(remoteDbSpan.parentSpanId).toBe(remoteRunSpan.spanId);
  } else {
    expect(hostRunSpan.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(hostRemoteCallSpan.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(remoteRunSpan.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(remoteDbSpan.traceId).toMatch(/^[a-f0-9]{32}$/);
    if (hostRunSpan.traceId === hostRemoteCallSpan.traceId) {
      expect(hostRemoteCallSpan.parentSpanId).toBe(hostRunSpan.spanId);
    }
    if (remoteRunSpan.traceId === remoteDbSpan.traceId) {
      expect(remoteDbSpan.parentSpanId).toBe(remoteRunSpan.spanId);
    }
  }

  expect(errors.slice(initialErrorCount)).toEqual([]);
}

describe('routes-tanstack-mf', () => {
  let remoteApp: unknown;
  let remoteTwoApp: unknown;
  let hostApp: unknown;
  let browser: Browser;
  let page: Page;
  let ports: FederatedPorts;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;
  const errors: string[] = [];

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(fixtureRoot);
    ports = await createFederatedPorts();
    const env = createFederatedEnv(ports);

    runTypecheck(remoteDir, 'tsconfig.typecheck.json');
    runTypecheck(remoteTwoDir, 'tsconfig.typecheck.json');
    runTypecheck(hostDir, 'tsconfig.typecheck.json');

    remoteApp = await launchApp(remoteDir, ports.remote, { env });
    await waitForAppReady(`http://localhost:${ports.remote}/mf-manifest.json`);

    remoteTwoApp = await launchApp(remoteTwoDir, ports.remoteTwo, { env });
    await waitForAppReady(
      `http://localhost:${ports.remoteTwo}/mf-manifest.json`,
    );

    hostApp = await launchApp(hostDir, ports.host, { env });
    await waitForAppReady(`http://localhost:${ports.host}/`);

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
  });

  afterAll(async () => {
    try {
      if (browser) {
        await browser.close();
      }
      await stopFederatedApps([hostApp, remoteTwoApp, remoteApp]);
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('keeps client-render boundary explicit for federated route content', async () => {
    const { status, html } = await fetchHtml(
      `http://localhost:${ports.host}/mf`,
    );
    expect(status).toBe(200);
    expect(html).toContain('<!--<?- html ?>-->');
    expect(html).not.toContain('host-mf-loader');
    expect(html).not.toContain('host-mf-count:');
    expect(html).not.toContain('remote-widget:ok');
    expect(html).not.toContain('id="remote-mutator"');
  });

  test('host app exposes effect bff endpoints in mf setup', async () => {
    const effectResponse = await fetchJson(
      `http://localhost:${ports.host}/host-api/effect/hello`,
    );
    expect(effectResponse.status).toBe(200);
    expect(effectResponse.json).toEqual({
      message: 'Hello from host Effect API',
      runtime: 'host',
    });

    const openapiResponse = await fetchJson(
      `http://localhost:${ports.host}/host-api/openapi.json`,
    );
    expect(openapiResponse.status).toBe(200);
    expect(openapiResponse.json.paths['/effect/hello']).toBeDefined();
  });

  test('remote app exposes effect bff endpoints in mf setup', async () => {
    const effectResponse = await fetchJson(
      `http://localhost:${ports.remote}/remote-api/effect/hello`,
    );
    expect(effectResponse.status).toBe(200);
    expect(effectResponse.json).toEqual({
      message: 'Hello from remote Effect API',
      runtime: 'remote',
    });

    const openapiResponse = await fetchJson(
      `http://localhost:${ports.remote}/remote-api/openapi.json`,
    );
    expect(openapiResponse.status).toBe(200);
    expect(openapiResponse.json.paths['/effect/hello']).toBeDefined();
  });

  test('remote2 app exposes effect bff endpoints in mf setup', async () => {
    const effectResponse = await fetchJson(
      `http://localhost:${ports.remoteTwo}/remote2-api/effect/hello`,
    );
    expect(effectResponse.status).toBe(200);
    expect(effectResponse.json).toEqual({
      message: 'Hello from remote2 Effect API',
      runtime: 'remote2',
    });
  });

  test('supports remote component fetcher with host loader/action', async () => {
    await assertRemoteComponentInteraction(page, ports.host, errors);
  });

  test('supports deterministic remote failure injection fallbacks', async () => {
    await assertRemoteLoadFailureFallback({
      page,
      hostPort: ports.host,
      mode: 'timeout',
      target: 'remote/Widget',
      fallbackSelector: '#remote-error',
      expectedErrorName: 'RemoteLoadError',
    });
    await assertRemoteLoadFailureFallback({
      page,
      hostPort: ports.host,
      mode: 'contract',
      target: 'remote/Widget',
      fallbackSelector: '#remote-error',
      expectedErrorName: 'RemoteComponentContractError',
    });
  });

  test('emits tree-shaking metadata for shared modules', async () => {
    await assertSharedTreeShakingStats(ports.host);
    await assertSharedTreeShakingStats(ports.remote);
    await assertSharedTreeShakingStats(ports.remoteTwo);
  });

  test('captures browser -> host -> remote distributed otel trace', async () => {
    await assertDistributedTraceFromBrowser(
      page,
      ports.host,
      ports.remote,
      errors,
    );
  });

  test('propagates accept-language through host -> remote effect trace run', async () => {
    await assertEffectLocalePropagation(page, ports.host, ports.remote, errors);
  });
});

describe('routes-tanstack-mf serve mode', () => {
  let remoteApp: unknown;
  let remoteTwoApp: unknown;
  let hostApp: unknown;
  let browser: Browser;
  let page: Page;
  let ports: FederatedPorts;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;
  const errors: string[] = [];

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(fixtureRoot);
    ports = await createFederatedPorts();
    const env = createFederatedEnv(ports);

    runTypecheck(remoteDir, 'tsconfig.typecheck.json');
    runTypecheck(remoteTwoDir, 'tsconfig.typecheck.json');
    runTypecheck(hostDir, 'tsconfig.typecheck.json');

    await buildFederatedFixtureApp(remoteDir, env);
    await buildFederatedFixtureApp(remoteTwoDir, env);
    await buildFederatedFixtureApp(hostDir, env);

    remoteApp = await modernServe(remoteDir, ports.remote, { env });
    await waitForAppReady(`http://localhost:${ports.remote}/mf-manifest.json`);

    remoteTwoApp = await modernServe(remoteTwoDir, ports.remoteTwo, {
      env,
    });
    await waitForAppReady(
      `http://localhost:${ports.remoteTwo}/mf-manifest.json`,
    );

    hostApp = await modernServe(hostDir, ports.host, { env });
    await waitForAppReady(`http://localhost:${ports.host}/`);

    browser = await puppeteer.launch(launchOptions as any);
    page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
  });

  afterAll(async () => {
    try {
      if (browser) {
        await browser.close();
      }
      await stopFederatedApps([hostApp, remoteTwoApp, remoteApp]);
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('serves module federation assets as static files', async () => {
    await assertModuleFederationAssets(ports.remote);
    await assertModuleFederationAssets(ports.remoteTwo);
  });

  test('supports remote component fetcher with host loader/action in serve mode', async () => {
    await assertRemoteComponentInteraction(page, ports.host, errors);
  });

  test('supports deterministic remote network fallback in serve mode', async () => {
    await assertRemoteLoadFailureFallback({
      page,
      hostPort: ports.host,
      mode: 'network',
      target: 'remote2/Panel',
      fallbackSelector: '#remote2-error',
      expectedErrorName: 'RemoteLoadError',
    });
  });

  test('serves tree-shaking metadata for shared modules in serve mode', async () => {
    await assertSharedTreeShakingStats(ports.host);
    await assertSharedTreeShakingStats(ports.remote);
    await assertSharedTreeShakingStats(ports.remoteTwo);
  });

  test('captures browser -> host -> remote distributed otel trace in serve mode', async () => {
    await assertDistributedTraceFromBrowser(
      page,
      ports.host,
      ports.remote,
      errors,
    );
  });

  test('propagates accept-language through host -> remote effect trace run in serve mode', async () => {
    await assertEffectLocalePropagation(page, ports.host, ports.remote, errors);
  });
});
