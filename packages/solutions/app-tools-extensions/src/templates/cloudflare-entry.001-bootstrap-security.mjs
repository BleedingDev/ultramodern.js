const ASSETS_BINDING = 'ASSETS';
const MODERN_WORKER_MANIFEST = p_workerManifest;
export const modernWorkerManifest = MODERN_WORKER_MANIFEST;
const WORKER_MODULE_LOADERS = p_workerModuleLoaders;
const workerModulePromises = new Map();
const effectBffDispatcherPromises = new Map();
const remoteJsonPromises = new Map();
const CORS_POLICY = MODERN_WORKER_MANIFEST.security?.cors || {};
const ASSET_CORS_ENABLED = CORS_POLICY.assets !== false;
const APP_CORS_ALLOWED_ORIGINS = (CORS_POLICY.allowedOrigins || []).map(
  origin => String(origin).toLowerCase(),
);
const APP_CORS_ALLOWED_METHODS = (
  CORS_POLICY.allowedMethods?.length
    ? CORS_POLICY.allowedMethods
    : ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
).join(', ');
const APP_CORS_ALLOWED_HEADERS = (
  CORS_POLICY.allowedHeaders?.length ? CORS_POLICY.allowedHeaders : ['*']
).join(', ');
const ASSET_CORS_HEADERS = {
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-origin': '*',
};

globalThis.__dirname ??= '/';
globalThis.__filename ??= '/index.js';

function getAllowedAppCorsOrigin(request) {
  if (APP_CORS_ALLOWED_ORIGINS.length === 0) {
    return null;
  }

  const origin = request.headers.get('origin');

  if (!origin) {
    return null;
  }

  if (APP_CORS_ALLOWED_ORIGINS.includes('*')) {
    return '*';
  }

  return APP_CORS_ALLOWED_ORIGINS.includes(origin.toLowerCase())
    ? origin
    : null;
}

function appendVaryOrigin(headers) {
  const vary = headers.get('vary');

  if (!vary) {
    headers.set('vary', 'origin');
    return;
  }

  const varyValues = vary.split(',').map(value => value.trim().toLowerCase());

  if (!varyValues.includes('origin')) {
    headers.set('vary', `${vary}, origin`);
  }
}

function withAppCorsHeaders(response, request) {
  const allowedOrigin = getAllowedAppCorsOrigin(request);

  if (!allowedOrigin) {
    return response;
  }

  const headers = new Headers(response.headers);

  if (!headers.has('access-control-allow-origin')) {
    headers.set('access-control-allow-origin', allowedOrigin);
  }

  if (allowedOrigin !== '*') {
    appendVaryOrigin(headers);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function withAssetCorsHeaders(response) {
  if (!ASSET_CORS_ENABLED) {
    return response;
  }

  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(ASSET_CORS_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function setHeaderIfEnabled(headers, name, value) {
  if (value === false || typeof value !== 'string' || value.trim() === '') {
    return;
  }

  if (!headers.has(name)) {
    headers.set(name, value);
  }
}

function renderContentSecurityPolicy(directives) {
  return Object.entries(directives || {})
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

function isHtmlResponse(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
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

function shouldNoindex(request, noindex) {
  if (!noindex || noindex === false) {
    return false;
  }

  const { hostname } = new URL(request.url);
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

function withCloudflareSecurityHeaders(response, request) {
  const security = MODERN_WORKER_MANIFEST.security;

  if (!security || security.enabled === false) {
    return response;
  }

  const headers = new Headers(response.headers);
  const configuredHeaders = security.headers || {};

  setHeaderIfEnabled(
    headers,
    'referrer-policy',
    configuredHeaders.referrerPolicy,
  );
  setHeaderIfEnabled(
    headers,
    'x-content-type-options',
    configuredHeaders.contentTypeOptions,
  );
  setHeaderIfEnabled(
    headers,
    'permissions-policy',
    configuredHeaders.permissionsPolicy,
  );

  const csp = security.contentSecurityPolicy;
  const cspHeader =
    csp?.mode === 'enforce'
      ? 'content-security-policy'
      : 'content-security-policy-report-only';
  const cspValue = renderContentSecurityPolicy(csp?.directives);

  if (
    isHtmlResponse(response) &&
    csp?.mode !== 'off' &&
    cspValue &&
    !headers.has(cspHeader)
  ) {
    headers.set(cspHeader, cspValue);
  }

  if (shouldNoindex(request, security.noindex)) {
    headers.set('x-robots-tag', 'noindex, nofollow');
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function createRenderableRequest(request) {
  if (request.method !== 'HEAD') {
    return request;
  }

  return new Request(request, { method: 'GET' });
}

function finalizeResponseForRequest(response, request) {
  const securedResponse = withCloudflareSecurityHeaders(response, request);

  if (request.method !== 'HEAD') {
    return securedResponse;
  }

  const headers = new Headers(securedResponse.headers);
  headers.delete('content-length');

  return new Response(null, {
    headers,
    status: securedResponse.status,
    statusText: securedResponse.statusText,
  });
}
