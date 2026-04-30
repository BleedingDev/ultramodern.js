import { mkdirSync, writeFileSync } from 'node:fs';
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

setSuiteTimeout(1000 * 60 * 10);

const enabled = process.env.SUPERAPP_MF_CERTIFICATION === '1';
const fixtureRoot = path.resolve(__dirname, '..');
const remoteDir = path.resolve(fixtureRoot, 'mf-remote');
const remoteTwoDir = path.resolve(fixtureRoot, 'mf-remote-2');
const hostDir = path.resolve(fixtureRoot, 'mf-host');
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
  const result = await modernBuild(appDir, [], { env });
  if (result.code !== 0) {
    throw new Error(
      `Build failed for ${path.basename(appDir)}\n${result.stdout || ''}\n${
        result.stderr || ''
      }`,
    );
  }
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
  expect(html).toContain('<!--<?- html ?>-->');
  expect(html).not.toContain('remote-widget:ok');
  expect(html).not.toContain('id="remote-mutator"');
  return {
    id: 'ssr-mf-client-boundary',
    ok: true,
  };
}

async function certifyFallback(input: {
  page: Page;
  hostPort: number;
  mode: 'network' | 'contract';
  target: string;
  selector: string;
  expectedErrorName: string;
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

      remoteApp = await modernServe(remoteDir, ports.remote, { env });
      await waitForReady(`http://localhost:${ports.remote}/mf-manifest.json`);
      remoteTwoApp = await modernServe(remoteTwoDir, ports.remoteTwo, { env });
      await waitForReady(
        `http://localhost:${ports.remoteTwo}/mf-manifest.json`,
      );
      hostApp = await modernServe(hostDir, ports.host, { env });
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
      checks.push(
        await certifyFallback({
          page,
          hostPort: ports.host,
          mode: 'network',
          target: 'remote2/Panel',
          selector: '#remote2-error',
          expectedErrorName: 'RemoteLoadError',
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
