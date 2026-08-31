function joinUrl(baseUrl, routePath) {
  return new URL(routePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

function normalizeUrlWithTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolveModuleFederationPublicPath(publicPath, manifestUrl) {
  if (typeof publicPath !== 'string' || publicPath.trim().length === 0) {
    return undefined;
  }

  try {
    return normalizeUrlWithTrailingSlash(
      new URL(publicPath.trim(), manifestUrl).toString(),
    );
  } catch {
    return undefined;
  }
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    cacheControl: response.headers.get('cache-control'),
    contentLength: response.headers.get('content-length'),
    contentSecurityPolicy: response.headers.get('content-security-policy'),
    contentSecurityPolicyReportOnly: response.headers.get('content-security-policy-report-only'),
    contentType: response.headers.get('content-type'),
    link: response.headers.get('link'),
    permissionsPolicy: response.headers.get('permissions-policy'),
    referrerPolicy: response.headers.get('referrer-policy'),
    xContentTypeOptions: response.headers.get('x-content-type-options'),
    xRobotsTag: response.headers.get('x-robots-tag'),
    body: await response.text(),
  };
}

function parseMaybeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function jsonPathValue(value, path) {
  const segments = String(path ?? '')
    .split('.')
    .filter(Boolean);
  let current = value;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    if (typeof current === 'object' && Object.hasOwn(current, segment)) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function jsonValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeJsonSmokeExpectations(check) {
  if (Array.isArray(check.expectations)) {
    return check.expectations;
  }

  if (check.expect && typeof check.expect === 'object') {
    return Object.entries(check.expect).map(([path, equals]) => ({
      path,
      equals,
    }));
  }

  return [];
}

function markerFromJson(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (value.marker && typeof value.marker.build === 'string') {
    return value.marker.build;
  }
  if (typeof value.build === 'string') {
    return value.build;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function responseByteLength(response) {
  return Buffer.byteLength(response.body, 'utf8');
}

function assertByteBudget(evidence, app, response, options) {
  const bytes = responseByteLength(response);
  const passed = bytes <= options.maxBytes;
  evidence.assertions.push({
    type: 'byte-budget',
    label: options.label,
    route: options.route,
    actualBytes: bytes,
    maxBytes: options.maxBytes,
    status: passed ? 'pass' : 'fail',
  });
  assert(
    passed,
    app.id + ' ' + options.route + ' exceeds ' + options.label + ' byte budget: ' + bytes + ' > ' + options.maxBytes,
  );
}

function assertContentType(evidence, app, response, options) {
  const actual = response.contentType ?? '';
  const passed = actual.toLowerCase().includes(options.includes);
  evidence.assertions.push({
    type: 'content-type',
    route: options.route,
    expectedIncludes: options.includes,
    actual,
    status: passed ? 'pass' : 'fail',
  });
  assert(passed, app.id + ' ' + options.route + ' content-type must include ' + options.includes);
}

function assertCacheControl(evidence, app, response, options) {
  const actual = response.cacheControl ?? '';
  const passed = options.required === false || actual.trim() !== '';
  evidence.assertions.push({
    type: 'cache-control',
    route: options.route,
    actual,
    status: passed ? 'pass' : 'fail',
  });
  assert(passed, app.id + ' ' + options.route + ' is missing cache-control');
}

function matchesPreviewHostname(hostname, pattern) {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedPattern = String(pattern || '').toLowerCase();

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.startsWith('*.')) {
    return normalizedHostname.endsWith(normalizedPattern.slice(1));
  }

  return normalizedHostname === normalizedPattern;
}

function shouldNoindexUrl(publicUrl, noindex) {
  if (!noindex || noindex === false) {
    return false;
  }

  const { hostname } = new URL(publicUrl);
  const normalizedHostname = hostname.toLowerCase();

  if (
    noindex.localhost !== false &&
    (normalizedHostname === 'localhost' ||
      normalizedHostname === '127.0.0.1' ||
      normalizedHostname === '[::1]')
  ) {
    return true;
  }

  if (
    noindex.workersDev !== false &&
    normalizedHostname.endsWith('.workers.dev')
  ) {
    return true;
  }

  return (noindex.previewHostnames || []).some(pattern =>
    matchesPreviewHostname(normalizedHostname, pattern),
  );
}

function assertHeader(evidence, response, expected, options) {
  if (expected === false || expected === undefined) {
    return;
  }

  const actual = response[options.field];
  evidence.assertions.push({
    type: 'security-header',
    header: options.header,
    route: options.route,
    expected,
    actual,
    status: actual === expected ? 'pass' : 'fail',
  });
  assert(actual === expected, `${options.appId} ${options.route} is missing ${options.header}`);
}

function assertCloudflareSecurity(evidence, app, response, route, publicUrl, options = {}) {
  const security = app.deploy?.cloudflare?.security;

  if (!security || security.enabled === false) {
    return;
  }

  const headers = security.headers || {};
  assertHeader(evidence, response, headers.referrerPolicy, {
    appId: app.id,
    field: 'referrerPolicy',
    header: 'referrer-policy',
    route,
  });
  assertHeader(evidence, response, headers.contentTypeOptions, {
    appId: app.id,
    field: 'xContentTypeOptions',
    header: 'x-content-type-options',
    route,
  });
  assertHeader(evidence, response, headers.permissionsPolicy, {
    appId: app.id,
    field: 'permissionsPolicy',
    header: 'permissions-policy',
    route,
  });

  const csp = security.contentSecurityPolicy;
  if (options.html && csp?.mode !== 'off') {
    const header =
      csp?.mode === 'enforce'
        ? 'content-security-policy'
        : 'content-security-policy-report-only';
    const actual =
      csp?.mode === 'enforce'
        ? response.contentSecurityPolicy
        : response.contentSecurityPolicyReportOnly;
    const expectedDirectives = ['script-src', 'style-src', 'connect-src'];
    const missingDirectives = expectedDirectives.filter(
      directive => !actual?.includes(directive),
    );

    evidence.assertions.push({
      type: 'security-csp',
      header,
      route,
      mode: csp?.mode ?? 'report-only',
      actual,
      missingDirectives,
      status: actual && missingDirectives.length === 0 ? 'pass' : 'fail',
    });
    assert(actual, `${app.id} ${route} is missing ${header}`);
    assert(
      missingDirectives.length === 0,
      `${app.id} ${route} CSP is missing ${missingDirectives.join(', ')}`,
    );
  }

  if (shouldNoindexUrl(publicUrl, security.noindex)) {
    evidence.assertions.push({
      type: 'security-noindex',
      route,
      actual: response.xRobotsTag,
      status: response.xRobotsTag === 'noindex, nofollow' ? 'pass' : 'fail',
    });
    assert(
      response.xRobotsTag === 'noindex, nofollow',
      `${app.id} ${route} is missing noindex X-Robots-Tag`,
    );
  }
}

function collectStringValues(value, results = []) {
  if (typeof value === 'string') {
    results.push(value);
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, results);
    }
    return results;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStringValues(item, results);
    }
  }
  return results;
}

function assertNoPublicSourcemapRefs(evidence, app, manifestJson) {
  const sourcemapRefs = collectStringValues(manifestJson).filter(value =>
    /\.map(?:$|[?#])/u.test(value),
  );
  evidence.assertions.push({
    type: 'sourcemap-policy',
    actual: sourcemapRefs,
    status: sourcemapRefs.length === 0 ? 'pass' : 'fail',
  });
  assert(
    sourcemapRefs.length === 0,
    app.id + ' MF manifest must not publicly reference sourcemaps',
  );
}

function extractPreloadStyleUrls(linkHeader, publicUrl) {
  const urls = [];
  for (const match of String(linkHeader || '').matchAll(/<([^>]+)>\s*;[^,]*rel=preload[^,]*as=style/giu)) {
    urls.push(String(joinUrl(publicUrl, match[1])));
  }
  return urls;
}

function htmlHasRobotsDirective(html, expectedContent) {
  return htmlHasTagWithAttributes(html, 'meta', {
    name: 'robots',
    content: expectedContent,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlHasTagWithAttributes(html, tagName, attributes) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'giu');
  const tags = html.match(tagPattern) || [];
  return tags.some(tag =>
    Object.entries(attributes).every(([name, value]) => {
      const attrPattern = new RegExp(
        `\\b${escapeRegExp(name)}=["']${escapeRegExp(value)}["']`,
        'iu',
      );
      return attrPattern.test(tag);
    }),
  );
}

function assertHeadTag(evidence, html, options) {
  const found = htmlHasTagWithAttributes(
    html,
    options.tag,
    options.attributes,
  );
  evidence.assertions.push({
    type: 'ssr-head',
    route: options.route,
    tag: options.tag,
    attributes: options.attributes,
    status: found ? 'pass' : 'fail',
  });
  assert(found, `${options.appId} ${options.route} SSR head is missing ${options.label}`);
}

async function validateSsrHead(evidence, app, publicUrl, ssrRoute, ssr) {
  const titleFound = /<title\b[^>]*>[^<]+<\/title>/iu.test(ssr.body);
  evidence.assertions.push({
    type: 'ssr-head',
    route: ssrRoute,
    tag: 'title',
    status: titleFound ? 'pass' : 'fail',
  });
  assert(titleFound, `${app.id} ${ssrRoute} SSR head is missing title`);
  assertHeadTag(evidence, ssr.body, {
    appId: app.id,
    route: ssrRoute,
    tag: 'meta',
    attributes: { name: 'description' },
    label: 'description meta',
  });
  assertHeadTag(evidence, ssr.body, {
    appId: app.id,
    route: ssrRoute,
    tag: 'meta',
    attributes: { name: 'robots' },
    label: 'robots meta',
  });

  const publicSurface = app.routes?.publicSurface ?? {};
  const routeEntry = (publicSurface.routeEntries ?? [])[0];
  if (!routeEntry) {
    const canonicalFound = htmlHasTagWithAttributes(ssr.body, 'link', {
      rel: 'canonical',
    });
    evidence.assertions.push({
      type: 'ssr-head-private-canonical',
      route: ssrRoute,
      status: canonicalFound ? 'fail' : 'pass',
    });
    assert(!canonicalFound, `${app.id} ${ssrRoute} private SSR head must not emit canonical links`);
    return;
  }

  const publicRoute = routeEntry.localeUrlPaths?.en ?? publicSurface.concreteUrlPaths?.[0];
  const headRoute = publicRoute || ssrRoute;
  const headResponse =
    headRoute === ssrRoute ? ssr : await fetchText(joinUrl(publicUrl, headRoute));
  if (headRoute !== ssrRoute) {
    evidence.assertions.push({
      type: 'ssr-head-route',
      route: headRoute,
      status: headResponse.ok ? 'pass' : 'fail',
      statusCode: headResponse.status,
    });
    assert(headResponse.ok, `${app.id} public head route returned HTTP ${headResponse.status}`);
    assertCloudflareSecurity(evidence, app, headResponse, headRoute, publicUrl, {
      html: true,
    });
  }
  const isPreview = shouldNoindexUrl(publicUrl, app.deploy?.cloudflare?.security?.noindex);
  const robotsIndexable = htmlHasRobotsDirective(headResponse.body, 'index, follow');
  evidence.assertions.push({
    type: 'indexing-policy',
    route: headRoute,
    mode: isPreview ? 'preview' : 'production',
    xRobotsTag: headResponse.xRobotsTag,
    htmlRobotsIndexable: robotsIndexable,
    status:
      isPreview || (headResponse.xRobotsTag !== 'noindex, nofollow' && robotsIndexable)
        ? 'pass'
        : 'fail',
  });
  if (!isPreview) {
    assert(
      headResponse.xRobotsTag !== 'noindex, nofollow' && robotsIndexable,
      `${app.id} ${headRoute} production public route must be indexable`,
    );
  }

  const canonicalUrl = String(joinUrl(publicUrl, headRoute));
  assertHeadTag(evidence, headResponse.body, {
    appId: app.id,
    route: headRoute,
    tag: 'link',
    attributes: { rel: 'canonical', href: canonicalUrl },
    label: 'canonical link',
  });
  for (const language of app.routes?.publicHead?.alternates?.hreflang ?? []) {
    const href = String(joinUrl(publicUrl, routeEntry.localeUrlPaths?.[language] ?? headRoute));
    assertHeadTag(evidence, headResponse.body, {
      appId: app.id,
      route: headRoute,
      tag: 'link',
      attributes: { rel: 'alternate', hreflang: language, href },
      label: `hreflang ${language}`,
    });
  }
  assertHeadTag(evidence, headResponse.body, {
    appId: app.id,
    route: headRoute,
    tag: 'link',
    attributes: { rel: 'alternate', hreflang: 'x-default' },
    label: 'x-default hreflang',
  });
  for (const property of ['og:title', 'og:description', 'og:url', 'og:type']) {
    assertHeadTag(evidence, headResponse.body, {
      appId: app.id,
      route: headRoute,
      tag: 'meta',
      attributes: { property },
      label: property,
    });
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description']) {
    assertHeadTag(evidence, headResponse.body, {
      appId: app.id,
      route: headRoute,
      tag: 'meta',
      attributes: { name },
      label: name,
    });
  }
  assertHeadTag(evidence, headResponse.body, {
    appId: app.id,
    route: headRoute,
    tag: 'script',
    attributes: { type: 'application/ld+json' },
    label: 'JSON-LD structured data',
  });
}

async function validateNotFound(evidence, app, publicUrl) {
  const qualityGates = app.deploy?.cloudflare?.qualityGates ?? {};
  const notFoundRoute =
    qualityGates.statusCodes?.notFoundRoute ??
    '/__ultramodern-smoke-missing/nope';
  const expectedStatus = qualityGates.statusCodes?.unknownRouteStatus ?? 404;
  const response = await fetchText(joinUrl(publicUrl, notFoundRoute));
  evidence.assertions.push({
    type: 'status-code',
    route: notFoundRoute,
    expectedStatus,
    actualStatus: response.status,
    status: response.status === expectedStatus ? 'pass' : 'fail',
  });
  assert(
    response.status === expectedStatus,
    `${app.id} unknown route must return HTTP ${expectedStatus}, got ${response.status}`,
  );
  assertCloudflareSecurity(evidence, app, response, notFoundRoute, publicUrl, {
    html: response.contentType?.includes('text/html'),
  });
}

async function validateCssAsset(evidence, app, publicUrl, ssr) {
  const qualityGates = app.deploy?.cloudflare?.qualityGates ?? {};
  const budgets = qualityGates.budgets ?? {};
  const styleUrls = extractPreloadStyleUrls(ssr.link, publicUrl);
  evidence.assertions.push({
    type: 'css-preload-assets',
    actual: styleUrls,
    status: styleUrls.length > 0 ? 'pass' : 'fail',
  });
  assert(styleUrls.length > 0, `${app.id} SSR response did not expose preloadable CSS assets`);

  const styleUrl = styleUrls[0];
  const route = new URL(styleUrl).pathname;
  const css = await fetchText(styleUrl);
  evidence.assertions.push({
    type: 'css-asset',
    route,
    status: css.ok && css.body.trim() !== '' ? 'pass' : 'fail',
    statusCode: css.status,
  });
  assert(css.ok, `${app.id} CSS asset returned HTTP ${css.status}`);
  assert(css.body.trim() !== '', `${app.id} CSS asset is empty`);
  assertContentType(evidence, app, css, {
    route,
    includes: 'text/css',
  });
  assertCacheControl(evidence, app, css, {
    route,
    required: qualityGates.assets?.cacheControlRequiredForCss,
  });
  assertByteBudget(evidence, app, css, {
    label: 'cssAssetMaxBytes',
    maxBytes: budgets.cssAssetMaxBytes ?? 750_000,
    route,
  });
}

async function validatePublicSurface(evidence, app, publicUrl) {
  const publicSurface = app.routes?.publicSurface ?? {};
  const qualityGates = app.deploy?.cloudflare?.qualityGates ?? {};
  const budgets = qualityGates.budgets ?? {};
  const hasPublicRoutes =
    (publicSurface.publicRoutes ?? []).length > 0 ||
    (publicSurface.routeEntries ?? []).length > 0 ||
    (publicSurface.contentSources ?? []).length > 0;

  const robotsRoute = '/robots.txt';
  const robots = await fetchText(joinUrl(publicUrl, robotsRoute));
  evidence.assertions.push({
    type: 'public-surface-robots',
    route: robotsRoute,
    status: robots.ok ? 'pass' : 'fail',
    statusCode: robots.status,
  });
  assert(robots.ok, `${app.id} robots.txt returned HTTP ${robots.status}`);
  assertContentType(evidence, app, robots, {
    route: robotsRoute,
    includes: 'text/plain',
  });
  assertCloudflareSecurity(evidence, app, robots, robotsRoute, publicUrl);

  if (!hasPublicRoutes) {
    const disallowsAll = robots.body.includes('Disallow: /');
    const referencesSitemap = /\bSitemap:/iu.test(robots.body);
    evidence.assertions.push({
      type: 'public-surface-private-robots',
      route: robotsRoute,
      disallowsAll,
      referencesSitemap,
      status: disallowsAll && !referencesSitemap ? 'pass' : 'fail',
    });
    assert(disallowsAll, `${app.id} private public surface robots.txt must disallow crawling`);
    assert(!referencesSitemap, `${app.id} private public surface robots.txt must not reference sitemap.xml`);
    return;
  }

  const sitemapRoute = '/sitemap.xml';
  const sitemap = await fetchText(joinUrl(publicUrl, sitemapRoute));
  evidence.assertions.push({
    type: 'public-surface-sitemap',
    route: sitemapRoute,
    status: sitemap.ok ? 'pass' : 'fail',
    statusCode: sitemap.status,
  });
  assert(sitemap.ok, `${app.id} sitemap.xml returned HTTP ${sitemap.status}`);
  assertContentType(evidence, app, sitemap, {
    route: sitemapRoute,
    includes: 'xml',
  });
  assertByteBudget(evidence, app, sitemap, {
    label: 'sitemapXmlMaxBytes',
    maxBytes: budgets.sitemapXmlMaxBytes ?? 500_000,
    route: sitemapRoute,
  });

  const sitemapUrl = String(joinUrl(publicUrl, sitemapRoute));
  const robotsReferencesSitemap = robots.body.includes(`Sitemap: ${sitemapUrl}`);
  evidence.assertions.push({
    type: 'robots-sitemap-consistency',
    route: robotsRoute,
    sitemapUrl,
    status: robotsReferencesSitemap ? 'pass' : 'fail',
  });
  assert(
    robotsReferencesSitemap,
    `${app.id} robots.txt must reference generated sitemap.xml`,
  );

  for (const urlPath of publicSurface.concreteUrlPaths ?? []) {
    const loc = `<loc>${String(joinUrl(publicUrl, urlPath))}</loc>`;
    evidence.assertions.push({
      type: 'sitemap-route',
      route: urlPath,
      status: sitemap.body.includes(loc) ? 'pass' : 'fail',
    });
    assert(sitemap.body.includes(loc), `${app.id} sitemap.xml is missing ${urlPath}`);
  }

  const manifestRoute = '/site.webmanifest';
  const webManifest = await fetchText(joinUrl(publicUrl, manifestRoute));
  const webManifestJson = parseMaybeJson(webManifest.body);
  evidence.assertions.push({
    type: 'public-surface-webmanifest',
    route: manifestRoute,
    status: webManifest.ok && webManifestJson ? 'pass' : 'fail',
    statusCode: webManifest.status,
  });
  assert(webManifest.ok, `${app.id} site.webmanifest returned HTTP ${webManifest.status}`);
  assert(webManifestJson, `${app.id} site.webmanifest must be valid JSON`);
  assertContentType(evidence, app, webManifest, {
    route: manifestRoute,
    includes: 'manifest',
  });
}

function createAppEvidence(app, publicUrl) {
  const cloudflare = app.deploy?.cloudflare;

  return {
    appId: app.id,
    publicUrl,
    workerName: cloudflare?.workerName,
    publicUrlEnv: cloudflare?.publicUrlEnv,
    assertions: [],
  };
}

async function validateSsrEvidence(evidence, app, publicUrl, routes) {
  const cloudflare = app.deploy?.cloudflare;
  const qualityGates = cloudflare?.qualityGates ?? {};
  const budgets = qualityGates.budgets ?? {};

  const ssrRoute = routes.ssr ?? '/en';
  const ssr = await fetchText(joinUrl(publicUrl, ssrRoute));
  evidence.assertions.push({
    type: 'ssr',
    route: ssrRoute,
    status: ssr.ok ? 'pass' : 'fail',
    statusCode: ssr.status,
  });
  assert(ssr.ok, `${app.id} SSR route returned HTTP ${ssr.status}`);
  assertCloudflareSecurity(evidence, app, ssr, ssrRoute, publicUrl, {
    html: true,
  });
  assertContentType(evidence, app, ssr, {
    route: ssrRoute,
    includes: 'text/html',
  });
  assertByteBudget(evidence, app, ssr, {
    label: 'ssrHtmlMaxBytes',
    maxBytes: budgets.ssrHtmlMaxBytes ?? 250_000,
    route: ssrRoute,
  });
  await validateSsrHead(evidence, app, publicUrl, ssrRoute, ssr);
  await validateNotFound(evidence, app, publicUrl);
  await validatePublicSurface(evidence, app, publicUrl);

  return ssr;
}

function validateUiMarkerEvidence(evidence, app, ssr) {
  const uiMarker = extractUiMarker(ssr.body);
  evidence.assertions.push({
    type: 'ui-marker',
    expected: app.marker?.build,
    actual: uiMarker,
    status: uiMarker === app.marker?.build ? 'pass' : 'fail',
  });
  assert(uiMarker === app.marker?.build, `${app.id} UI marker mismatch`);

  if (app.deliveryUnit) {
    evidence.assertions.push({
      type: 'delivery-unit-ui-marker',
      unitId: app.deliveryUnit.unitId,
      expected: app.deliveryUnit.surfaces?.ui?.buildMarker ?? app.deliveryUnit.buildMarker,
      actual: uiMarker,
      status:
        uiMarker === (app.deliveryUnit.surfaces?.ui?.buildMarker ?? app.deliveryUnit.buildMarker)
          ? 'pass'
          : 'fail',
    });
    assert(
      uiMarker !== undefined,
      `${app.id} delivery unit ${app.deliveryUnit.unitId} is declared but SSR response is missing its build marker`,
    );
    assert(
      uiMarker === (app.deliveryUnit.surfaces?.ui?.buildMarker ?? app.deliveryUnit.buildMarker),
      `${app.id} delivery unit ${app.deliveryUnit.unitId} UI surface build marker mismatch`,
    );
  }
}

function validateCssRootMarkerEvidence(evidence, app, ssr) {
  const cssRootSelector = app.styling?.federation?.rootSelector;
  const expectedAppId = cssRootSelector?.match(/data-app-id="([^"]+)"/u)?.[1];
  evidence.assertions.push({
    type: 'css-root-marker',
    expected: cssRootSelector,
    status:
      expectedAppId && ssr.body.includes(`data-app-id="${expectedAppId}"`)
        ? 'pass'
        : 'fail',
  });
  assert(
    expectedAppId && ssr.body.includes(`data-app-id="${expectedAppId}"`),
    `${app.id} SSR response is missing CSS root marker ${cssRootSelector}`,
  );
}

function validateCssPreloadLinkEvidence(evidence, app, ssr) {
  const cssPreloadLinkHeader = ssr.link ?? '';
  evidence.assertions.push({
    type: 'css-preload-link-header',
    actual: cssPreloadLinkHeader,
    status:
      cssPreloadLinkHeader.includes('rel=preload') &&
      cssPreloadLinkHeader.includes('as=style')
        ? 'pass'
        : 'fail',
  });
  assert(
    cssPreloadLinkHeader.includes('rel=preload') &&
      cssPreloadLinkHeader.includes('as=style'),
    `${app.id} SSR response is missing CSS preload Link headers`,
  );
}

async function validateRenderedAssetEvidence(evidence, app, publicUrl, ssr) {
  validateUiMarkerEvidence(evidence, app, ssr);
  validateCssRootMarkerEvidence(evidence, app, ssr);
  validateCssPreloadLinkEvidence(evidence, app, ssr);
  await validateCssAsset(evidence, app, publicUrl, ssr);
}

async function validateModuleFederationManifestEvidence(evidence, app, publicUrl, routes) {
  const qualityGates = app.deploy?.cloudflare?.qualityGates ?? {};
  const budgets = qualityGates.budgets ?? {};

  const manifestRoute = routes.mfManifest ?? '/mf-manifest.json';
  const manifestUrl = joinUrl(publicUrl, manifestRoute);
  const manifest = await fetchText(manifestUrl);
  const manifestJson = parseMaybeJson(manifest.body);
  evidence.assertions.push({
    type: 'mf-manifest',
    route: manifestRoute,
    status: manifest.ok ? 'pass' : 'fail',
    statusCode: manifest.status,
  });
  assert(
    manifest.ok,
    `${app.id} MF manifest returned HTTP ${manifest.status}`,
  );
  assertCloudflareSecurity(evidence, app, manifest, manifestRoute, publicUrl);
  assertContentType(evidence, app, manifest, {
    route: manifestRoute,
    includes: 'json',
  });
  assertByteBudget(evidence, app, manifest, {
    label: 'mfManifestMaxBytes',
    maxBytes: budgets.mfManifestMaxBytes ?? 500_000,
    route: manifestRoute,
  });
  assertNoPublicSourcemapRefs(evidence, app, manifestJson);
  evidence.assertions.push({
    type: 'mf-manifest-cors',
    route: manifestRoute,
    actual: manifest.accessControlAllowOrigin,
    status: manifest.accessControlAllowOrigin === '*' ? 'pass' : 'fail',
  });
  assert(
    manifest.accessControlAllowOrigin === '*',
    `${app.id} MF manifest is missing Cloudflare CORS headers`,
  );
  const expectedPublicPath = normalizeUrlWithTrailingSlash(
    new URL('.', manifestUrl).toString(),
  );
  const manifestPublicPath = manifestJson?.metaData?.publicPath;
  const resolvedPublicPath = resolveModuleFederationPublicPath(
    manifestPublicPath,
    manifestUrl,
  );
  evidence.assertions.push({
    type: 'mf-manifest-public-path',
    expected: expectedPublicPath,
    actual: manifestPublicPath,
    resolved: resolvedPublicPath,
    status: resolvedPublicPath === expectedPublicPath ? 'pass' : 'fail',
  });
  assert(
    resolvedPublicPath === expectedPublicPath,
    `${app.id} MF manifest publicPath must resolve remote assets from ${expectedPublicPath}; got ${String(
      manifestPublicPath,
    )}`,
  );
}

async function validateI18nEvidence(evidence, app, publicUrl, routes) {
  const qualityGates = app.deploy?.cloudflare?.qualityGates ?? {};
  const budgets = qualityGates.budgets ?? {};

  const localeRoute = routes.locale ?? `/locales/en/${app.i18n?.namespace}.json`;
  const locale = await fetchText(joinUrl(publicUrl, localeRoute));
  const localeJson = parseMaybeJson(locale.body);
  evidence.assertions.push({
    type: 'i18n-marker',
    namespace: app.i18n?.namespace,
    route: localeRoute,
    status:
      locale.ok &&
      localeJson &&
      Object.hasOwn(localeJson, app.i18n?.namespace)
        ? 'pass'
        : 'fail',
    statusCode: locale.status,
  });
  assert(locale.ok, `${app.id} locale JSON returned HTTP ${locale.status}`);
  assertCloudflareSecurity(evidence, app, locale, localeRoute, publicUrl);
  assertContentType(evidence, app, locale, {
    route: localeRoute,
    includes: 'json',
  });
  assertByteBudget(evidence, app, locale, {
    label: 'localeJsonMaxBytes',
    maxBytes: budgets.localeJsonMaxBytes ?? 100_000,
    route: localeRoute,
  });
  evidence.assertions.push({
    type: 'i18n-cors',
    route: localeRoute,
    actual: locale.accessControlAllowOrigin,
    status: locale.accessControlAllowOrigin === '*' ? 'pass' : 'fail',
  });
  assert(
    locale.accessControlAllowOrigin === '*',
    `${app.id} locale JSON is missing Cloudflare CORS headers`,
  );
  assert(
    localeJson && Object.hasOwn(localeJson, app.i18n?.namespace),
    `${app.id} locale JSON is missing namespace ${app.i18n?.namespace}`,
  );
}

async function validateReadinessEvidence(evidence, app, publicUrl, routes) {
  if (routes.apiReadiness) {
    const readiness = await fetchText(joinUrl(publicUrl, routes.apiReadiness));
    const readinessJson = parseMaybeJson(readiness.body);
    const apiMarker = markerFromJson(readinessJson);
    evidence.assertions.push({
      type: 'api-marker',
      route: routes.apiReadiness,
      expected: app.marker?.build,
      actual: apiMarker,
      status: readiness.ok && apiMarker === app.marker?.build ? 'pass' : 'fail',
      statusCode: readiness.status,
    });
    assert(
      readiness.ok,
      `${app.id} Effect readiness returned HTTP ${readiness.status}`,
    );
    assert(apiMarker === app.marker?.build, `${app.id} API marker mismatch`);

    if (app.deliveryUnit) {
      evidence.assertions.push({
        type: 'delivery-unit-api-marker',
        route: routes.apiReadiness,
        unitId: app.deliveryUnit.unitId,
        expected: app.deliveryUnit.buildMarker,
        actual: apiMarker,
        status: apiMarker === app.deliveryUnit.buildMarker ? 'pass' : 'fail',
      });
      assert(
        apiMarker !== undefined,
        `${app.id} delivery unit ${app.deliveryUnit.unitId} is declared but readiness response is missing its build marker`,
      );
      assert(
        apiMarker === app.deliveryUnit.buildMarker,
        `${app.id} delivery unit ${app.deliveryUnit.unitId} API surface build marker mismatch`,
      );
    }
  }
}

async function validateServiceBindingEvidence(evidence, app, publicUrl) {
  const serviceBindings = app.deploy?.cloudflare?.serviceBindings ?? [];

  for (const binding of serviceBindings) {
    const method = String(binding.method ?? 'GET').toUpperCase();
    const response = await fetchText(joinUrl(publicUrl, binding.route), {
      method,
      headers: {
        accept: 'application/json',
        ...(binding.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(binding.body === undefined
        ? {}
        : { body: JSON.stringify(binding.body) }),
    });
    const responseJson = parseMaybeJson(response.body);
    const expectations = normalizeJsonSmokeExpectations(binding);
    const apiMarker = markerFromJson(responseJson);
    const passed =
      response.ok &&
      (expectations.length > 0
        ? expectations.every(expectation =>
            jsonValuesEqual(
              jsonPathValue(responseJson, expectation.path),
              expectation.equals,
            ),
          )
        : apiMarker === binding.expectedMarker);

    evidence.assertions.push({
      type:
        expectations.length > 0
          ? 'service-binding-json'
          : 'service-binding-api-marker',
      appId: binding.appId,
      binding: binding.binding,
      method,
      route: binding.route,
      expected:
        expectations.length > 0 ? expectations : binding.expectedMarker,
      actual: expectations.length > 0 ? responseJson : apiMarker,
      status: passed ? 'pass' : 'fail',
      statusCode: response.status,
    });
    assert(
      response.ok,
      `${app.id} service binding ${binding.binding} returned HTTP ${response.status}`,
    );
    assert(passed, `${app.id} service binding ${binding.binding} mismatch`);
  }
}

async function validateJsonSmokeEvidence(evidence, app, publicUrl) {
  const checks = app.deploy?.cloudflare?.jsonSmokeChecks ?? [];

  for (const check of checks) {
    const route = check.route;
    assert(
      typeof route === 'string' && route.length > 0,
      `${app.id} JSON smoke check is missing a route`,
    );

    const method = String(check.method ?? 'GET').toUpperCase();
    const requestBody =
      check.body ?? check.payload ?? check.requestBody ?? undefined;
    const response = await fetchText(joinUrl(publicUrl, route), {
      method,
      headers: {
        accept: 'application/json',
        ...(requestBody === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(requestBody === undefined
        ? {}
        : { body: JSON.stringify(requestBody) }),
    });
    const responseJson = parseMaybeJson(response.body);
    const checkId = check.id ?? route;

    evidence.assertions.push({
      type: 'json-smoke-http',
      id: checkId,
      method,
      route,
      status: response.ok && responseJson !== undefined ? 'pass' : 'fail',
      statusCode: response.status,
    });
    assert(
      response.ok,
      `${app.id} JSON smoke ${checkId} returned HTTP ${response.status}`,
    );
    assert(
      responseJson !== undefined,
      `${app.id} JSON smoke ${checkId} did not return JSON`,
    );

    for (const expectation of normalizeJsonSmokeExpectations(check)) {
      const actual = jsonPathValue(responseJson, expectation.path);
      const passed = jsonValuesEqual(actual, expectation.equals);

      evidence.assertions.push({
        type: 'json-smoke-value',
        id: checkId,
        route,
        path: expectation.path,
        expected: expectation.equals,
        actual,
        status: passed ? 'pass' : 'fail',
      });
      assert(
        passed,
        `${app.id} JSON smoke ${checkId} expected ${expectation.path} to equal ${JSON.stringify(
          expectation.equals,
        )}`,
      );
    }
  }
}

async function validateApp(app, publicUrl) {
  const routes = app.deploy?.cloudflare?.routes ?? {};
  const evidence = createAppEvidence(app, publicUrl);

  if (routes.rpc) {
    const rpcSmokeCheck = (
      app.deploy?.cloudflare?.jsonSmokeChecks ?? []
    ).find(
      check =>
        check.route === routes.rpc &&
        String(check.method ?? 'GET').toUpperCase() === 'POST',
    );
    assert(
      rpcSmokeCheck,
      `${app.id} RPC route ${routes.rpc} requires a POST JSON smoke check`,
    );
  }

  if (routes.ssr) {
    const ssr = await validateSsrEvidence(evidence, app, publicUrl, routes);
    await validateRenderedAssetEvidence(evidence, app, publicUrl, ssr);
  }
  if (routes.mfManifest) {
    await validateModuleFederationManifestEvidence(
      evidence,
      app,
      publicUrl,
      routes,
    );
  }
  if (routes.locale) {
    await validateI18nEvidence(evidence, app, publicUrl, routes);
  }
  await validateReadinessEvidence(evidence, app, publicUrl, routes);
  await validateServiceBindingEvidence(evidence, app, publicUrl);
  await validateJsonSmokeEvidence(evidence, app, publicUrl);

  assert(
    evidence.assertions.length > 0,
    `${app.id} Cloudflare proof has no behavioral route checks`,
  );

  return evidence;
}

export { resolveModuleFederationPublicPath, validateApp };
