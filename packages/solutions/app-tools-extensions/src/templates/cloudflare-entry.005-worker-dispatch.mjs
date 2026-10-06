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

function createWorkerRendererGuardResponse(request) {
  const deliveryUnit = MODERN_WORKER_MANIFEST.deliveryUnit;
  const surfaces = deliveryUnit?.surfaces;
  // API identity is universal. Only an explicit UI surface selects a renderer.
  if (!surfaces || !Object.hasOwn(surfaces, 'ui')) {
    return undefined;
  }

  const ui = surfaces.ui;
  const identity = ui?.rendererIdentity;
  const profile = ui?.rendererProfile;
  const isNative = [identity?.renderer, profile?.renderer].some(
    renderer => renderer === 'solid' || renderer === 'octane',
  );
  if (
    isNative &&
    (request.headers.has('x-rsc-tree') || request.headers.has('x-rsc-action'))
  ) {
    return Response.json(
      { code: 'unsupported-renderer-capability', capability: 'rsc' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const isRecord = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const isCanonicalString = value =>
    typeof value === 'string' && value.length > 0 && value.trim() === value;
  const hasExactFields = (value, fields) =>
    isRecord(value) &&
    Object.keys(value).every(field => fields.includes(field)) &&
    fields.every(field => Object.hasOwn(value, field));
  const exactVersion =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
  const isPackageIdentity = (value, router = false, hydration = false) => {
    const fields = router
      ? ['name', 'version', 'coreName', 'coreVersion']
      : ['name', 'version'];
    return (
      hasExactFields(value, fields) &&
      isCanonicalString(value.name) &&
      (!router || isCanonicalString(value.coreName)) &&
      (router ? ['version', 'coreVersion'] : ['version']).every(
        field =>
          isCanonicalString(value[field]) &&
          (exactVersion.test(value[field]) ||
            (hydration && /^[1-9]\d*$/u.test(value[field]))),
      )
    );
  };
  const validMetadata =
    isRecord(ui) &&
    ui.surface === 'ui' &&
    hasExactFields(identity, [
      'renderer',
      'appId',
      'entryName',
      'protocolVersion',
      'buildId',
    ]) &&
    ['react', 'solid', 'octane'].includes(identity.renderer) &&
    identity.protocolVersion === 1 &&
    ['appId', 'entryName', 'buildId'].every(field =>
      isCanonicalString(identity[field]),
    ) &&
    identity.appId === ui.appId &&
    ui.appId === deliveryUnit.appId &&
    identity.buildId === ui.buildMarker &&
    ui.buildMarker === deliveryUnit.buildMarker &&
    hasExactFields(profile, [
      'renderer',
      'protocolVersion',
      'compiler',
      'hydration',
      'router',
    ]) &&
    profile.renderer === identity.renderer &&
    profile.protocolVersion === identity.protocolVersion &&
    isPackageIdentity(profile.compiler) &&
    isPackageIdentity(profile.hydration, false, true) &&
    isPackageIdentity(profile.router, true);

  if (!validMetadata) {
    return Response.json(
      { code: 'invalid-renderer-metadata' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (isNative) {
    return Response.json(
      {
        code: 'unsupported-renderer-capability',
        capability: 'cloudflare-worker',
        renderer: identity.renderer,
      },
      { status: 501, headers: { 'cache-control': 'no-store' } },
    );
  }
  return undefined;
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
  const rendererRejection = createWorkerRendererGuardResponse(request);
  if (rendererRejection) return rendererRejection;

  return withWorkerRendererIdentity(
    await invokeRouteWorker(route, request, env, ctx),
    route,
  );
}

function createWorkerRendererErrorResponse(code, entryName) {
  return Response.json(
    { code, entryName: String(entryName) },
    { status: 500, headers: { 'cache-control': 'no-store' } },
  );
}

function withWorkerRendererIdentity(response, route) {
  const identities = MODERN_WORKER_MANIFEST.rendererIdentities;
  if (!identities) return response;
  if (!Object.hasOwn(identities, route.entryName)) {
    // Do not let a manifest/route mismatch escape fetch and fail the isolate.
    response.body?.cancel().catch(() => {});
    return createWorkerRendererErrorResponse(
      'missing-renderer-identity',
      route.entryName,
    );
  }
  const headers = new Headers(response.headers);
  headers.set(
    'x-ultramodern-renderer-identity',
    JSON.stringify(identities[route.entryName]),
  );
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function invokeRouteWorker(route, request, env, ctx) {
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

  const runtime = getRuntimeModule(workerModule);
  // Match the native server dispatcher: actions precede Flight trees, and
  // neither path may fall back to HTML rendering or rewrite the Request body.
  if (request.headers.get('x-rsc-action')) {
    const handleAction = await runtime.handleAction;
    if (typeof handleAction !== 'function') {
      return new Response('Cannot find server action handler', { status: 500 });
    }
    return handleAction(request);
  }

  if (request.headers.get('x-rsc-tree')) {
    const rscPayloadHandler = await runtime.rscPayloadHandler;
    if (typeof rscPayloadHandler !== 'function') {
      return new Response('Cannot find request handler for RSC', {
        status: 500,
      });
    }
    return rscPayloadHandler(
      request,
      await getRequestHandlerOptions(route, request, env, ctx, false),
    );
  }

  const requestHandler = await getRequestHandler(workerModule);

  if (typeof requestHandler === 'function') {
    const requestHandlerOptions = await getRequestHandlerOptions(
      route,
      request,
      env,
      ctx,
    );

    return withRouteCssLinks(
      await requestHandler(request, requestHandlerOptions),
      route,
      requestHandlerOptions.resource.routeManifest,
      request,
      env,
      undefined,
      requestHandlerOptions.locals[DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY],
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

function createEffectBffDispatcherErrorResponse(bff, error) {
  return new Response(
    `Effect BFF dispatcher initialization failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-modern-js-bff-dispatcher': String(bff.dispatcherExport || ''),
        'x-modern-js-bff-worker': bff.worker,
      },
    },
  );
}

function getEffectBffDispatcher(bff, runtime) {
  let effectDispatcherPromise = effectBffDispatcherPromises.get(bff.worker);

  if (effectDispatcherPromise) {
    return effectDispatcherPromise;
  }

  effectDispatcherPromise = Promise.resolve().then(async () => {
    if (
      typeof bff.dispatcherExport !== 'string' ||
      bff.dispatcherExport.length === 0
    ) {
      throw new Error('manifest does not declare dispatcherExport');
    }

    const effectDispatcherFactory = runtime[bff.dispatcherExport];

    if (typeof effectDispatcherFactory !== 'function') {
      throw new Error(`worker bundle does not export ${bff.dispatcherExport}`);
    }

    const effectConfig = bff.effect;
    if (
      !effectConfig ||
      typeof effectConfig !== 'object' ||
      Array.isArray(effectConfig)
    ) {
      throw new Error('manifest declares invalid Effect BFF runtime config');
    }
    const crossProjectPolicy = effectConfig.crossProjectPolicy;
    if (
      !crossProjectPolicy ||
      typeof crossProjectPolicy !== 'object' ||
      Array.isArray(crossProjectPolicy)
    ) {
      throw new Error(
        'manifest declares invalid Effect BFF cross-project policy',
      );
    }
    for (const field of [
      'enabled',
      'requireEnvelope',
      'requireOperationContext',
      'requireOperationContextDetails',
      'requireOperationSchemaHash',
      'requireOperationVersion',
      'allowUnknownOperations',
    ]) {
      if (typeof crossProjectPolicy[field] !== 'boolean') {
        throw new Error(
          `manifest Effect BFF cross-project policy requires boolean ${field}`,
        );
      }
    }
    if (
      !crossProjectPolicy.expectedOperationContracts ||
      typeof crossProjectPolicy.expectedOperationContracts !== 'object' ||
      Array.isArray(crossProjectPolicy.expectedOperationContracts)
    ) {
      throw new Error(
        'manifest Effect BFF cross-project policy requires expectedOperationContracts object',
      );
    }

    const effectDispatcher = await effectDispatcherFactory({
      prefix: bff.prefix,
      ...(effectConfig?.openapi === undefined
        ? {}
        : { openapi: effectConfig.openapi }),
      ...(effectConfig?.dataPlatform === undefined
        ? {}
        : { dataPlatform: effectConfig.dataPlatform }),
      ...(effectConfig?.crossProjectPolicy === undefined
        ? {}
        : { crossProjectPolicy }),
    });

    if (!effectDispatcher || typeof effectDispatcher.dispatch !== 'function') {
      try {
        await effectDispatcher?.dispose?.();
      } catch {}

      throw new Error(
        `worker export ${bff.dispatcherExport} did not return a dispatcher with a dispatch function`,
      );
    }

    return effectDispatcher;
  });

  effectBffDispatcherPromises.set(bff.worker, effectDispatcherPromise);
  effectDispatcherPromise.catch(() => {
    if (
      effectBffDispatcherPromises.get(bff.worker) === effectDispatcherPromise
    ) {
      effectBffDispatcherPromises.delete(bff.worker);
    }
  });

  return effectDispatcherPromise;
}

async function dispatchBffRequest(request, env) {
  const rendererRejection = createWorkerRendererGuardResponse(request);
  if (rendererRejection) return rendererRejection;
  const bff = MODERN_WORKER_MANIFEST.bff;

  if (
    !bff?.worker ||
    !matchesPrefix(new URL(request.url).pathname, bff.prefix)
  ) {
    return null;
  }
  if (bff.runtimeFramework !== 'effect') {
    return createEffectBffDispatcherErrorResponse(
      bff,
      new Error('manifest must declare runtimeFramework "effect"'),
    );
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
    let effectDispatcher;

    try {
      effectDispatcher = await getEffectBffDispatcher(bff, runtime);
    } catch (error) {
      return createEffectBffDispatcherErrorResponse(bff, error);
    }

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
