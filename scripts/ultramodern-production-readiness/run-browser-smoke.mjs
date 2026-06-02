#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const defaultArtifactDir = '.modern/production-readiness/browser-smoke/local';
const defaultReportPath =
  '.modern/production-readiness/browser-smoke/summary.json';
const contractRelativePath = '.modernjs/ultramodern-generated-contract.json';
const fatalConsoleTypes = new Set(['error']);

export class BrowserSmokeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserSmokeError';
    this.details = details;
  }
}

export function parseArgs(argv) {
  const parsed = {
    artifactDir: defaultArtifactDir,
    mode: 'local',
    out: defaultReportPath,
    publicUrls: {},
    requirePublicUrls: false,
    timeoutMs: 60_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-dir') {
      parsed.projectDir = argv[++index];
    } else if (arg === '--artifact-dir') {
      parsed.artifactDir = argv[++index];
    } else if (arg === '--out') {
      parsed.out = argv[++index];
    } else if (arg === '--mode') {
      parsed.mode = argv[++index];
    } else if (arg === '--public-url') {
      const entry = argv[++index];
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        throw new Error('--public-url must be appId=url');
      }
      parsed.publicUrls[entry.slice(0, separatorIndex)] = entry.slice(
        separatorIndex + 1,
      );
    } else if (arg === '--require-public-urls') {
      parsed.requirePublicUrls = true;
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(argv[++index], 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.projectDir) {
    throw new Error('--project-dir is required');
  }
  if (!['local', 'public'].includes(parsed.mode)) {
    throw new Error('--mode must be local or public');
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return {
    ...parsed,
    artifactDir: path.resolve(repoRoot, parsed.artifactDir),
    out: path.resolve(repoRoot, parsed.out),
    projectDir: path.resolve(parsed.projectDir),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appPort(app) {
  return app.config?.output?.assetPrefix?.defaultLocalhostPort;
}

function appPortEnv(app) {
  return app.config?.output?.assetPrefix?.envFallbackOrder?.find(name =>
    String(name).endsWith('_PORT'),
  );
}

function appPublicUrlEnv(app) {
  return app.deploy?.cloudflare?.publicUrlEnv;
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function joinUrl(baseUrl, routePath = '/') {
  return new URL(routePath, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function markerFromJson(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (typeof value.build === 'string') {
    return value.build;
  }
  if (value.marker && typeof value.marker.build === 'string') {
    return value.marker.build;
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const marker = markerFromJson(item);
        if (marker) {
          return marker;
        }
      }
    } else {
      const marker = markerFromJson(nested);
      if (marker) {
        return marker;
      }
    }
  }
  return undefined;
}

function extractUiMarker(html) {
  return html.match(/data-build-marker=["']([^"']+)["']/u)?.[1];
}

function expectedAppIdFromRootSelector(selector) {
  return selector?.match(/data-app-id="([^"]+)"/u)?.[1];
}

function routesForApp(app) {
  const cloudflareRoutes = app.deploy?.cloudflare?.routes ?? {};
  return {
    effectReadiness: cloudflareRoutes.effectReadiness,
    locale:
      cloudflareRoutes.locale ?? `/locales/en/${app.i18n?.namespace}.json`,
    mfManifest: cloudflareRoutes.mfManifest ?? '/mf-manifest.json',
    ssr: cloudflareRoutes.ssr ?? '/en',
  };
}

function inferPublicUrl(app, explicitPublicUrls, env) {
  const explicit = explicitPublicUrls[app.id];
  if (explicit) {
    return explicit;
  }
  const publicUrlEnv = appPublicUrlEnv(app);
  if (publicUrlEnv && env[publicUrlEnv]) {
    return env[publicUrlEnv];
  }
  const workersDevSubdomain = env.ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN;
  const workerName = app.deploy?.cloudflare?.workerName;
  if (workersDevSubdomain && workerName) {
    return `https://${workerName}.${workersDevSubdomain}.workers.dev`;
  }
  return undefined;
}

export function createSmokeTargets(
  contract,
  {
    env = process.env,
    mode = 'local',
    publicUrls = {},
    requirePublicUrls = false,
  } = {},
) {
  const targets = [];
  const skipped = [];

  for (const app of contract.apps ?? []) {
    let baseUrl;
    if (mode === 'local') {
      const port = appPort(app);
      if (!Number.isInteger(port)) {
        throw new BrowserSmokeError(`${app.id} is missing a local port`);
      }
      baseUrl = `http://localhost:${port}`;
    } else {
      baseUrl = inferPublicUrl(app, publicUrls, env);
      if (!baseUrl) {
        const skippedEntry = {
          appId: app.id,
          publicUrlEnv: appPublicUrlEnv(app),
          reason: 'public URL is not supplied',
          status: requirePublicUrls ? 'fail' : 'skipped',
        };
        skipped.push(skippedEntry);
        if (requirePublicUrls) {
          throw new BrowserSmokeError(
            `${app.id} requires ${appPublicUrlEnv(app) ?? 'a public URL'}`,
            skippedEntry,
          );
        }
        continue;
      }
    }

    targets.push({
      app,
      baseUrl: normalizeBaseUrl(baseUrl),
      port: appPort(app),
      portEnv: appPortEnv(app),
      publicUrlEnv: appPublicUrlEnv(app),
      routes: routesForApp(app),
    });
  }

  return { skipped, targets };
}

function assertion(type, status, details = {}) {
  return {
    status,
    type,
    ...details,
  };
}

function assertPass(condition, message, details = {}) {
  if (!condition) {
    throw new BrowserSmokeError(message, details);
  }
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  return {
    body: await response.text(),
    contentType: response.headers?.get?.('content-type'),
    ok: response.ok,
    status: response.status,
    url,
  };
}

async function waitForTarget(target, { fetchImpl, timeoutMs }) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(
        joinUrl(target.baseUrl, target.routes.ssr),
      );
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new BrowserSmokeError(
    `${target.app.id} did not become reachable at ${target.baseUrl}`,
    {
      cause: lastError instanceof Error ? lastError.message : String(lastError),
    },
  );
}

export async function validateHttpTarget(target, { fetchImpl = fetch } = {}) {
  const app = target.app;
  const assertions = [];

  const ssr = await fetchText(
    joinUrl(target.baseUrl, target.routes.ssr),
    fetchImpl,
  );
  assertions.push(
    assertion('ssr-route', ssr.ok ? 'pass' : 'fail', {
      route: target.routes.ssr,
      statusCode: ssr.status,
    }),
  );
  assertPass(ssr.ok, `${app.id} SSR route returned HTTP ${ssr.status}`);

  const uiMarker = extractUiMarker(ssr.body);
  assertions.push(
    assertion(
      'ui-marker-html',
      uiMarker === app.marker?.build ? 'pass' : 'fail',
      {
        actual: uiMarker,
        expected: app.marker?.build,
      },
    ),
  );
  assertPass(
    uiMarker === app.marker?.build,
    `${app.id} SSR UI marker mismatch`,
  );

  const expectedRootAppId = expectedAppIdFromRootSelector(
    app.styling?.federation?.rootSelector,
  );
  assertions.push(
    assertion(
      'css-root-marker',
      expectedRootAppId &&
        ssr.body.includes(`data-app-id="${expectedRootAppId}"`)
        ? 'pass'
        : 'fail',
      {
        expected: app.styling?.federation?.rootSelector,
      },
    ),
  );
  assertPass(
    expectedRootAppId &&
      ssr.body.includes(`data-app-id="${expectedRootAppId}"`),
    `${app.id} SSR response is missing CSS root marker`,
  );

  const manifest = await fetchText(
    joinUrl(target.baseUrl, target.routes.mfManifest),
    fetchImpl,
  );
  assertions.push(
    assertion('mf-manifest', manifest.ok ? 'pass' : 'fail', {
      route: target.routes.mfManifest,
      statusCode: manifest.status,
    }),
  );
  assertPass(
    manifest.ok,
    `${app.id} MF manifest returned HTTP ${manifest.status}`,
  );
  assertions.push(
    assertion(
      'mf-manifest-json',
      parseMaybeJson(manifest.body) ? 'pass' : 'fail',
      { route: target.routes.mfManifest },
    ),
  );
  assertPass(
    parseMaybeJson(manifest.body),
    `${app.id} MF manifest is not valid JSON`,
  );

  const locale = await fetchText(
    joinUrl(target.baseUrl, target.routes.locale),
    fetchImpl,
  );
  const localeJson = parseMaybeJson(locale.body);
  assertions.push(
    assertion('locale-json', locale.ok && localeJson ? 'pass' : 'fail', {
      namespace: app.i18n?.namespace,
      route: target.routes.locale,
      statusCode: locale.status,
    }),
  );
  assertPass(locale.ok, `${app.id} locale JSON returned HTTP ${locale.status}`);
  assertPass(localeJson, `${app.id} locale JSON is not valid JSON`);
  assertPass(
    Object.hasOwn(localeJson, app.i18n?.namespace),
    `${app.id} locale JSON is missing namespace ${app.i18n?.namespace}`,
  );

  if (target.routes.effectReadiness) {
    const readiness = await fetchText(
      joinUrl(target.baseUrl, target.routes.effectReadiness),
      fetchImpl,
    );
    const apiMarker = markerFromJson(parseMaybeJson(readiness.body));
    assertions.push(
      assertion(
        'effect-readiness',
        readiness.ok && apiMarker === app.marker?.build ? 'pass' : 'fail',
        {
          actual: apiMarker,
          expected: app.marker?.build,
          route: target.routes.effectReadiness,
          statusCode: readiness.status,
        },
      ),
    );
    assertPass(
      readiness.ok,
      `${app.id} Effect readiness returned HTTP ${readiness.status}`,
    );
    assertPass(
      apiMarker === app.marker?.build,
      `${app.id} API marker mismatch`,
    );
  }

  return assertions;
}

function serializeConsoleMessage(message) {
  return {
    location: message.location?.(),
    text: message.text?.(),
    type: message.type?.(),
  };
}

function isSameOriginAsset(target, url) {
  try {
    return new URL(url).origin === new URL(target.baseUrl).origin;
  } catch {
    return false;
  }
}

async function maybeScreenshot(page, filePath) {
  try {
    await page.screenshot({ fullPage: true, path: filePath });
  } catch {
    // Screenshots are diagnostic best-effort artifacts.
  }
}

export async function validateBrowserTarget(target, browser, { artifactDir }) {
  const app = target.app;
  const appArtifactDir = path.join(artifactDir, app.id);
  fs.mkdirSync(appArtifactDir, { recursive: true });

  const context = await browser.newContext({
    viewport: {
      height: 900,
      width: 1440,
    },
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedResponses = [];

  page.on('console', message => {
    const serialized = serializeConsoleMessage(message);
    consoleMessages.push(serialized);
  });
  page.on('pageerror', error => {
    pageErrors.push({
      message: error.message,
      stack: error.stack,
    });
  });
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && isSameOriginAsset(target, url)) {
      failedResponses.push({ status, url });
    }
  });

  const assertions = [];
  try {
    await page.goto(joinUrl(target.baseUrl, target.routes.ssr), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
      timeout: 15_000,
    });
    const marker = await page
      .locator('[data-testid="ultramodern-ui-marker"]')
      .getAttribute('data-build-marker');
    assertions.push(
      assertion(
        'browser-ui-marker',
        marker === app.marker?.build ? 'pass' : 'fail',
        {
          actual: marker,
          expected: app.marker?.build,
        },
      ),
    );
    assertPass(
      marker === app.marker?.build,
      `${app.id} browser UI marker mismatch`,
    );

    const rootSelector = app.styling?.federation?.rootSelector;
    if (rootSelector) {
      const rootCount = await page.locator(rootSelector).count();
      assertions.push(
        assertion('browser-css-root-marker', rootCount > 0 ? 'pass' : 'fail', {
          expected: rootSelector,
        }),
      );
      assertPass(rootCount > 0, `${app.id} browser CSS root marker is missing`);
    }

    if (
      app.kind === 'shell' &&
      app.moduleFederation?.verticalRefs?.length > 0
    ) {
      const remoteNames =
        app.moduleFederation.remotes?.map(remote => remote.name) ?? [];
      for (const remoteName of remoteNames) {
        const boundaryCount = await page
          .locator(`[data-modern-boundary-id="${remoteName}"]`)
          .count();
        assertions.push(
          assertion(
            'shell-composition-boundary',
            boundaryCount > 0 ? 'pass' : 'fail',
            {
              remoteName,
            },
          ),
        );
        assertPass(
          boundaryCount > 0,
          `shell composition is missing remote boundary ${remoteName}`,
        );
      }
    }

    const csLink = page.locator('a[href="/cs"], a[href$="/cs"]').first();
    if (app.kind !== 'shell' && (await csLink.count()) > 0) {
      await csLink.click();
      await page.waitForSelector('[data-testid="ultramodern-ui-marker"]', {
        timeout: 15_000,
      });
      assertions.push(
        assertion('localized-router-navigation', 'pass', {
          targetLanguage: 'cs',
        }),
      );
    }

    const fatalConsoleMessages = consoleMessages.filter(message =>
      fatalConsoleTypes.has(message.type),
    );
    assertions.push(
      assertion(
        'browser-diagnostics',
        fatalConsoleMessages.length === 0 &&
          pageErrors.length === 0 &&
          failedResponses.length === 0
          ? 'pass'
          : 'fail',
        {
          consoleErrorCount: fatalConsoleMessages.length,
          failedResponseCount: failedResponses.length,
          pageErrorCount: pageErrors.length,
        },
      ),
    );
    assertPass(
      fatalConsoleMessages.length === 0,
      `${app.id} emitted browser console errors`,
      { consoleMessages: fatalConsoleMessages },
    );
    assertPass(pageErrors.length === 0, `${app.id} emitted page errors`, {
      pageErrors,
    });
    assertPass(
      failedResponses.length === 0,
      `${app.id} loaded failed browser responses`,
      { failedResponses },
    );

    await maybeScreenshot(page, path.join(appArtifactDir, 'screenshot.png'));
    return assertions;
  } finally {
    writeJson(path.join(appArtifactDir, 'console.json'), consoleMessages);
    writeJson(path.join(appArtifactDir, 'page-errors.json'), pageErrors);
    writeJson(
      path.join(appArtifactDir, 'failed-responses.json'),
      failedResponses,
    );
    await context.close();
  }
}

function startServer(target, { artifactDir, projectDir }) {
  const logPath = path.join(artifactDir, `${target.app.id}-serve.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
  };
  if (target.portEnv) {
    env[target.portEnv] = String(target.port);
  }
  if (target.publicUrlEnv) {
    env[target.publicUrlEnv] = target.baseUrl;
  }
  const child = spawn(
    'pnpm',
    ['--filter', target.app.package, 'run', 'serve'],
    {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  return {
    child,
    logPath,
    stop: () =>
      new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 5_000).unref();
      }).finally(() => logStream.end()),
  };
}

async function importPlaywright() {
  const configuredRoot = process.env.ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT;
  if (configuredRoot) {
    const requireFromPlaywrightRoot = createRequire(
      path.join(configuredRoot, 'package.json'),
    );
    return requireFromPlaywrightRoot('playwright');
  }

  try {
    return await import('playwright');
  } catch (error) {
    throw new BrowserSmokeError(
      'Playwright is required for UltraModern browser smoke. Install playwright or run through the published-create proof runtime.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function launchBrowser(browserProvider) {
  const playwright = browserProvider ?? (await importPlaywright());
  return playwright.chromium.launch({
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    headless: true,
  });
}

export async function runUltramodernBrowserSmoke(options) {
  const contractPath = path.join(options.projectDir, contractRelativePath);
  const contract = options.contract ?? readJson(contractPath);
  const { skipped, targets } = createSmokeTargets(contract, options);
  const report = {
    schemaVersion: 1,
    artifactDir: options.artifactDir,
    contractPath,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode,
    projectDir: options.projectDir,
    results: [],
    skipped,
    status: 'running',
  };
  const servers = [];
  let browser;

  try {
    if (options.mode === 'local') {
      for (const target of targets) {
        servers.push(startServer(target, options));
      }
      for (const target of targets) {
        await waitForTarget(target, {
          fetchImpl: options.fetchImpl ?? fetch,
          timeoutMs: options.timeoutMs,
        });
      }
    }

    if (targets.length === 0) {
      report.status = 'skipped';
      writeJson(options.out, report);
      return report;
    }

    browser = await launchBrowser(options.browserProvider);
    for (const target of targets) {
      const httpAssertions = await validateHttpTarget(target, {
        fetchImpl: options.fetchImpl ?? fetch,
      });
      const browserAssertions = await validateBrowserTarget(target, browser, {
        artifactDir: options.artifactDir,
      });
      report.results.push({
        appId: target.app.id,
        assertions: [...httpAssertions, ...browserAssertions],
        baseUrl: target.baseUrl,
        status: 'pass',
      });
    }

    report.status = 'pass';
    writeJson(options.out, report);
    return report;
  } catch (error) {
    report.status = 'fail';
    report.error = error instanceof Error ? error.message : String(error);
    if (error instanceof BrowserSmokeError && error.details) {
      report.errorDetails = error.details;
    }
    writeJson(options.out, report);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await Promise.allSettled(servers.map(server => server.stop()));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runUltramodernBrowserSmoke(options);
  process.stdout.write(
    `[ultramodern-browser-smoke] ${report.status}: ${options.out}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[ultramodern-browser-smoke] ${error.message}\n`);
    process.exitCode = 1;
  });
}
