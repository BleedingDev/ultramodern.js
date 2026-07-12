import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { ensurePluginDataLoaderRuntimeBuilt } from './pluginDataLoaderRuntime';

setSuiteTimeout(1000 * 60 * 10);

const enabled = process.env.SUPERAPP_MF_CERTIFICATION === '1';
const fixtureRoot = path.resolve(__dirname, '..');
const remoteDir = path.resolve(fixtureRoot, 'mf-remote');
const remoteTwoDir = path.resolve(fixtureRoot, 'mf-remote-2');
const hostDir = path.resolve(fixtureRoot, 'mf-host');
const stagedArtifactsRoot = path.join(fixtureRoot, '.deploy-artifacts');
const artifactDir =
  process.env.SUPERAPP_MF_CERTIFICATION_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-mf-certification';
const expectedFallbackConsoleErrors = [
  'RemoteLoadError: Unable to load remote "remote2/Panel" after 1 attempt: network failure injection',
  'RemoteComponentContractError: Remote "remote/Widget" export "default" is not a valid React component',
];

type Check = {
  id: string;
  ok: boolean;
  detail?: Record<string, unknown>;
};

type Ports = {
  host: number;
  remote: number;
  remoteTwo: number;
};

async function createPorts(): Promise<Ports> {
  const ports = new Set<number>();
  while (ports.size < 3) {
    ports.add(await getPort());
  }
  const [remote, remoteTwo, host] = [...ports];
  return { host, remote, remoteTwo };
}

function createEnv(ports: Ports) {
  return {
    MF_HOST_PORT: String(ports.host),
    MF_REMOTE_PORT: String(ports.remote),
    MF_REMOTE_TWO_PORT: String(ports.remoteTwo),
    MF_HOST_ORIGIN: `http://localhost:${ports.host}`,
    MF_REMOTE_ORIGIN: `http://localhost:${ports.remote}`,
  };
}

async function waitForReady(url: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function buildApp(appDir: string, env: Record<string, string>) {
  await ensurePluginDataLoaderRuntimeBuilt();
  let result:
    | {
        code: number | null;
        stdout?: string;
        stderr?: string;
      }
    | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    rmSync(path.join(appDir, 'dist'), {
      recursive: true,
      force: true,
    });
    result = await modernBuild(appDir, [], { env });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.code === 0 || !output.includes('ENOTEMPTY')) {
      break;
    }
  }

  if (!result || result.code !== 0) {
    throw new Error(
      `Build failed for ${path.basename(appDir)}\n${result?.stdout || ''}\n${
        result?.stderr || ''
      }`,
    );
  }
}

function stageBuiltApp(appDir: string) {
  const stagedAppRoot = path.join(stagedArtifactsRoot, path.basename(appDir));
  const builtEffectEntry = path.join(
    appDir,
    'dist',
    'api',
    'effect',
    'index.js',
  );
  expect(existsSync(builtEffectEntry)).toBe(true);
  rmSync(stagedAppRoot, { recursive: true, force: true });
  mkdirSync(stagedAppRoot, { recursive: true });
  cpSync(path.join(appDir, 'dist'), path.join(stagedAppRoot, 'dist'), {
    recursive: true,
  });
  cpSync(
    path.join(appDir, 'package.json'),
    path.join(stagedAppRoot, 'package.json'),
  );
  for (const configFile of [
    'modern.config.ts',
    'module-federation.config.ts',
  ]) {
    cpSync(path.join(appDir, configFile), path.join(stagedAppRoot, configFile));
  }
  symlinkSync(
    path.join(appDir, 'node_modules'),
    path.join(stagedAppRoot, 'node_modules'),
    'junction',
  );
  expect(existsSync(path.join(stagedAppRoot, 'api'))).toBe(false);
  expect(existsSync(path.join(stagedAppRoot, 'src'))).toBe(false);
  expect(
    existsSync(path.join(stagedAppRoot, 'dist', 'api', 'effect', 'index.ts')),
  ).toBe(false);
  return stagedAppRoot;
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function certifyRemoteAssets(port: number, remoteName: string) {
  const origin = `http://localhost:${port}`;
  const manifest = (await fetchJson(`${origin}/mf-manifest.json`)) as {
    metaData?: {
      publicPath?: string;
      remoteEntry?: {
        name?: string;
        path?: string;
      };
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

  expect(manifest.metaData?.publicPath).toBe(`${origin}/`);
  expect((manifest.exposes || []).length).toBeGreaterThan(0);
  for (const expose of manifest.exposes || []) {
    expect(expose.path).toMatch(/^\.\//);
    expect((expose.assets?.js?.sync || []).length).toBeGreaterThan(0);
  }

  const remoteEntryName = manifest.metaData?.remoteEntry?.name;
  expect(remoteEntryName).toBeTruthy();
  const remoteEntryPath = manifest.metaData?.remoteEntry?.path || '';
  const remoteEntryUrl = new URL(
    `${remoteEntryPath}${remoteEntryName}`,
    `${origin}/`,
  );
  const remoteEntry = await fetch(remoteEntryUrl);
  expect(remoteEntry.status).toBe(200);
  expect(remoteEntry.headers.get('content-type') || '').toContain('javascript');
  expect(await remoteEntry.text()).not.toMatch(/^<!DOCTYPE html>/);

  return {
    id: `asset-prefix:${remoteName}`,
    ok: true,
    detail: {
      publicPath: manifest.metaData?.publicPath,
      exposes: (manifest.exposes || []).map(expose => expose.name),
      remoteEntryUrl: remoteEntryUrl.toString(),
    },
  };
}

async function certifySsrBoundary(hostPort: number) {
  const response = await fetch(`http://localhost:${hostPort}/mf`, {
    headers: {
      accept: 'text/html',
    },
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).not.toContain('<!--<?- html ?>-->');
  expect(html).toContain('host-mf-loader');
  expect(html).toContain('host-mf-count:');
  expect(html).toContain('id="remote-ssr-fallback-contract"');
  expect(html).toContain(
    'data-ssr-contract="typed-ssr-fallback-client-hydration"',
  );
  expect(html).toContain(
    'data-runtime-boundary="tanstack-mf-client-hydration"',
  );
  expect(html).toContain('id="remote-ssr-fallback-metadata"');
  expect(html).toContain('"contract":"typed-ssr-fallback-client-hydration"');
  expect(html).toContain('"strategy":"client-hydration"');
  expect(html).toContain('"reason":"remote-unavailable"');
  expect(html).toContain('"classification":"remote-unavailable"');
  expect(html).toContain('"telemetryEvent":"mf.ssr.remote.fallback"');
  expect(html).toContain('remote-widget:pending');
  expect(html).toContain('remote-mutator:pending');
  expect(html).toContain('remote2-panel:pending');
  expect(html).not.toContain('remote-widget:ok');
  expect(html).not.toContain('id="remote-mutator"');
  expect(html).not.toContain('remote2-panel:ok');
  return {
    id: 'ssr-shell-typed-fallback-boundary',
    ok: true,
  };
}

async function certifyRedirectAndNotFound(hostPort: number) {
  const redirectResponse = await fetch(
    `http://localhost:${hostPort}/mf-redirect`,
    {
      headers: {
        accept: 'text/html',
      },
      redirect: 'manual',
    },
  );
  expect(redirectResponse.status).toBe(307);
  expect(redirectResponse.headers.get('location')).toBe('/mf');

  const notFoundResponse = await fetch(
    `http://localhost:${hostPort}/mf-not-found`,
    {
      headers: {
        accept: 'text/html',
      },
    },
  );
  const html = await notFoundResponse.text();
  expect(notFoundResponse.status).toBe(404);
  expect(html).toContain('404');
  expect(html).not.toContain('mf-not-found:unreachable');

  return {
    id: 'tanstack-loader-redirect-not-found',
    ok: true,
  };
}

async function certifyNativeRouterRealmNavigation(
  page: Page,
  hostPort: number,
) {
  await page.goto(`http://localhost:${hostPort}/mf`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });
  await page.waitForSelector('[data-testid="remote-one-native-link"]', {
    timeout: 50000,
  });
  await page.waitForSelector('[data-testid="remote-two-native-link"]', {
    timeout: 50000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector('#host-boot-identity')?.textContent !== 'pending',
    { timeout: 50000 },
  );

  const readRouterState = () =>
    page.evaluate(() => ({
      hostBootIdentity: document.querySelector('#host-boot-identity')
        ?.textContent,
      navigationCount: performance.getEntriesByType('navigation').length,
      remoteOneIdentity: document
        .querySelector('#remote-one-runtime-realm')
        ?.getAttribute('data-router-realm'),
      remoteOneLocation: document.querySelector('#remote-one-router-location')
        ?.textContent,
      remoteTwoIdentity: document
        .querySelector('#remote-two-runtime-realm')
        ?.getAttribute('data-router-realm'),
      remoteTwoLocation: document.querySelector('#remote-two-router-location')
        ?.textContent,
      url: window.location.href,
    }));

  const initial = await readRouterState();
  expect(initial.hostBootIdentity).toEqual(expect.any(String));
  expect(initial.hostBootIdentity).not.toBe('');
  expect(initial.remoteOneIdentity).toEqual(expect.any(String));
  expect(initial.remoteTwoIdentity).toEqual(expect.any(String));
  expect(initial.remoteOneIdentity).not.toBe(initial.remoteTwoIdentity);
  expect(initial.navigationCount).toBe(1);

  await page.click('[data-testid="remote-one-native-link"]');
  await page.waitForFunction(
    () => new URL(window.location.href).searchParams.get('remote') === 'one',
    { timeout: 50000 },
  );
  const afterRemoteOne = await readRouterState();
  expect(afterRemoteOne.url).toBe(`http://localhost:${hostPort}/mf?remote=one`);
  expect(afterRemoteOne.remoteOneLocation).toContain('remote=one');
  expect(afterRemoteOne.remoteTwoLocation).toContain('remote=one');
  expect(afterRemoteOne.hostBootIdentity).toBe(initial.hostBootIdentity);
  expect(afterRemoteOne.remoteOneIdentity).toBe(initial.remoteOneIdentity);
  expect(afterRemoteOne.remoteTwoIdentity).toBe(initial.remoteTwoIdentity);
  expect(afterRemoteOne.navigationCount).toBe(initial.navigationCount);

  await page.click('[data-testid="remote-two-native-link"]');
  await page.waitForFunction(
    () => new URL(window.location.href).searchParams.get('remote') === 'two',
    { timeout: 50000 },
  );
  const afterRemoteTwo = await readRouterState();
  expect(afterRemoteTwo.url).toBe(`http://localhost:${hostPort}/mf?remote=two`);
  expect(afterRemoteTwo.remoteTwoLocation).toContain('remote=two');
  expect(afterRemoteTwo.remoteOneLocation).toContain('remote=two');
  expect(afterRemoteTwo.hostBootIdentity).toBe(initial.hostBootIdentity);
  expect(afterRemoteTwo.remoteOneIdentity).toBe(initial.remoteOneIdentity);
  expect(afterRemoteTwo.remoteTwoIdentity).toBe(initial.remoteTwoIdentity);
  expect(afterRemoteTwo.navigationCount).toBe(initial.navigationCount);

  return {
    id: 'native-tanstack-navigation:isolated-remote-runtime-realms',
    ok: true,
    detail: {
      hostBootIdentity: initial.hostBootIdentity,
      navigationCount: initial.navigationCount,
      remoteOneIdentity: initial.remoteOneIdentity,
      remoteOneUrl: afterRemoteOne.url,
      remoteTwoIdentity: initial.remoteTwoIdentity,
      remoteTwoUrl: afterRemoteTwo.url,
    },
  };
}

async function certifyFallback(input: {
  page: Page;
  hostPort: number;
  mode: 'network' | 'contract';
  target: string;
  selector: string;
  expectedErrorName: string;
  expectedClassification: 'network' | 'contract';
}) {
  const url = new URL(`http://localhost:${input.hostPort}/mf`);
  url.searchParams.set('mfRemoteFailure', input.mode);
  url.searchParams.set('mfRemoteTarget', input.target);
  await input.page.goto(url.toString(), {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });
  await input.page.waitForSelector(input.selector, { timeout: 50000 });
  const text = await input.page.$eval(input.selector, el => el.textContent);
  expect(text).toContain(`remote-load-error:${input.expectedErrorName}`);
  const classification = await input.page.$eval(input.selector, el =>
    el.getAttribute('data-mf-fallback-classification'),
  );
  const telemetryEvent = await input.page.$eval(input.selector, el =>
    el.getAttribute('data-mf-telemetry-event'),
  );
  expect(classification).toBe(input.expectedClassification);
  expect(telemetryEvent).toBe('mf.client.remote.fallback');
  return {
    id: `fallback:${input.mode}:${input.target}`,
    ok: true,
    detail: {
      selector: input.selector,
      text,
    },
  };
}

function writeSummary(checks: Check[]) {
  mkdirSync(artifactDir, { recursive: true });
  const summary = {
    schemaVersion: 1,
    suite: 'superapp-mf-deploy-certification',
    generatedAt: new Date().toISOString(),
    checkCount: checks.length,
    failedCount: checks.filter(check => !check.ok).length,
    checks,
  };
  writeFileSync(
    path.join(artifactDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

(enabled ? describe : describe.skip)(
  'routes-tanstack-mf deploy certification',
  () => {
    let ports: Ports;
    let releaseFixtureLock: ReleaseFixtureLock | undefined;
    let hostApp: unknown;
    let remoteApp: unknown;
    let remoteTwoApp: unknown;
    let browser: Browser;
    let page: Page;
    const checks: Check[] = [];
    const browserErrors: string[] = [];

    beforeAll(async () => {
      releaseFixtureLock = await acquireFixtureLock(fixtureRoot);
      ports = await createPorts();
      const env = createEnv(ports);

      await buildApp(remoteDir, env);
      await buildApp(remoteTwoDir, env);
      await buildApp(hostDir, env);

      const remoteArtifactRoot = stageBuiltApp(remoteDir);
      const remoteTwoArtifactRoot = stageBuiltApp(remoteTwoDir);
      const hostArtifactRoot = stageBuiltApp(hostDir);

      remoteApp = await modernServe(remoteArtifactRoot, ports.remote, { env });
      await waitForReady(`http://localhost:${ports.remote}/mf-manifest.json`);
      remoteTwoApp = await modernServe(remoteTwoArtifactRoot, ports.remoteTwo, {
        env,
      });
      await waitForReady(
        `http://localhost:${ports.remoteTwo}/mf-manifest.json`,
      );
      hostApp = await modernServe(hostArtifactRoot, ports.host, { env });
      await waitForReady(`http://localhost:${ports.host}/`);

      browser = await puppeteer.launch(launchOptions as any);
      page = await browser.newPage();
      page.on('console', message => {
        if (message.type() === 'error') {
          browserErrors.push(message.text());
        }
      });
      page.on('pageerror', error => {
        browserErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      });
    });

    afterAll(async () => {
      try {
        if (browser) {
          await browser.close();
        }
        await Promise.all([hostApp, remoteTwoApp, remoteApp].map(killApp));
      } finally {
        rmSync(stagedArtifactsRoot, { recursive: true, force: true });
        await releaseFixtureLock?.();
      }
    });

    afterEach(() => {
      writeSummary(checks);
    });

    test('certifies deploy-like MF assets and deterministic fallbacks', async () => {
      checks.push(await certifyRemoteAssets(ports.remote, 'remote'));
      checks.push(await certifyRemoteAssets(ports.remoteTwo, 'remote2'));
      checks.push(await certifySsrBoundary(ports.host));
      checks.push(await certifyRedirectAndNotFound(ports.host));
      checks.push(await certifyNativeRouterRealmNavigation(page, ports.host));
      checks.push(
        await certifyFallback({
          page,
          hostPort: ports.host,
          mode: 'network',
          target: 'remote2/Panel',
          selector: '#remote2-error',
          expectedErrorName: 'RemoteLoadError',
          expectedClassification: 'network',
        }),
      );
      checks.push(
        await certifyFallback({
          page,
          hostPort: ports.host,
          mode: 'contract',
          target: 'remote/Widget',
          selector: '#remote-error',
          expectedErrorName: 'RemoteComponentContractError',
          expectedClassification: 'contract',
        }),
      );

      const summary = writeSummary(checks);
      const unexpectedBrowserErrors = browserErrors.filter(
        error =>
          !expectedFallbackConsoleErrors.some(expected =>
            error.includes(expected),
          ),
      );
      expect(summary.failedCount).toBe(0);
      expect(unexpectedBrowserErrors).toEqual([]);
    });
  },
);
