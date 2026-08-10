import crypto from 'node:crypto';
import dns from 'node:dns';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  acquireFixtureLock,
  type ReleaseFixtureLock,
} from '../../../utils/fixtureLock';
import {
  getPort,
  killApp,
  launchApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import {
  captureBrowserRuntimeDiagnostics,
  createBrowserRuntimeArtifactPaths,
  finishBrowserRuntimeArtifacts,
  startBrowserRuntimeTrace,
} from './browserRuntimeArtifacts';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 15);

type Browser = any;
type BrowserContext = any;
type BrowserType = any;
type Page = any;

type MatrixEnv = Record<string, string>;

type BuildSnapshot = {
  digestByFile: Record<string, string>;
  routeAssets: Record<
    string,
    { assets?: string[]; referenceCssAssets?: string[] }
  >;
  scriptSrcs: string[];
  staticFiles: string[];
  styleHrefs: string[];
};

const requireFromRstestBrowserFixture = createRequire(
  path.resolve(__dirname, '../../rstest/basic-app-rstest-browser/package.json'),
);
const { chromium }: { chromium: BrowserType } =
  requireFromRstestBrowserFixture('playwright');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const defaultViewport = {
  width: 1440,
  height: 960,
};
const defaultDistRoot = 'dist-browser-runtime-matrix-default';
const devDistRoot = 'dist-browser-runtime-matrix-dev';
const assetPrefixDistRoot = 'dist-browser-runtime-matrix-asset-prefix';
const matrixDistRoots = [defaultDistRoot, devDistRoot, assetPrefixDistRoot];
const matrixAssetPrefix = '/superapp-browser-runtime-assets/';

function createMatrixEnv(
  distRoot: string,
  overrides: MatrixEnv = {},
): MatrixEnv {
  return {
    SUPERAPP_PORTFOLIO_DIST_ROOT: distRoot,
    ...overrides,
  };
}

const defaultProductionEnv = createMatrixEnv(defaultDistRoot, {
  SUPERAPP_PORTFOLIO_FORCE_CSR: '1',
});

function matrixDistPath(distRoot: string) {
  return path.join(appDir, distRoot);
}

function cleanMatrixDistRoots() {
  for (const distRoot of matrixDistRoots) {
    rmSync(matrixDistPath(distRoot), { force: true, recursive: true });
  }
}

function hashText(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(filePath: string) {
  return hashText(readFileSync(filePath, 'utf-8'));
}

function normalizeRelativePath(filePath: string) {
  return filePath.split(path.sep).join('/');
}

async function collectRelativeFiles(
  rootDir: string,
  currentDir = rootDir,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(rootDir, entryPath)));
      continue;
    }

    files.push(normalizeRelativePath(path.relative(rootDir, entryPath)));
  }

  return files.sort();
}

async function collectBuildSnapshot(
  browser: Browser,
  distRoot: string,
): Promise<BuildSnapshot> {
  const distDir = matrixDistPath(distRoot);
  const htmlPath = path.join(distDir, 'html/index/index.html');
  const routeAssetsPath = path.join(distDir, 'routes-manifest.json');
  const staticDir = path.join(distDir, 'static');
  const routeAssets = JSON.parse(
    readFileSync(routeAssetsPath, 'utf-8'),
  ).routeAssets;
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  const { scriptSrcs, styleHrefs } = await page.evaluate(() => ({
    scriptSrcs: [...document.scripts]
      .map(script => script.getAttribute('src'))
      .filter((src): src is string => src?.includes('/static/') ?? false)
      .sort(),
    styleHrefs: [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ]
      .map(link => link.getAttribute('href'))
      .filter((href): href is string => href?.includes('/static/') ?? false)
      .sort(),
  }));
  await context.close();
  const staticFiles = (await collectRelativeFiles(staticDir)).filter(
    file => !file.endsWith('.map') && !file.endsWith('.LICENSE.txt'),
  );
  const digestFiles = [
    'html/index/index.html',
    'loadable-stats.json',
    'nestedRoutes.json',
    'route.json',
    'routes-manifest.json',
    'static/css/index.css',
    'static/js/index.js',
  ];
  const digestByFile = Object.fromEntries(
    digestFiles.map(file => [file, hashFile(path.join(distDir, file))]),
  );

  return {
    digestByFile,
    routeAssets,
    scriptSrcs,
    staticFiles,
    styleHrefs,
  };
}

async function buildAndSnapshot(input: {
  browser: Browser;
  distRoot: string;
  env: MatrixEnv;
  label: string;
}) {
  const result = await modernBuild(appDir, [], {
    env: input.env,
    stderr: false,
    stdout: false,
  });
  if (result.code !== 0) {
    throw new Error(
      `modern build failed for ${input.label} with code ${result.code}\n${
        result.stdout ?? ''
      }\n${result.stderr ?? ''}`,
    );
  }

  return collectBuildSnapshot(input.browser, input.distRoot);
}

async function resetPortfolio(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/reset`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
}

async function getByTestIdText(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element: HTMLElement) => {
    return element.textContent ?? '';
  });
}

async function expectByTestIdTextContaining(
  page: Page,
  testId: string,
  expected: string,
) {
  await page.waitForFunction(
    ({ expected, testId }: { expected: string; testId: string }) => {
      return document
        .querySelector(`[data-testid="${testId}"]`)
        ?.textContent?.includes(expected);
    },
    { expected, testId },
  );
  await expect(getByTestIdText(page, testId)).resolves.toContain(expected);
}

async function expectPortfolioHome(page: Page) {
  await page.getByTestId('portfolio-ready').waitFor();
  await page.getByTestId('pilot-command-center').waitFor();
  await expectByTestIdTextContaining(
    page,
    'shell-mode',
    'tanstack-effect-superapp-portfolio',
  );
  await expectByTestIdTextContaining(page, 'summary-apps', 'apps:5');
  expect(new URL(page.url()).pathname).toBe('/');
}

async function createRuntimePage(browser: Browser, testId: string) {
  const artifactPaths = createBrowserRuntimeArtifactPaths(testId);
  const context: BrowserContext = await browser.newContext({
    viewport: defaultViewport,
    recordVideo: {
      dir: artifactPaths.videoDir,
    },
  });
  await startBrowserRuntimeTrace(context);
  const page = await context.newPage();
  const diagnostics = captureBrowserRuntimeDiagnostics(page);

  return {
    ...artifactPaths,
    context,
    diagnostics,
    errors: diagnostics.errors,
    page,
    testId,
  };
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

async function writeMatrixArtifact(
  testId: string,
  summary: Record<string, unknown>,
) {
  const { artifactDir } = createBrowserRuntimeArtifactPaths(testId);
  await writeFile(
    path.join(artifactDir, 'summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suite: 'superapp-portfolio-browser-runtime-matrix',
        testId,
        ...summary,
      },
      null,
      2,
    )}\n`,
  );
}

async function startDevServer(env: MatrixEnv) {
  const port = await getPort();
  const startedAt = Date.now();
  const app = await launchApp(
    appDir,
    port,
    {
      stderr: false,
      stdout: false,
    },
    env,
  );

  return {
    app,
    coldStartMs: Date.now() - startedAt,
    port,
  };
}

async function startProductionServer(env: MatrixEnv) {
  const port = await getPort();
  const startedAt = Date.now();
  const app = await modernServe(appDir, port, {
    env,
    stderr: false,
    stdout: false,
  });

  return {
    app,
    coldStartMs: Date.now() - startedAt,
    port,
  };
}

async function fetchStaticAsset(port: number, pathname: string) {
  const response = await fetch(`${host}:${port}${pathname}`, {
    signal: AbortSignal.timeout(15000),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type') ?? '').toContain('javascript');
  await response.body?.cancel();
}

describe('superapp portfolio runtime/build matrix coverage', () => {
  let browser: Browser | undefined;
  let defaultBuildSnapshot: BuildSnapshot | undefined;
  let releaseFixtureLock: ReleaseFixtureLock | undefined;
  const runningApps: unknown[] = [];

  beforeAll(async () => {
    if (!existsSync(chromium.executablePath())) {
      throw new Error(
        'Playwright chromium executable is missing. Run playwright install before running superapp runtime/build matrix coverage.',
      );
    }

    releaseFixtureLock = await acquireFixtureLock(appDir);
    cleanMatrixDistRoots();
    browser = await chromium.launch();
  });

  afterAll(async () => {
    try {
      if (browser) {
        await browser.close();
      }
      await Promise.all(runningApps.splice(0).map(app => killApp(app)));
      cleanMatrixDistRoots();
    } finally {
      await releaseFixtureLock?.();
    }
  });

  async function stopApp(app: unknown) {
    const index = runningApps.indexOf(app);
    if (index >= 0) {
      runningApps.splice(index, 1);
    }
    await killApp(app);
  }

  async function ensureDefaultProductionBuild() {
    if (!defaultBuildSnapshot) {
      defaultBuildSnapshot = await buildAndSnapshot({
        browser: browser!,
        distRoot: defaultDistRoot,
        env: defaultProductionEnv,
        label: 'default-production',
      });
    }

    return defaultBuildSnapshot;
  }

  test('certifies dev cold start and browser runtime path', async () => {
    const env = createMatrixEnv(devDistRoot);
    const { app, coldStartMs, port } = await startDevServer(env);
    runningApps.push(app);
    const runtimePage = await createRuntimePage(browser!, 'dev-cold-start');
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      const response = await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      expect(response?.status()).toBe(200);
      await expectPortfolioHome(page);
      const runtimeEvidence = await page.evaluate(() => {
        return {
          resourceCount: performance.getEntriesByType('resource').length,
          title: document.title,
        };
      });

      expect(coldStartMs).toBeGreaterThanOrEqual(0);
      expect(coldStartMs).toBeLessThan(1000 * 60 * 2);
      expect(runtimeEvidence).toMatchObject({
        title: 'SuperApp Portfolio',
      });
      expect(runtimeEvidence.resourceCount).toBeGreaterThan(0);
      expect(errors).toEqual([]);

      await writeMatrixArtifact('dev-cold-start-summary', {
        coldStartMs,
        distRoot: devDistRoot,
        mode: 'dev',
        runtimeEvidence,
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
      await stopApp(app);
    }
  });

  test('certifies repeated production build, cold production serve, SSR, and forced CSR paths', async () => {
    const firstSnapshot = await buildAndSnapshot({
      browser: browser!,
      distRoot: defaultDistRoot,
      env: defaultProductionEnv,
      label: 'production-repeat-1',
    });
    const secondSnapshot = await buildAndSnapshot({
      browser: browser!,
      distRoot: defaultDistRoot,
      env: defaultProductionEnv,
      label: 'production-repeat-2',
    });
    defaultBuildSnapshot = secondSnapshot;
    expect(secondSnapshot).toEqual(firstSnapshot);

    const { app, coldStartMs, port } =
      await startProductionServer(defaultProductionEnv);
    runningApps.push(app);
    const runtimePage = await createRuntimePage(
      browser!,
      'production-ssr-csr-runtime-matrix',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      const noJsContext = await browser!.newContext({
        javaScriptEnabled: false,
      });
      const noJsPage = await noJsContext.newPage();
      const ssrResponse = await noJsPage.goto(`${host}:${port}`);
      expect(ssrResponse?.status()).toBe(200);
      const ssrHeading = await noJsPage.locator('h1').textContent();
      expect(ssrHeading).toBe('Validation Portfolio');

      const csrResponse = await noJsPage.goto(`${host}:${port}/?csr=true`);
      expect(csrResponse?.status()).toBe(200);
      const csrHeading = await noJsPage.locator('h1').count();
      expect(csrHeading).toBe(0);
      await noJsContext.close();

      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(page);
      await page.goto(`${host}:${port}/?csr=true`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(page);

      expect(coldStartMs).toBeGreaterThanOrEqual(0);
      expect(coldStartMs).toBeLessThan(1000 * 60 * 2);
      expect(errors).toEqual([]);

      await writeMatrixArtifact('production-ssr-csr-summary', {
        coldStartMs,
        distRoot: defaultDistRoot,
        mode: 'production-serve',
        repeatedBuild: {
          digestByFile: secondSnapshot.digestByFile,
          scriptSrcs: secondSnapshot.scriptSrcs,
          staticFiles: secondSnapshot.staticFiles,
          styleHrefs: secondSnapshot.styleHrefs,
        },
        ssr: {
          containsRenderedShell: ssrHeading === 'Validation Portfolio',
        },
        csr: {
          startsWithoutRenderedShell: csrHeading === 0,
        },
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
      await stopApp(app);
    }
  });

  test('certifies production asset-prefix build and serve path', async () => {
    const env = createMatrixEnv(assetPrefixDistRoot, {
      SUPERAPP_PORTFOLIO_ASSET_PREFIX: matrixAssetPrefix,
    });
    const snapshot = await buildAndSnapshot({
      browser: browser!,
      distRoot: assetPrefixDistRoot,
      env,
      label: 'asset-prefix-production',
    });
    const assetRefs = [...snapshot.scriptSrcs, ...snapshot.styleHrefs];

    expect(assetRefs.length).toBeGreaterThan(0);
    expect(assetRefs.every(ref => ref.startsWith(matrixAssetPrefix))).toBe(
      true,
    );
    expect(snapshot.routeAssets.index.assets).toEqual(
      expect.arrayContaining([
        `${matrixAssetPrefix}static/js/index.js`,
        `${matrixAssetPrefix}static/css/index.css`,
      ]),
    );

    const { app, coldStartMs, port } = await startProductionServer(env);
    runningApps.push(app);
    const runtimePage = await createRuntimePage(
      browser!,
      'asset-prefix-production-serve',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      const scriptSrc =
        snapshot.scriptSrcs.find(src => src.endsWith('/static/js/index.js')) ??
        snapshot.scriptSrcs[0];
      await fetchStaticAsset(port, scriptSrc);

      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(page);
      const loadedAssetPaths = await page.evaluate(() => {
        return performance
          .getEntriesByType('resource')
          .map(entry => new URL(entry.name).pathname)
          .filter(pathname => pathname.includes('/static/'));
      });

      expect(coldStartMs).toBeGreaterThanOrEqual(0);
      expect(
        loadedAssetPaths.some(pathname =>
          pathname.startsWith('/superapp-browser-runtime-assets/static/'),
        ),
      ).toBe(true);
      expect(errors).toEqual([]);

      await writeMatrixArtifact('asset-prefix-production-summary', {
        assetPrefix: matrixAssetPrefix,
        coldStartMs,
        distRoot: assetPrefixDistRoot,
        loadedAssetPaths,
        mode: 'production-serve',
        scriptSrc,
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
      await stopApp(app);
    }
  });

  test('certifies simulated MF fallback without browser load', async () => {
    await ensureDefaultProductionBuild();
    const { app, port } = await startProductionServer(defaultProductionEnv);
    runningApps.push(app);
    await resetPortfolio(port);

    const runtimePage = await createRuntimePage(
      browser!,
      'simulated-mf-fallback-runtime-matrix',
    );
    const { errors, page } = runtimePage;
    let failed = false;

    try {
      await page.goto(`${host}:${port}`, {
        waitUntil: 'networkidle',
      });
      await expectPortfolioHome(page);
      await page.getByTestId('pilot-chaos').selectOption('remote-down');
      await page.getByTestId('run-pilot').click();
      await expectByTestIdTextContaining(
        page,
        'pilot-status',
        'Grab-style Marketplace Surge:accepted:remote-down',
      );
      await expectByTestIdTextContaining(page, 'pilot-summary', 'fallbacks:1');
      await expectByTestIdTextContaining(
        page,
        'pilot-module-mf-remotes',
        'ok:degraded',
      );
      await expectByTestIdTextContaining(
        page,
        'pilot-production-checks',
        'checks:13',
      );

      await page.getByTestId('nav-mf-platform').click();
      await page
        .getByRole('heading', {
          name: 'Micro-Frontend Platform',
        })
        .waitFor();
      await expectByTestIdTextContaining(
        page,
        'app-route-kind',
        'module-federation',
      );
      expect(errors).toEqual([]);

      await writeMatrixArtifact('simulated-mf-fallback-summary', {
        fallbackKind: 'simulated-BFF-remote-down',
        mode: 'production-serve',
        note: 'This validates the SuperApp MF fallback contract through the deterministic pilot remote-down path; it does not run browser smoke during HTTP load.',
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await finishRuntimePage(runtimePage, failed);
      await stopApp(app);
    }
  });
});
