import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildFixtureOnce } from '../../../utils/fixtureBuild';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

setSuiteTimeout(1000 * 60 * 12);

type Browser = any;
type BrowserContext = any;
type BrowserType = any;
type Page = any;

const requireFromRstestBrowserFixture = createRequire(
  path.resolve(__dirname, '../../rstest/basic-app-rstest-browser/package.json'),
);
const {
  chromium,
  devices,
  firefox,
  webkit,
}: {
  chromium: BrowserType;
  devices: Record<string, Record<string, unknown>>;
  firefox: BrowserType;
  webkit: BrowserType;
} = requireFromRstestBrowserFixture('playwright');

type AppTarget = {
  id: 'superapp-portfolio';
  appDir: string;
  workflow: (page: Page) => Promise<void>;
};

type MatrixCase = {
  browserName: 'chromium' | 'firefox' | 'webkit';
  profile: 'desktop' | 'mobile-slow';
  slowNetwork: boolean;
};

const host = 'http://localhost';
const fullMatrix = process.env.SUPERAPP_BROWSER_MATRIX === '1';
const artifactRoot =
  process.env.SUPERAPP_BROWSER_MATRIX_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-browser-matrix';
const browserTypes: Record<MatrixCase['browserName'], BrowserType> = {
  chromium,
  firefox,
  webkit,
};

const matrixCases: MatrixCase[] = (
  fullMatrix
    ? [
        { browserName: 'chromium', profile: 'desktop', slowNetwork: false },
        { browserName: 'chromium', profile: 'mobile-slow', slowNetwork: true },
        { browserName: 'firefox', profile: 'desktop', slowNetwork: false },
        { browserName: 'webkit', profile: 'mobile-slow', slowNetwork: true },
      ]
    : [{ browserName: 'chromium', profile: 'desktop', slowNetwork: false }]
) as MatrixCase[];

const appTargets: AppTarget[] = [
  {
    id: 'superapp-portfolio',
    appDir: path.resolve(__dirname, '../../superapp-portfolio'),
    workflow: async page => {
      await page.waitForSelector('[data-testid="portfolio-ready"]');
      await page.click('[data-testid="nav-mobility"]');
      await page.waitForSelector('[data-testid="portfolio-app-page"]');
      await page.click('[data-testid="run-workflow"]');
      await page.waitForFunction(() =>
        /accepted|deduped/.test(
          document.querySelector('[data-testid="workflow-event"]')
            ?.textContent ?? '',
        ),
      );
      await page.click('[data-testid="nav-mega-erp"]');
      await page.waitForSelector('[data-testid="mega-erp-panel"]');
      await page.click('[data-testid="approve-first"]');
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="approval-ap-1001"]')
          ?.textContent?.includes('approved'),
      );
      await page.click('[data-testid="chat-send"]');
      await page.waitForSelector('[data-testid="chat-msg-3"]');
    },
  },
];

function createArtifactDir(appId: string, matrixCase: MatrixCase) {
  const dir = path.join(
    artifactRoot,
    `${appId}-${matrixCase.browserName}-${matrixCase.profile}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function capturePageErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message: { text: () => string; type: () => string }) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  return errors;
}

async function createContext(
  appId: string,
  browser: Browser,
  matrixCase: MatrixCase,
) {
  const artifactDir = createArtifactDir(appId, matrixCase);
  const context = await browser.newContext({
    ...(matrixCase.profile === 'mobile-slow'
      ? devices['iPhone 13']
      : {
          viewport: { width: 1440, height: 960 },
        }),
    recordVideo: {
      dir: path.join(artifactDir, 'video'),
    },
  });

  if (matrixCase.slowNetwork) {
    await context.route(
      '**/*',
      async (route: { continue: () => Promise<void> }) => {
        await new Promise(resolve => setTimeout(resolve, 40));
        await route.continue();
      },
    );
  }

  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  return context;
}

async function finishArtifacts(input: {
  appId: string;
  matrixCase: MatrixCase;
  context: BrowserContext;
  page: Page;
  failed: boolean;
  errors: string[];
}) {
  const artifactDir = createArtifactDir(input.appId, input.matrixCase);
  const tracePath = path.join(artifactDir, 'trace.zip');
  await input.context.tracing.stop({ path: tracePath });

  const screenshotPath = path.join(artifactDir, 'failure.png');
  if (input.failed) {
    await input.page.screenshot({ path: screenshotPath, fullPage: true });
  }

  await writeFile(
    path.join(artifactDir, 'summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suite: 'superapp-browser-matrix',
        appId: input.appId,
        browserName: input.matrixCase.browserName,
        profile: input.matrixCase.profile,
        slowNetwork: input.matrixCase.slowNetwork,
        tracePath,
        screenshotPath: input.failed ? screenshotPath : undefined,
        videoDir: path.join(artifactDir, 'video'),
        errors: input.errors,
      },
      null,
      2,
    )}\n`,
  );
}

async function runWorkflow(
  target: AppTarget,
  port: number,
  matrixCase: MatrixCase,
) {
  const browser = await browserTypes[matrixCase.browserName].launch();
  const context = await createContext(target.id, browser, matrixCase);
  const page = await context.newPage();
  const errors = capturePageErrors(page);
  let failed = false;

  try {
    const reset = await fetch(`${host}:${port}/bff-api/effect/reset`, {
      method: 'POST',
    });
    expect(reset.status).toBe(200);
    await page.goto(`${host}:${port}`, {
      waitUntil: 'networkidle',
    });
    await target.workflow(page);
    const hydrationErrors = errors.filter(error =>
      /hydration|did not match|server rendered/i.test(error),
    );
    expect(hydrationErrors).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await finishArtifacts({
      appId: target.id,
      matrixCase,
      context,
      page,
      failed,
      errors,
    });
    await context.close();
    await browser.close();
  }
}

describe('SuperApp Playwright browser matrix', () => {
  const servedApps: Array<{
    target: AppTarget;
    port: number;
    app: Awaited<ReturnType<typeof modernServe>>;
  }> = [];

  beforeAll(async () => {
    for (const target of appTargets) {
      const build = await buildFixtureOnce(target.appDir, {
        build: () => modernBuild(target.appDir),
      });
      expect(build.code).toBe(0);
      const port = await getPort();
      const app = await modernServe(target.appDir, port, {
        cwd: target.appDir,
        stderr: false,
        stdout: false,
      });
      servedApps.push({ target, port, app });
    }
  });

  afterAll(async () => {
    await Promise.all(servedApps.map(({ app }) => killApp(app)));
  });

  for (const target of appTargets) {
    for (const matrixCase of matrixCases) {
      test(`${target.id} ${matrixCase.browserName} ${matrixCase.profile}`, async () => {
        const executableAvailable = existsSync(
          browserTypes[matrixCase.browserName].executablePath(),
        );
        if (!executableAvailable) {
          throw new Error(
            `Playwright ${matrixCase.browserName} executable is missing. Run playwright install before enabling this matrix.`,
          );
        }

        const served = servedApps.find(item => item.target.id === target.id);
        expect(served).toBeDefined();
        await runWorkflow(target, served!.port, matrixCase);
      });
    }
  }
});
