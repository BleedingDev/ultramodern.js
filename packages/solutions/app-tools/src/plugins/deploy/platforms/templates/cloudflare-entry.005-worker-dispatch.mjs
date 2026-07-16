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

async function loadEffectEdgeRuntime() {
  effectEdgeRuntimePromise ??= import('@modern-js/plugin-bff/effect-edge');

  return effectEdgeRuntimePromise;
}

function getRuntimeModule(workerModule) {
  const defaultExport = workerModule.default;
  const nestedDefaultExport =
    defaultExport && typeof defaultExport === 'object'
      ? defaultExport.default
      : undefined;

  return defaultExport && typeof defaultExport === 'object'
    ? {
        ...workerModule,
        ...defaultExport,
        ...(nestedDefaultExport && typeof nestedDefaultExport === 'object'
          ? nestedDefaultExport
          : {}),
      }
    : workerModule;
}

function getFetchHandler(workerModule) {
  const defaultExport = workerModule.default;
  const runtime = getRuntimeModule(workerModule);

  return (
    (typeof runtime.fetch === 'function' && runtime.fetch.bind(runtime)) ||
    (typeof defaultExport === 'function' &&
      defaultExport.fetch?.bind?.(defaultExport))
  );
}

async function getRequestHandler(workerModule) {
  const defaultExport = workerModule.default;
  const runtime = getRuntimeModule(workerModule);

  return (
    (await workerModule.requestHandler) ||
    (await runtime.requestHandler) ||
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

    return withRouteCssLinks(
      await requestHandler(request, requestHandlerOptions),
      route,
      requestHandlerOptions.resource.routeManifest,
      request,
      env,
      requestHandlerOptions.locals[
        DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY
      ]?.getStylesheetHrefs(),
    );
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
  const defaultExport = workerModule.default;
  const runtime = getRuntimeModule(workerModule);

  if (bff.runtimeFramework === 'effect') {
    let effectDispatcherPromise = effectBffDispatcherPromises.get(bff.worker);

    if (!effectDispatcherPromise) {
      const { createEffectBffEdgeDispatcher } = await loadEffectEdgeRuntime();

      effectDispatcherPromise = createEffectBffEdgeDispatcher({
        module: runtime,
        prefix: bff.prefix,
      });
      effectBffDispatcherPromises.set(bff.worker, effectDispatcherPromise);
    }

    const effectDispatcher = await effectDispatcherPromise;
    return effectDispatcher.dispatch(request, { env });
  }

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

  const effectContext = {
    request: mountedRequest,
    env: env || {},
    path: new URL(request.url).pathname,
    method: request.method,
    operationContext: {
      request: mountedRequest,
      env: env || {},
      path: new URL(request.url).pathname,
      method: request.method,
    },
  };

  return handler(mountedRequest, effectContext);
}

const MICROVERTICAL_SERVER_FALLBACK_EVENT =
  'modernjs:microvertical-server-fallback';

// Typed degraded event for an unavailable service binding. Mirrors the shape
// of the runtime MF fallback telemetry payload (schemaVersion 1) under the
// server-side event name, so shell-level consumers see one degraded contract
// across platforms.
function createServiceBindingDegradedEvent(binding, pathname) {
  return {
    appName: 'modern-js-cloudflare-worker',
    eventName: MICROVERTICAL_SERVER_FALLBACK_EVENT,
    phase: 'discovery',
    reason: 'remote-unavailable',
    schemaVersion: 1,
    metadata: {
      classification: 'remote-unavailable',
      pathname,
      platform: 'cloudflare-service-binding',
      prefix: binding.prefix,
      remote: binding.binding,
      serviceBinding: binding.binding,
      status: 'degraded',
    },
  };
}

async function dispatchServiceBindingRequest(request, env) {
  const serviceBindings = MODERN_WORKER_MANIFEST.serviceBindings;

  if (!Array.isArray(serviceBindings) || serviceBindings.length === 0) {
    return null;
  }

  const pathname = new URL(request.url).pathname;

  for (const binding of serviceBindings) {
    if (!binding?.binding || !binding?.prefix) {
      continue;
    }

    if (!matchesPrefix(pathname, binding.prefix)) {
      continue;
    }

    const service = env?.[binding.binding];

    if (!service || typeof service.fetch !== 'function') {
      const degradedEvent = createServiceBindingDegradedEvent(
        binding,
        pathname,
      );

      // Telemetry emission: workers surface structured logs via tail/analytics.
      // The degraded path must never fail because a log sink did.
      try {
        console.error(JSON.stringify(degradedEvent));
      } catch {}

      return new Response(
        `Cloudflare service binding not available: ${binding.binding}`,
        {
          status: 502,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'x-modern-js-service-binding': binding.binding,
            'x-modern-js-degraded': degradedEvent.metadata.classification,
            'x-modern-js-telemetry-event': degradedEvent.eventName,
          },
        },
      );
    }

    return service.fetch(request);
  }

  return null;
}
