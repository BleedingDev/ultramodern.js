import {
  BrowserSmokeError,
  expectedAppIdFromRootSelector,
} from './contract.mjs';

export function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function joinUrl(baseUrl, routePath = '/') {
  return new URL(routePath, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

export function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function markerFromJson(value) {
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

export function extractUiMarker(html) {
  return html.match(/data-build-marker=["']([^"']+)["']/u)?.[1];
}

export function assertion(type, status, details = {}) {
  return {
    status,
    type,
    ...details,
  };
}

export function assertPass(condition, message, details = {}) {
  if (!condition) {
    throw new BrowserSmokeError(message, details);
  }
}

export async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  return {
    body: await response.text(),
    contentType: response.headers?.get?.('content-type'),
    ok: response.ok,
    status: response.status,
    url,
  };
}

export async function waitForTargetSsr(
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

export async function waitForTargetManifest(
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
    serverExit,
    serverLogPath,
    timeoutMs = 60_000,
  },
) {
  const readiness = async () => {
    await waitForTargetSsr(target, { fetchImpl, retryDelayMs, timeoutMs });
    if (requireManifest) {
      await waitForTargetManifest(target, {
        fetchImpl,
        retryDelayMs,
        timeoutMs,
      });
    }
  };

  if (!serverExit) {
    await readiness();
    return;
  }

  const result = await Promise.race([
    readiness().then(() => ({ status: 'ready' })),
    serverExit.then(exit => ({ exit, status: 'exited' })),
  ]);
  if (result.status === 'exited') {
    throw new BrowserSmokeError(
      `${target.app.id} serve process exited before readiness`,
      {
        ...result.exit,
        baseUrl: target.baseUrl,
        logPath: serverLogPath,
      },
    );
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
