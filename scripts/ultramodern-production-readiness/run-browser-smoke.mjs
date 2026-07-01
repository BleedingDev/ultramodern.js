#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cliKit from '../lib/cli-kit.js';
import fsKit from '../lib/fs-kit.js';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const { parseCliArgs } = cliKit;
const { readJsonFile, writeJsonFile } = fsKit;
const defaultArtifactDir = '.modern/production-readiness/browser-smoke/local';
const defaultReportPath =
  '.modern/production-readiness/browser-smoke/summary.json';
const compactContractRelativePath = '.modernjs/ultramodern.json';
const legacyContractRelativePath =
  '.modernjs/ultramodern-generated-contract.json';
const fatalConsoleTypes = new Set(['error']);

export class BrowserSmokeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserSmokeError';
    this.details = details;
  }
}

export function parseArgs(argv) {
  rejectInlineOptionValues(argv, [
    '--project-dir',
    '--artifact-dir',
    '--out',
    '--mode',
    '--public-url',
    '--timeout-ms',
  ]);

  const parsed = parseCliArgs(argv, {
    defaults: {
      artifactDir: defaultArtifactDir,
      mode: 'local',
      out: defaultReportPath,
      publicUrlEntries: [],
      requirePublicUrls: false,
      timeoutMs: '60000',
    },
    options: {
      'project-dir': {
        key: 'projectDir',
        requiredValue: false,
      },
      'artifact-dir': {
        key: 'artifactDir',
        requiredValue: false,
      },
      out: {
        requiredValue: false,
      },
      mode: {
        requiredValue: false,
      },
      'public-url': {
        key: 'publicUrlEntries',
        multiple: true,
        requiredValue: false,
      },
      'require-public-urls': {
        key: 'requirePublicUrls',
        type: 'boolean',
      },
      'timeout-ms': {
        key: 'timeoutMs',
        requiredValue: false,
      },
    },
  });

  const publicUrls = {};
  for (const entry of parsed.publicUrlEntries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error('--public-url must be appId=url');
    }
    publicUrls[entry.slice(0, separatorIndex)] = entry.slice(
      separatorIndex + 1,
    );
  }
  parsed.timeoutMs = Number.parseInt(parsed.timeoutMs, 10);
  const { publicUrlEntries, ...resolvedOptions } = parsed;

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
    ...resolvedOptions,
    artifactDir: path.resolve(repoRoot, parsed.artifactDir),
    out: path.resolve(repoRoot, parsed.out),
    publicUrls,
    projectDir: path.resolve(parsed.projectDir),
  };
}

function rejectInlineOptionValues(argv, valueOptions) {
  const prefixes = valueOptions.map(option => `${option}=`);
  for (const arg of argv) {
    if (prefixes.some(prefix => arg.startsWith(prefix))) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
}

function appPort(app) {
  return app.config?.source?.siteUrl?.defaultLocalhostPort;
}

function appPortEnv(app) {
  return app.config?.source?.siteUrl?.envFallbackOrder?.find(name =>
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
    effectReadiness:
      cloudflareRoutes.effectReadiness ?? cloudflareRoutes.apiReadiness,
    locale:
      cloudflareRoutes.locale ?? `/locales/en/${app.i18n?.namespace}.json`,
    mfManifest: cloudflareRoutes.mfManifest ?? '/mf-manifest.json',
    ssr: cloudflareRoutes.ssr ?? '/en',
  };
}

function toKebabCase(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function toEnvSegment(value) {
  return toKebabCase(value).replace(/-/gu, '_').toUpperCase();
}

function normalizeRelativePath(value) {
  return String(value ?? '')
    .replace(/\\/gu, '/')
    .replace(/^\.\/+/u, '');
}

function appNamespace(app) {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}

function normalizeCompactApp(rawApp) {
  const id = String(rawApp.id);
  const kind = rawApp.kind === 'vertical' ? 'vertical' : 'shell';
  const appPath =
    typeof rawApp.path === 'string'
      ? normalizeRelativePath(rawApp.path)
      : kind === 'shell'
        ? 'apps/shell-super-app'
        : `verticals/${toKebabCase(id)}`;
  const packageSuffix =
    typeof rawApp.packageSuffix === 'string'
      ? rawApp.packageSuffix
      : (appPath.split('/').at(-1) ?? id);
  const domain =
    typeof rawApp.domain === 'string'
      ? rawApp.domain
      : kind === 'vertical'
        ? packageSuffix
        : undefined;
  const moduleFederation =
    rawApp.moduleFederation && typeof rawApp.moduleFederation === 'object'
      ? rawApp.moduleFederation
      : {};
  const port = Number.isInteger(rawApp.port) ? rawApp.port : undefined;
  const portEnv =
    typeof rawApp.portEnv === 'string'
      ? rawApp.portEnv
      : `${toEnvSegment(id)}_PORT`;
  const api =
    rawApp.api && typeof rawApp.api === 'object'
      ? {
          stem:
            typeof rawApp.api.stem === 'string'
              ? rawApp.api.stem
              : (domain ?? id),
          prefix:
            typeof rawApp.api.prefix === 'string'
              ? rawApp.api.prefix
              : `/${domain ?? id}-api`,
        }
      : undefined;

  return {
    ...rawApp,
    id,
    kind,
    path: appPath,
    packageSuffix,
    domain,
    port,
    portEnv,
    moduleFederation,
    api,
  };
}

function createBuildMarker(scope, app) {
  return crypto
    .createHash('sha256')
    .update(`${scope}:${app.packageSuffix}:${app.id}:0.1.0`)
    .digest('hex')
    .slice(0, 16);
}

function createCloudflareRoutes(app) {
  return {
    ssr: '/en',
    mfManifest: '/mf-manifest.json',
    locale: `/locales/en/${appNamespace(app)}.json`,
    ...(app.api
      ? {
          apiReadiness: `${app.api.prefix}/${app.api.stem}/readiness`,
          effectReadiness: `${app.api.prefix}/${app.api.stem}/readiness`,
        }
      : {}),
  };
}

function createSmokeContractApp(config, app) {
  const packageScope =
    typeof config.workspace?.packageScope === 'string'
      ? config.workspace.packageScope
      : path.basename(process.cwd());

  return {
    id: app.id,
    kind: app.kind,
    package: app.package,
    path: app.path,
    config: {
      source: {
        siteUrl: {
          defaultLocalhostPort: app.port,
          envFallbackOrder: [
            'MODERN_PUBLIC_SITE_URL',
            `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
            app.portEnv,
          ],
        },
      },
    },
    deploy: {
      cloudflare: {
        workerName: `${toKebabCase(packageScope)}-${app.packageSuffix}`.slice(
          0,
          63,
        ),
        publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
        routes: createCloudflareRoutes(app),
      },
    },
    i18n: {
      namespace: appNamespace(app),
    },
    marker: {
      appId: app.id,
      build: createBuildMarker(packageScope, app),
    },
    moduleFederation: {
      ...app.moduleFederation,
    },
    styling: {
      federation: {
        rootSelector: `[data-app-id="${app.id}"]`,
      },
    },
  };
}

function synthesizeContractFromCompactConfig(config, { sourcePath } = {}) {
  const apps = Array.isArray(config.topology?.apps)
    ? config.topology.apps.map(normalizeCompactApp)
    : [];

  return {
    sourcePath,
    apps: apps.map(app => createSmokeContractApp(config, app)),
  };
}

export function normalizeSmokeContract(contract, options = {}) {
  if (Array.isArray(contract?.apps)) {
    return {
      ...contract,
      sourcePath: contract.sourcePath ?? options.sourcePath,
    };
  }
  if (Array.isArray(contract?.topology?.apps)) {
    return synthesizeContractFromCompactConfig(contract, options);
  }
  return {
    ...contract,
    sourcePath: contract?.sourcePath ?? options.sourcePath,
  };
}

export function resolveContractPath(projectDir) {
  const compactPath = path.join(projectDir, compactContractRelativePath);
  if (fs.existsSync(compactPath)) {
    return compactPath;
  }

  const legacyPath = path.join(projectDir, legacyContractRelativePath);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return compactPath;
}

export function readSmokeContract(projectDir) {
  const contractPath = resolveContractPath(projectDir);
  return {
    contract: normalizeSmokeContract(readJsonFile(contractPath), {
      sourcePath: contractPath,
    }),
    contractPath,
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
  const normalizedContract = normalizeSmokeContract(contract);
  const targets = [];
  const skipped = [];

  for (const app of normalizedContract.apps ?? []) {
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

export function orderTargetsForLocalStartup(targets) {
  const remotes = targets.filter(target => target.app.kind !== 'shell');
  const shells = targets.filter(target => target.app.kind === 'shell');
  return { remotes, shells, validation: [...remotes, ...shells] };
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

async function waitForTargetSsr(
  target,
  { fetchImpl, retryDelayMs, timeoutMs },
) {
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
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  throw new BrowserSmokeError(
    `${target.app.id} did not become reachable at ${target.baseUrl}`,
    {
      cause: lastError instanceof Error ? lastError.message : String(lastError),
    },
  );
}

async function waitForTargetManifest(
  target,
  { fetchImpl, retryDelayMs, timeoutMs },
) {
  const manifestUrl = joinUrl(target.baseUrl, target.routes.mfManifest);
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const manifest = await fetchText(manifestUrl, fetchImpl);
      if (manifest.ok && parseMaybeJson(manifest.body)) {
        return;
      }
      lastError = new Error(
        manifest.ok
          ? 'MF manifest is not valid JSON'
          : `HTTP ${manifest.status}`,
      );
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
  throw new BrowserSmokeError(
    `${target.app.id} did not publish a ready MF manifest at ${manifestUrl}`,
    {
      cause: lastError instanceof Error ? lastError.message : String(lastError),
      route: target.routes.mfManifest,
    },
  );
}

export async function waitForTarget(
  target,
  {
    fetchImpl,
    requireManifest = false,
    retryDelayMs = 500,
    timeoutMs = 60_000,
  },
) {
  await waitForTargetSsr(target, { fetchImpl, retryDelayMs, timeoutMs });
  if (requireManifest) {
    await waitForTargetManifest(target, { fetchImpl, retryDelayMs, timeoutMs });
  }
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

export function isFatalConsoleMessage(message) {
  if (!fatalConsoleTypes.has(message.type)) {
    return false;
  }

  const url = message.location?.url;
  const text = message.text ?? '';
  if (typeof url === 'string' && text.includes('Failed to load resource')) {
    try {
      if (new URL(url).pathname.endsWith('/favicon.ico')) {
        return false;
      }
    } catch {
      // Keep non-URL console locations fatal.
    }
  }

  return true;
}

function isSameOriginAsset(target, url) {
  try {
    return new URL(url).origin === new URL(target.baseUrl).origin;
  } catch {
    return false;
  }
}

export function findDuplicateStylesheetHrefs(stylesheetHrefs) {
  const counts = new Map();
  for (const href of stylesheetHrefs) {
    if (typeof href !== 'string' || href.length === 0) {
      continue;
    }
    counts.set(href, (counts.get(href) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([href, count]) => ({ count, href }));
}

export function remoteBoundaryCandidates(remote) {
  return [remote?.id, remote?.alias, remote?.name]
    .filter(value => typeof value === 'string' && value.length > 0)
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function waitForHydrationStyles(page) {
  if (typeof page.waitForLoadState === 'function') {
    await page
      .waitForLoadState('networkidle', { timeout: 15_000 })
      .catch(() => {
        // Network idle is a best-effort hydration settle point; streaming,
        // beacons, or long-polling should not hide the stylesheet assertion.
      });
  }

  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(250);
  }
}

async function collectStylesheetLinks(page) {
  return page.$$eval('link[rel~="stylesheet"]', links =>
    links.map(link => ({
      dataChunk: link.getAttribute('data-chunk') ?? undefined,
      href: link.href,
      rel: link.getAttribute('rel') ?? link.rel ?? '',
    })),
  );
}

async function maybeScreenshot(page, filePath) {
  try {
    await page.screenshot({ fullPage: true, path: filePath });
  } catch {
    // Screenshots are diagnostic best-effort artifacts.
  }
}

async function validateNoJavaScriptSsrTarget(
  target,
  browser,
  { appArtifactDir },
) {
  const app = target.app;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: {
      height: 900,
      width: 1440,
    },
  });
  const page = await context.newPage();
  const failedResponses = [];

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
        'no-js-ssr-ui-marker',
        marker === app.marker?.build ? 'pass' : 'fail',
        {
          actual: marker,
          expected: app.marker?.build,
        },
      ),
    );
    assertPass(
      marker === app.marker?.build,
      `${app.id} no-JS SSR UI marker mismatch`,
    );

    const rootSelector = app.styling?.federation?.rootSelector;
    if (rootSelector) {
      const rootCount = await page.locator(rootSelector).count();
      assertions.push(
        assertion(
          'no-js-ssr-css-root-marker',
          rootCount > 0 ? 'pass' : 'fail',
          {
            expected: rootSelector,
          },
        ),
      );
      assertPass(
        rootCount > 0,
        `${app.id} no-JS SSR CSS root marker is missing`,
      );
    }

    assertions.push(
      assertion(
        'no-js-ssr-failed-responses',
        failedResponses.length === 0 ? 'pass' : 'fail',
        {
          failedResponseCount: failedResponses.length,
        },
      ),
    );
    assertPass(
      failedResponses.length === 0,
      `${app.id} loaded failed no-JS SSR responses`,
      { failedResponses },
    );

    await maybeScreenshot(page, path.join(appArtifactDir, 'no-js-ssr.png'));
    return assertions;
  } finally {
    writeJsonFile(
      path.join(appArtifactDir, 'no-js-failed-responses.json'),
      failedResponses,
      { atomic: false },
    );
    await context.close();
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
  let stylesheetLinks = [];

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
      const remotes =
        app.moduleFederation.remotes?.length > 0
          ? app.moduleFederation.remotes
          : app.moduleFederation.verticalRefs.map(id => ({ id }));
      const matchedRemoteBoundaries = [];
      const triedRemoteBoundaries = [];
      for (const remote of remotes) {
        const boundaryCandidates = remoteBoundaryCandidates(remote);
        const boundaryCounts = await Promise.all(
          boundaryCandidates.map(async boundaryId => [
            boundaryId,
            await page
              .locator(`[data-modern-boundary-id="${boundaryId}"]`)
              .count(),
          ]),
        );
        const matchedBoundary = boundaryCounts.find(([, count]) => count > 0);
        triedRemoteBoundaries.push({
          matchedBoundaryId: matchedBoundary?.[0],
          remoteId: remote.id,
          triedBoundaryIds: boundaryCandidates,
        });
        if (matchedBoundary) {
          matchedRemoteBoundaries.push({
            boundaryId: matchedBoundary[0],
            remoteId: remote.id,
          });
        }
      }
      assertions.push(
        assertion(
          'shell-composition-boundary',
          matchedRemoteBoundaries.length > 0 ? 'pass' : 'fail',
          {
            matchedRemoteBoundaries,
            triedRemoteBoundaries,
          },
        ),
      );
      assertPass(
        matchedRemoteBoundaries.length > 0,
        `${app.id} shell route did not render any declared remote boundary`,
        { triedRemoteBoundaries },
      );
    }

    await waitForHydrationStyles(page);
    stylesheetLinks = await collectStylesheetLinks(page);
    const duplicateStylesheetHrefs = findDuplicateStylesheetHrefs(
      stylesheetLinks.map(link => link.href),
    );
    assertions.push(
      assertion(
        'stylesheet-href-dedupe',
        duplicateStylesheetHrefs.length === 0 ? 'pass' : 'fail',
        {
          duplicateStylesheetHrefs,
          stylesheetCount: stylesheetLinks.length,
        },
      ),
    );
    assertPass(
      duplicateStylesheetHrefs.length === 0,
      `${app.id} rendered duplicate stylesheet links after hydration`,
      { duplicateStylesheetHrefs, stylesheetLinks },
    );

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

    const fatalConsoleMessages = consoleMessages.filter(isFatalConsoleMessage);
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
    assertions.push(
      ...(await validateNoJavaScriptSsrTarget(target, browser, {
        appArtifactDir,
      })),
    );
    return assertions;
  } finally {
    writeJsonFile(path.join(appArtifactDir, 'console.json'), consoleMessages, {
      atomic: false,
    });
    writeJsonFile(path.join(appArtifactDir, 'page-errors.json'), pageErrors, {
      atomic: false,
    });
    writeJsonFile(
      path.join(appArtifactDir, 'failed-responses.json'),
      failedResponses,
      { atomic: false },
    );
    writeJsonFile(
      path.join(appArtifactDir, 'stylesheets.json'),
      stylesheetLinks,
      { atomic: false },
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

function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate));
}

async function launchBrowser(browserProvider) {
  const playwright = browserProvider ?? (await importPlaywright());
  const executablePath = findBrowserExecutable();
  return playwright.chromium.launch({
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
    headless: true,
  });
}

export async function runUltramodernBrowserSmoke(options) {
  const { contract, contractPath } = options.contract
    ? {
        contract: normalizeSmokeContract(options.contract, {
          sourcePath: options.contractPath,
        }),
        contractPath: options.contractPath ?? '<provided>',
      }
    : readSmokeContract(options.projectDir);
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
  const localStartupOrder =
    options.mode === 'local' ? orderTargetsForLocalStartup(targets) : undefined;
  const startServerImpl = options.startServerImpl ?? startServer;

  try {
    if (localStartupOrder) {
      for (const target of localStartupOrder.remotes) {
        servers.push(startServerImpl(target, options));
      }
      for (const target of localStartupOrder.remotes) {
        await waitForTarget(target, {
          fetchImpl: options.fetchImpl ?? fetch,
          requireManifest: true,
          retryDelayMs: options.retryDelayMs,
          timeoutMs: options.timeoutMs,
        });
      }
      for (const target of localStartupOrder.shells) {
        servers.push(startServerImpl(target, options));
      }
      for (const target of localStartupOrder.shells) {
        await waitForTarget(target, {
          fetchImpl: options.fetchImpl ?? fetch,
          retryDelayMs: options.retryDelayMs,
          timeoutMs: options.timeoutMs,
        });
      }
    }

    if (targets.length === 0) {
      report.status = 'skipped';
      writeJsonFile(options.out, report, { atomic: false });
      return report;
    }

    browser = await launchBrowser(options.browserProvider);
    const validationTargets = localStartupOrder?.validation ?? targets;
    for (const target of validationTargets) {
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
    writeJsonFile(options.out, report, { atomic: false });
    return report;
  } catch (error) {
    report.status = 'fail';
    report.error = error instanceof Error ? error.message : String(error);
    if (error instanceof BrowserSmokeError && error.details) {
      report.errorDetails = error.details;
    }
    writeJsonFile(options.out, report, { atomic: false });
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
  await new Promise(resolve => {
    process.stdout.write(
      `[ultramodern-browser-smoke] ${report.status}: ${options.out}\n`,
      resolve,
    );
  });
  process.exit(report.status === 'pass' || report.status === 'skipped' ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[ultramodern-browser-smoke] ${error.message}\n`);
    process.exitCode = 1;
  });
}
