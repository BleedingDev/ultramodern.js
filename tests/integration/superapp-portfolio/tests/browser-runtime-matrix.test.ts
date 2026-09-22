import dns from 'node:dns';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  createBrowserRuntimeArtifactPaths,
  finishBrowserRuntimeArtifacts,
  startBrowserRuntimeTrace,
} from './browserRuntimeArtifacts';
import {
  createBrowserRuntimePage,
  launchRuntimeBrowser,
} from './browserRuntimeFixture';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 12);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const defaultDistRoot = 'dist-browser-runtime-matrix-default';
const assetPrefixDistRoot = 'dist-browser-runtime-matrix-asset-prefix';
const matrixDistRoots = [defaultDistRoot, assetPrefixDistRoot];
const matrixAssetPrefix = '/superapp-browser-runtime-assets/';
const defaultProductionEnv = {
  SUPERAPP_PORTFOLIO_DIST_ROOT: defaultDistRoot,
  SUPERAPP_PORTFOLIO_FORCE_CSR: '1',
};

function cleanMatrixDistRoots() {
  for (const distRoot of matrixDistRoots) {
    rmSync(path.join(appDir, distRoot), { force: true, recursive: true });
  }
}

function readRouteAssets(distRoot: string) {
  const manifest = JSON.parse(
    readFileSync(path.join(appDir, distRoot, 'routes-manifest.json'), 'utf8'),
  ) as {
    routeAssets?: {
      index?: {
        assets?: unknown;
      };
    };
  };
  const assets = manifest.routeAssets?.index?.assets;
  if (
    !Array.isArray(assets) ||
    !assets.every(asset => typeof asset === 'string')
  ) {
    throw new Error(
      'routes-manifest.json does not contain index asset references',
    );
  }
  return assets as string[];
}

async function buildProduction(distRoot: string, env: Record<string, string>) {
  const result = await modernBuild(appDir, [], {
    env,
    stderr: false,
    stdout: false,
  });
  if (result.code !== 0) {
    throw new Error(
      `modern build failed for ${distRoot} with code ${result.code}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return readRouteAssets(distRoot);
}

async function expectPortfolioHome(page: Page) {
  await page.getByTestId('portfolio-ready').waitFor();
  await page.getByTestId('pilot-command-center').waitFor();
  await page.waitForFunction(() => {
    return document
      .querySelector('[data-testid="shell-mode"]')
      ?.textContent?.includes('tanstack-effect-superapp-portfolio');
  });
  await page.waitForFunction(() => {
    return (
      document.querySelector('[data-testid="summary-apps"]')?.textContent ===
      'apps:5'
    );
  });
  expect(new URL(page.url()).pathname).toBe('/');
}

async function createRuntimePage(browser: Browser, testId: string) {
  const artifactPaths = createBrowserRuntimeArtifactPaths(testId);
  const { context, diagnostics, page } =
    await createBrowserRuntimePage(browser);
  await startBrowserRuntimeTrace(context);
  return { ...artifactPaths, context, diagnostics, page, testId };
}

async function finishRuntimePage(
  runtimePage: Awaited<ReturnType<typeof createRuntimePage>>,
  failed: boolean,
) {
  try {
    await finishBrowserRuntimeArtifacts({
      artifactDir: runtimePage.artifactDir,
      context: runtimePage.context,
      diagnostics: runtimePage.diagnostics,
      failed,
      page: runtimePage.page,
      testId: runtimePage.testId,
      videoDir: runtimePage.videoDir,
    });
  } finally {
    await runtimePage.context.close();
  }
}

async function fetchStaticAsset(port: number, pathname: string) {
  const response = await fetch(`${host}:${port}${pathname}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type') ?? '').toContain('javascript');
  await response.body?.cancel();
}

describe('superapp portfolio browser runtime boundaries', () => {
  let browser: Browser | undefined;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;
  const runningApps: unknown[] = [];

  beforeAll(async () => {
    releaseFixtureLock = await acquireFixtureLock(appDir);
    cleanMatrixDistRoots();
    browser = await launchRuntimeBrowser();
  });

  afterAll(async () => {
    try {
      await Promise.all(runningApps.splice(0).map(app => killApp(app)));
      await browser?.close();
      cleanMatrixDistRoots();
    } finally {
      await releaseFixtureLock?.();
    }
  });

  test('keeps SSR and forced-CSR entry points executable', async () => {
    await buildProduction(defaultDistRoot, defaultProductionEnv);
    const port = await getPort();
    const app = await modernServe(appDir, port, {
      env: defaultProductionEnv,
      stderr: false,
      stdout: false,
    });
    runningApps.push(app);
    const runtimePage = await createRuntimePage(browser!, 'ssr-forced-csr');
    let noJsContext: BrowserContext | undefined;
    let failed = false;

    try {
      noJsContext = await browser!.newContext({
        javaScriptEnabled: false,
      });
      const noJsPage = await noJsContext.newPage();
      const ssrResponse = await noJsPage.goto(`${host}:${port}`);
      expect(ssrResponse?.status()).toBe(200);
      await expect(noJsPage.locator('h1').textContent()).resolves.toBe(
        'Validation Portfolio',
      );

      const csrResponse = await noJsPage.goto(`${host}:${port}/?csr=true`);
      expect(csrResponse?.status()).toBe(200);
      expect(await noJsPage.locator('h1').count()).toBe(0);

      await runtimePage.page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(runtimePage.page);
      await runtimePage.page.goto(`${host}:${port}/?csr=true`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(runtimePage.page);
      expect(runtimePage.diagnostics.errors).toEqual([]);
      expect(runtimePage.diagnostics.hydrationWarnings).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await noJsContext?.close();
      await finishRuntimePage(runtimePage, failed);
    }
  });

  test('serves browser assets through the configured prefix', async () => {
    const env = {
      SUPERAPP_PORTFOLIO_ASSET_PREFIX: matrixAssetPrefix,
      SUPERAPP_PORTFOLIO_DIST_ROOT: assetPrefixDistRoot,
    };
    const assets = await buildProduction(assetPrefixDistRoot, env);
    const scriptAssets = assets.filter(asset => asset.endsWith('.js'));
    expect(scriptAssets.length).toBeGreaterThan(0);
    expect(assets.every(asset => asset.startsWith(matrixAssetPrefix))).toBe(
      true,
    );

    const port = await getPort();
    const app = await modernServe(appDir, port, {
      env,
      stderr: false,
      stdout: false,
    });
    runningApps.push(app);
    const runtimePage = await createRuntimePage(browser!, 'asset-prefix');
    let failed = false;

    try {
      await fetchStaticAsset(port, scriptAssets[0]);
      await runtimePage.page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(runtimePage.page);
      const loadedAssetPaths = await runtimePage.page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map(entry => new URL(entry.name).pathname)
          .filter(pathname => pathname.includes('/static/')),
      );
      expect(
        loadedAssetPaths.some(pathname =>
          pathname.startsWith(`${matrixAssetPrefix}static/`),
        ),
      ).toBe(true);
      expect(runtimePage.diagnostics.errors).toEqual([]);
      expect(runtimePage.diagnostics.brokenResources).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
    }
  });
});
