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

type AssetInventory = {
  other: string[];
  scripts: string[];
  styles: string[];
};

type RouteAssetReferences = {
  assets: string[];
  referenceCssAssets: string[];
};

type ApplicationRoute = {
  bundle: string | null;
  entryName: string | null;
  entryPath: string;
  isApi: boolean;
  isSpa: boolean;
  isSsr: boolean;
  urlPath: string;
};

type NestedRoute = {
  children: NestedRoute[];
  hasData: boolean;
  hasLoader: boolean;
  id: string;
  index: boolean;
  path: string | null;
  routeType: string;
};

type BuildArtifacts = {
  assetReferences: {
    document: {
      scripts: string[];
      styles: string[];
    };
    routes: Record<string, RouteAssetReferences>;
  };
  semanticInventory: {
    applicationRoutes: ApplicationRoute[];
    documentAssets: AssetInventory;
    entrypointAssets: Record<string, AssetInventory>;
    loadablePublicPath: string;
    nestedRoutes: Record<string, NestedRoute[]>;
    routeAssets: Record<
      string,
      {
        assets: AssetInventory;
        referenceStyles: string[];
      }
    >;
    staticAssets: AssetInventory;
  };
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

function artifactRecord(value: unknown, label: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function artifactArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value;
}

function artifactString(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function artifactBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }

  return value;
}

function artifactOptionalString(value: unknown, label: string) {
  return value === undefined ? null : artifactString(value, label);
}

function artifactStringArray(value: unknown, label: string) {
  return artifactArray(value, label).map((item, index) =>
    artifactString(item, `${label}[${index}]`),
  );
}

function readJsonArtifact(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
}

function canonicalStaticAssetName(asset: string) {
  const marker = 'static/';
  const markerIndex = asset.indexOf(marker);
  if (markerIndex < 0) {
    return asset;
  }

  return asset.slice(markerIndex);
}

function collectAssetInventory(assets: string[]): AssetInventory {
  const inventory: AssetInventory = {
    other: [],
    scripts: [],
    styles: [],
  };

  for (const asset of new Set(assets.map(canonicalStaticAssetName))) {
    if (asset.endsWith('.js') || asset.endsWith('.mjs')) {
      inventory.scripts.push(asset);
    } else if (asset.endsWith('.css')) {
      inventory.styles.push(asset);
    } else {
      inventory.other.push(asset);
    }
  }

  inventory.other.sort();
  inventory.scripts.sort();
  inventory.styles.sort();
  return inventory;
}

function parseRouteAssetReferences(distDir: string) {
  const filePath = path.join(distDir, 'routes-manifest.json');
  const root = artifactRecord(
    readJsonArtifact(filePath),
    'routes-manifest.json',
  );
  const routeAssets = artifactRecord(
    root.routeAssets,
    'routes-manifest.json routeAssets',
  );

  return Object.fromEntries(
    Object.entries(routeAssets).map(([routeId, value]) => {
      const route = artifactRecord(
        value,
        `routes-manifest.json routeAssets.${routeId}`,
      );
      return [
        routeId,
        {
          assets: artifactStringArray(
            route.assets,
            `routes-manifest.json routeAssets.${routeId}.assets`,
          ),
          referenceCssAssets: artifactStringArray(
            route.referenceCssAssets,
            `routes-manifest.json routeAssets.${routeId}.referenceCssAssets`,
          ),
        },
      ];
    }),
  ) as Record<string, RouteAssetReferences>;
}

function parseEntrypointAssets(distDir: string) {
  const root = artifactRecord(
    readJsonArtifact(path.join(distDir, 'loadable-stats.json')),
    'loadable-stats.json',
  );
  const entrypoints = artifactRecord(
    root.entrypoints,
    'loadable-stats.json entrypoints',
  );

  return {
    assets: Object.fromEntries(
      Object.entries(entrypoints).map(([entrypointName, value]) => {
        const entrypoint = artifactRecord(
          value,
          `loadable-stats.json entrypoints.${entrypointName}`,
        );
        const assets = artifactArray(
          entrypoint.assets,
          `loadable-stats.json entrypoints.${entrypointName}.assets`,
        ).map((asset, index) => {
          const assetRecord = artifactRecord(
            asset,
            `loadable-stats.json entrypoints.${entrypointName}.assets[${index}]`,
          );
          return artifactString(
            assetRecord.name,
            `loadable-stats.json entrypoints.${entrypointName}.assets[${index}].name`,
          );
        });

        return [entrypointName, collectAssetInventory(assets)];
      }),
    ) as Record<string, AssetInventory>,
    publicPath: artifactString(
      root.publicPath,
      'loadable-stats.json publicPath',
    ),
  };
}

function parseApplicationRoutes(distDir: string): ApplicationRoute[] {
  const root = artifactRecord(
    readJsonArtifact(path.join(distDir, 'route.json')),
    'route.json',
  );

  return artifactArray(root.routes, 'route.json routes')
    .map((value, index) => {
      const route = artifactRecord(value, `route.json routes[${index}]`);
      return {
        bundle: artifactOptionalString(
          route.bundle,
          `route.json routes[${index}].bundle`,
        ),
        entryName: artifactOptionalString(
          route.entryName,
          `route.json routes[${index}].entryName`,
        ),
        entryPath: artifactString(
          route.entryPath,
          `route.json routes[${index}].entryPath`,
        ),
        isApi:
          route.isApi === undefined
            ? false
            : artifactBoolean(route.isApi, `route.json routes[${index}].isApi`),
        isSpa: artifactBoolean(
          route.isSPA,
          `route.json routes[${index}].isSPA`,
        ),
        isSsr: artifactBoolean(
          route.isSSR,
          `route.json routes[${index}].isSSR`,
        ),
        urlPath: artifactString(
          route.urlPath,
          `route.json routes[${index}].urlPath`,
        ),
      };
    })
    .sort((left, right) => left.urlPath.localeCompare(right.urlPath));
}

function parseNestedRoute(value: unknown, label: string): NestedRoute {
  const route = artifactRecord(value, label);
  const children =
    route.children === undefined
      ? []
      : artifactArray(route.children, `${label}.children`).map((child, index) =>
          parseNestedRoute(child, `${label}.children[${index}]`),
        );

  return {
    children,
    hasData: route.data !== undefined,
    hasLoader: route.loader !== undefined,
    id: artifactString(route.id, `${label}.id`),
    index:
      route.index === undefined
        ? false
        : artifactBoolean(route.index, `${label}.index`),
    path: artifactOptionalString(route.path, `${label}.path`),
    routeType: artifactString(route.routeType, `${label}.routeType`),
  };
}

function parseNestedRoutes(distDir: string) {
  const root = artifactRecord(
    readJsonArtifact(path.join(distDir, 'nestedRoutes.json')),
    'nestedRoutes.json',
  );

  return Object.fromEntries(
    Object.entries(root).map(([entrypointName, value]) => [
      entrypointName,
      artifactArray(value, `nestedRoutes.json ${entrypointName}`).map(
        (route, index) =>
          parseNestedRoute(
            route,
            `nestedRoutes.json ${entrypointName}[${index}]`,
          ),
      ),
    ]),
  ) as Record<string, NestedRoute[]>;
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

async function collectBuildArtifacts(
  browser: Browser,
  distRoot: string,
): Promise<BuildArtifacts> {
  const distDir = matrixDistPath(distRoot);
  const htmlPath = path.join(distDir, 'html/index/index.html');
  const staticDir = path.join(distDir, 'static');
  const routeAssetReferences = parseRouteAssetReferences(distDir);
  const entrypointAssets = parseEntrypointAssets(distDir);
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

  return {
    assetReferences: {
      document: {
        scripts: scriptSrcs,
        styles: styleHrefs,
      },
      routes: routeAssetReferences,
    },
    semanticInventory: {
      applicationRoutes: parseApplicationRoutes(distDir),
      documentAssets: collectAssetInventory([...scriptSrcs, ...styleHrefs]),
      entrypointAssets: entrypointAssets.assets,
      loadablePublicPath: entrypointAssets.publicPath,
      nestedRoutes: parseNestedRoutes(distDir),
      routeAssets: Object.fromEntries(
        Object.entries(routeAssetReferences).map(([routeId, route]) => [
          routeId,
          {
            assets: collectAssetInventory(route.assets),
            referenceStyles: route.referenceCssAssets
              .map(canonicalStaticAssetName)
              .sort(),
          },
        ]),
      ),
      staticAssets: collectAssetInventory(
        staticFiles.map(file => `static/${file}`),
      ),
    },
  };
}

async function buildAndInspect(input: {
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

  return collectBuildArtifacts(input.browser, input.distRoot);
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
  let defaultBuildArtifacts: BuildArtifacts | undefined;
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
    if (!defaultBuildArtifacts) {
      defaultBuildArtifacts = await buildAndInspect({
        browser: browser!,
        distRoot: defaultDistRoot,
        env: defaultProductionEnv,
        label: 'default-production',
      });
    }

    return defaultBuildArtifacts;
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
    const firstBuild = await buildAndInspect({
      browser: browser!,
      distRoot: defaultDistRoot,
      env: defaultProductionEnv,
      label: 'production-repeat-1',
    });
    const secondBuild = await buildAndInspect({
      browser: browser!,
      distRoot: defaultDistRoot,
      env: defaultProductionEnv,
      label: 'production-repeat-2',
    });
    defaultBuildArtifacts = secondBuild;

    expect(secondBuild.semanticInventory).toEqual(firstBuild.semanticInventory);
    expect(
      secondBuild.semanticInventory.documentAssets.scripts.length,
    ).toBeGreaterThan(0);
    expect(
      secondBuild.semanticInventory.documentAssets.styles.length,
    ).toBeGreaterThan(0);
    expect(secondBuild.semanticInventory.entrypointAssets.index).toEqual(
      secondBuild.semanticInventory.documentAssets,
    );
    expect(secondBuild.semanticInventory.routeAssets.index).toEqual({
      assets: secondBuild.semanticInventory.documentAssets,
      referenceStyles: secondBuild.semanticInventory.documentAssets.styles,
    });
    const physicalAssets = new Set([
      ...secondBuild.semanticInventory.staticAssets.other,
      ...secondBuild.semanticInventory.staticAssets.scripts,
      ...secondBuild.semanticInventory.staticAssets.styles,
    ]);
    expect(
      [
        ...secondBuild.semanticInventory.documentAssets.scripts,
        ...secondBuild.semanticInventory.documentAssets.styles,
      ].every(asset => physicalAssets.has(asset)),
    ).toBe(true);
    expect(secondBuild.semanticInventory.applicationRoutes).toContainEqual({
      bundle: 'bundles/index.js',
      entryName: 'index',
      entryPath: 'html/index/index.html',
      isApi: false,
      isSpa: true,
      isSsr: true,
      urlPath: '/',
    });
    expect(secondBuild.semanticInventory.nestedRoutes.index).toMatchObject([
      {
        children: [
          { id: 'page', index: true, routeType: 'page' },
          { id: '$', path: '*', routeType: 'page' },
          {
            hasData: true,
            id: 'apps/(appId)/page',
            path: 'apps/:appId',
            routeType: 'page',
          },
        ],
        hasLoader: true,
        id: 'layout',
        routeType: 'layout',
      },
    ]);

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
      const cssEvidence = await page
        .getByTestId('portfolio-page')
        .evaluate((portfolioPage: HTMLElement) => {
          const shell = portfolioPage.closest<HTMLElement>('.portfolio-shell');
          const panel = portfolioPage.querySelector<HTMLElement>('.panel');
          if (!shell || !panel) {
            throw new Error('portfolio layout elements are missing');
          }

          const shellStyle = window.getComputedStyle(shell);
          const panelStyle = window.getComputedStyle(panel);
          return {
            panelBorderStyle: panelStyle.borderTopStyle,
            panelPadding: panelStyle.paddingTop,
            shellDisplay: shellStyle.display,
          };
        });
      expect(cssEvidence).toEqual({
        panelBorderStyle: 'solid',
        panelPadding: '20px',
        shellDisplay: 'grid',
      });
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
        repeatedBuild: secondBuild.semanticInventory,
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
    const buildArtifacts = await buildAndInspect({
      browser: browser!,
      distRoot: assetPrefixDistRoot,
      env,
      label: 'asset-prefix-production',
    });
    const assetRefs = [
      ...buildArtifacts.assetReferences.document.scripts,
      ...buildArtifacts.assetReferences.document.styles,
    ];

    expect(assetRefs.length).toBeGreaterThan(0);
    expect(assetRefs.every(ref => ref.startsWith(matrixAssetPrefix))).toBe(
      true,
    );
    expect(buildArtifacts.assetReferences.routes.index.assets).toEqual(
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
        buildArtifacts.assetReferences.document.scripts.find(src =>
          src.endsWith('/static/js/index.js'),
        ) ?? buildArtifacts.assetReferences.document.scripts[0];
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
