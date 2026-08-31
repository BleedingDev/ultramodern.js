function isFingerprintedAssetPathname(pathname) {
  return /(?:^|\/)[^/]+\.[a-f0-9]{8,}\.(?:css|js|mjs|json|svg|png|jpe?g|webp|avif|gif|woff2?|ttf)$/iu.test(
    pathname,
  );
}

function withAssetHeaders(response, request) {
  const corsResponse = withAssetCorsHeaders(response);
  const headers = new Headers(corsResponse.headers);
  const { pathname } = new URL(request.url);

  if (isFingerprintedAssetPathname(pathname)) {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
  }

  return new Response(corsResponse.body, {
    headers,
    status: corsResponse.status,
    statusText: corsResponse.statusText,
  });
}

async function createCorsPreflightResponse(request, env) {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const allowedOrigin = getAllowedAppCorsOrigin(request);

  if (allowedOrigin) {
    const headers = new Headers({
      'access-control-allow-headers': APP_CORS_ALLOWED_HEADERS,
      'access-control-allow-methods': APP_CORS_ALLOWED_METHODS,
      'access-control-allow-origin': allowedOrigin,
    });

    if (allowedOrigin !== '*') {
      headers.set('vary', 'origin');
    }

    return new Response(null, {
      headers,
      status: 204,
    });
  }

  return null;
}

async function fetchAsset(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  const assets = env?.[ASSETS_BINDING];

  if (!assets || typeof assets.fetch !== 'function') {
    return null;
  }

  const response = await assets.fetch(request);

  if (response.status === 404) {
    return null;
  }

  return withAssetHeaders(response, request);
}

async function fetchAssetByPath(pathname, request, env) {
  const url = new URL(request.url);
  url.pathname = `/${pathname.replace(/^\/+/u, '')}`;

  return fetchAsset(new Request(url, request), env);
}

async function fetchAssetByPathFollowingRedirects(
  pathname,
  request,
  env,
  visited = new Set(),
) {
  const normalizedPathname = pathname.startsWith('/')
    ? pathname
    : `/${pathname}`;

  if (visited.has(normalizedPathname)) {
    return null;
  }

  visited.add(normalizedPathname);

  const response = await fetchAssetByPath(normalizedPathname, request, env);

  if (
    response &&
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has('location')
  ) {
    const location = response.headers.get('location');

    if (location) {
      const nextUrl = new URL(location, request.url);
      const currentUrl = new URL(request.url);

      if (nextUrl.origin === currentUrl.origin) {
        return fetchAssetByPathFollowingRedirects(
          nextUrl.pathname,
          request,
          env,
          visited,
        );
      }
    }
  }

  return response;
}

async function readAssetText(pathname, request, env) {
  const response = await fetchAssetByPathFollowingRedirects(
    pathname,
    request,
    env,
  );

  if (!response || !response.ok) {
    return undefined;
  }

  return response.text();
}

async function readAssetJson(pathname, request, env) {
  const text = await readAssetText(pathname, request, env);

  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

function normalizeRoutePath(pathname) {
  if (pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/u, '');
}

function getPathExtension(pathname) {
  const lastSegment = pathname.split('/').pop() || '';
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return '';
  }

  return lastSegment.slice(dotIndex).toLowerCase();
}

function isAssetLikePathname(pathname) {
  const extension = getPathExtension(pathname);

  return extension !== '';
}

function routeMatchesExactly(route, pathname) {
  if (typeof route?.urlPath !== 'string') {
    return false;
  }

  return normalizeRoutePath(route.urlPath) === normalizeRoutePath(pathname);
}

function routeMatches(route, pathname) {
  if (typeof route.urlPath !== 'string') {
    return false;
  }

  const routePath = normalizeRoutePath(route.urlPath);
  const requestPath = normalizeRoutePath(pathname);

  return (
    routePath === requestPath ||
    (routePath === '/' && route.isSSR) ||
    requestPath.startsWith(`${routePath}/`)
  );
}
