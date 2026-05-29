const ASSETS_BINDING = 'ASSETS';
const MODERN_WORKER_MANIFEST = p_workerManifest;
const WORKER_MODULE_LOADERS = p_workerModuleLoaders;
const workerModulePromises = new Map();
const CORS_HEADERS = {
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-origin': '*',
};

globalThis.__dirname ??= '/';
globalThis.__filename ??= '/index.js';

function withCorsHeaders(response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(CORS_HEADERS)) {
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

function createCorsPreflightResponse(request) {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  return new Response(null, {
    headers: CORS_HEADERS,
    status: 204,
  });
}

async function fetchAsset(request, env) {
  const assets = env?.[ASSETS_BINDING];

  if (!assets || typeof assets.fetch !== 'function') {
    return null;
  }

  const response = await assets.fetch(request);

  if (response.status === 404) {
    return null;
  }

  return withCorsHeaders(response);
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

function findRoute(request) {
  const { pathname } = new URL(request.url);
  const routes = MODERN_WORKER_MANIFEST.routeSpec.routes;

  return [...routes]
    .sort((left, right) => {
      const leftLength = left.urlPath?.length || 0;
      const rightLength = right.urlPath?.length || 0;

      return rightLength - leftLength;
    })
    .find(route => routeMatches(route, pathname));
}

async function fetchRouteHtml(route, request, env) {
  if (!route?.entryPath) {
    return null;
  }

  return fetchAssetByPath(route.entryPath, request, env);
}

function createNoopMonitors() {
  const noop = () => {};

  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
}

function createRequestHandlerOptions({
  route,
  htmlTemplate,
  routeManifest,
  loadableStats,
}) {
  const monitors = createNoopMonitors();

  return {
    resource: {
      route,
      routeManifest,
      loadableStats,
      htmlTemplate,
      entryName: route.entryName,
    },
    params: {},
    loaderContext: {},
    config: {},
    locals: {},
    staticGenerate: false,
    monitors,
    onError(error) {
      monitors.error(error);
    },
    onTiming() {},
    reporter: {
      reportTiming: () => {},
    },
  };
}

async function getRequestHandlerOptions(route, request, env) {
  const [htmlTemplate, routeManifest, loadableStats] = await Promise.all([
    readAssetText(route.entryPath, request, env),
    readAssetJson(MODERN_WORKER_MANIFEST.resources.routeManifest, request, env),
    readAssetJson(MODERN_WORKER_MANIFEST.resources.loadableStats, request, env),
  ]);

  return createRequestHandlerOptions({
    route,
    htmlTemplate: htmlTemplate || '',
    routeManifest,
    loadableStats,
  });
}

async function loadWorkerModule(workerPath) {
  const loader = WORKER_MODULE_LOADERS[workerPath];

  if (!loader) {
    return undefined;
  }

  if (!workerModulePromises.has(workerPath)) {
    workerModulePromises.set(workerPath, loader());
  }

  return workerModulePromises.get(workerPath);
}

function getFetchHandler(workerModule) {
  const defaultExport = workerModule.default;

  return (
    (defaultExport &&
      typeof defaultExport === 'object' &&
      typeof defaultExport.fetch === 'function' &&
      defaultExport.fetch.bind(defaultExport)) ||
    (typeof workerModule.fetch === 'function' && workerModule.fetch)
  );
}

async function getRequestHandler(workerModule) {
  const defaultExport = workerModule.default;
  const defaultRequestHandler =
    defaultExport &&
    typeof defaultExport === 'object' &&
    'requestHandler' in defaultExport
      ? defaultExport.requestHandler
      : undefined;

  return (
    (await workerModule.requestHandler) ||
    (await defaultRequestHandler) ||
    (typeof defaultExport === 'function' ? defaultExport : undefined)
  );
}

async function dispatchRouteWorker(route, request, env, ctx) {
  const workerPath = route.worker;
  if (!workerPath) {
    return new Response('Worker bundle not configured for SSR route', {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const workerModule = await loadWorkerModule(workerPath);

  if (!workerModule) {
    return new Response(`Worker bundle not found: ${workerPath}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-modern-js-route-worker': workerPath,
      },
    });
  }

  const fetchHandler = getFetchHandler(workerModule);

  if (fetchHandler) {
    return fetchHandler(request, env, ctx);
  }

  const requestHandler = await getRequestHandler(workerModule);

  if (typeof requestHandler === 'function') {
    const requestHandlerOptions = await getRequestHandlerOptions(
      route,
      request,
      env,
    );

    return requestHandler(request, requestHandlerOptions);
  }

  return new Response(
    `Worker bundle has no fetch or requestHandler export: ${workerPath}`,
    {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-modern-js-route-worker': workerPath,
      },
    },
  );
}

function matchesPrefix(pathname, prefix) {
  if (!prefix || prefix === '/') {
    return true;
  }

  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

function createRequestForMountedPrefix(request, prefix) {
  if (!prefix || prefix === '/') {
    return request;
  }

  const url = new URL(request.url);
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

  if (!matchesPrefix(url.pathname, normalized)) {
    return request;
  }

  const nextPath = url.pathname.slice(normalized.length) || '/';
  url.pathname = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;

  return new Request(url, request);
}

function createEffectContext(originalRequest, mountedRequest, env) {
  const url = new URL(originalRequest.url);

  return {
    request: mountedRequest,
    env: env || {},
    path: url.pathname,
    method: originalRequest.method,
    operationContext: {
      request: mountedRequest,
      env: env || {},
      path: url.pathname,
      method: originalRequest.method,
    },
  };
}

async function dispatchBffRequest(request, env) {
  const bff = MODERN_WORKER_MANIFEST.bff;

  if (
    !bff?.worker ||
    !matchesPrefix(new URL(request.url).pathname, bff.prefix)
  ) {
    return null;
  }

  const workerModule = await loadWorkerModule(bff.worker);

  if (!workerModule) {
    return new Response(`BFF worker bundle not found: ${bff.worker}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-modern-js-bff-worker': bff.worker,
      },
    });
  }

  const mountedRequest = createRequestForMountedPrefix(request, bff.prefix);
  const effectContext = createEffectContext(request, mountedRequest, env);
  const defaultExport = workerModule.default;
  const runtime =
    defaultExport && typeof defaultExport === 'object'
      ? {
          ...workerModule,
          ...defaultExport,
        }
      : workerModule;
  const directHandler =
    (typeof runtime.handler === 'function' && runtime.handler) ||
    (typeof defaultExport === 'function' && defaultExport);
  const createdHandler =
    typeof runtime.createHandler === 'function'
      ? runtime.createHandler().handler
      : undefined;
  const handler = directHandler || createdHandler;

  if (typeof handler !== 'function') {
    return new Response(
      `BFF worker bundle has no handler export: ${bff.worker}`,
      {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-modern-js-bff-worker': bff.worker,
        },
      },
    );
  }

  return handler.length > 1
    ? handler(mountedRequest, effectContext)
    : handler(mountedRequest);
}

export default {
  async fetch(request, env, ctx) {
    const corsPreflightResponse = createCorsPreflightResponse(request);

    if (corsPreflightResponse) {
      return corsPreflightResponse;
    }

    const assetResponse = await fetchAsset(request, env);

    if (assetResponse) {
      return assetResponse;
    }

    const bffResponse = await dispatchBffRequest(request, env);

    if (bffResponse) {
      return withCorsHeaders(bffResponse);
    }

    const route = findRoute(request);

    if (route?.worker) {
      return withCorsHeaders(
        await dispatchRouteWorker(route, request, env, ctx),
      );
    }

    const htmlResponse = await fetchRouteHtml(route, request, env);

    if (htmlResponse) {
      return htmlResponse;
    }

    return withCorsHeaders(new Response('Not found', { status: 404 }));
  },
};
