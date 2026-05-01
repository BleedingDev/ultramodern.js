import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

type BrowserContext = any;
type Page = any;
type PlaywrightConsoleMessage = {
  location?: () => {
    columnNumber: number;
    lineNumber: number;
    url: string;
  };
  text: () => string;
  type: () => string;
};
type PlaywrightRequest = {
  failure: () => { errorText: string } | null;
  method: () => string;
  resourceType: () => string;
  url: () => string;
};

export type BrowserRuntimeDiagnostics = {
  errors: string[];
  events: Array<Record<string, unknown>>;
  requestFailures: string[];
};

const artifactRoot =
  process.env.SUPERAPP_PORTFOLIO_BROWSER_RUNTIME_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-portfolio-browser-runtime';

function sanitizeArtifactId(testId: string) {
  return testId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createBrowserRuntimeArtifactPaths(testId: string) {
  const artifactDir = path.join(artifactRoot, sanitizeArtifactId(testId));
  rmSync(artifactDir, { force: true, recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  const videoDir = path.join(artifactDir, 'video');
  mkdirSync(videoDir, { recursive: true });

  return {
    artifactDir,
    videoDir,
  };
}

export function captureBrowserRuntimeDiagnostics(
  page: Page,
): BrowserRuntimeDiagnostics {
  const diagnostics: BrowserRuntimeDiagnostics = {
    errors: [],
    events: [],
    requestFailures: [],
  };

  page.on('console', (message: PlaywrightConsoleMessage) => {
    const entry = {
      location: message.location?.(),
      message: message.text(),
      severity: message.type(),
      type: 'console',
    };
    diagnostics.events.push(entry);

    if (message.type() === 'error') {
      diagnostics.errors.push(`console:${message.text()}`);
    }
  });

  page.on('pageerror', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.events.push({
      message,
      stack: error instanceof Error ? error.stack : undefined,
      type: 'pageerror',
    });
    diagnostics.errors.push(`pageerror:${message}`);
  });

  page.on('requestfailed', (request: PlaywrightRequest) => {
    const failure = request.failure();
    const message = `requestfailed:${request.method()} ${request.url()} ${
      failure?.errorText ?? 'unknown'
    }`;
    diagnostics.events.push({
      errorText: failure?.errorText,
      method: request.method(),
      resourceType: request.resourceType(),
      type: 'requestfailed',
      url: request.url(),
    });
    diagnostics.errors.push(message);
    diagnostics.requestFailures.push(message);
  });

  return diagnostics;
}

export async function startBrowserRuntimeTrace(context: BrowserContext) {
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
}

export async function finishBrowserRuntimeArtifacts(input: {
  artifactDir: string;
  context: BrowserContext;
  diagnostics: BrowserRuntimeDiagnostics;
  failed: boolean;
  page: Page;
  testId: string;
  videoDir: string;
}) {
  const tracePath = path.join(input.artifactDir, 'trace.zip');
  const screenshotPath = path.join(
    input.artifactDir,
    input.failed ? 'failure.png' : 'final.png',
  );
  let screenshotError: string | undefined;

  await input.context.tracing.stop({ path: tracePath });

  try {
    await input.page.screenshot({ fullPage: true, path: screenshotPath });
  } catch (error) {
    screenshotError = error instanceof Error ? error.message : String(error);
  }

  await writeFile(
    path.join(input.artifactDir, 'summary.json'),
    `${JSON.stringify(
      {
        diagnostics: input.diagnostics,
        failed: input.failed,
        schemaVersion: 1,
        screenshotError,
        screenshotPath: screenshotError ? undefined : screenshotPath,
        suite: 'superapp-portfolio-browser-runtime',
        testId: input.testId,
        tracePath,
        videoDir: input.videoDir,
      },
      null,
      2,
    )}\n`,
  );
}
