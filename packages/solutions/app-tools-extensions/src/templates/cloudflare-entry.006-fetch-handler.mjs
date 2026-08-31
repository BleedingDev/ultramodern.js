export default {
  async fetch(request, env, ctx) {
    const corsPreflightResponse = await createCorsPreflightResponse(
      request,
      env,
    );

    if (corsPreflightResponse) {
      return finalizeResponseForRequest(corsPreflightResponse, request);
    }

    const bffResponse = await dispatchBffRequest(request, env);

    if (bffResponse) {
      return finalizeResponseForRequest(
        withAppCorsHeaders(bffResponse, request),
        request,
      );
    }

    const serviceBindingResponse = await dispatchServiceBindingRequest(
      request,
      env,
    );

    if (serviceBindingResponse) {
      return finalizeResponseForRequest(
        withAppCorsHeaders(serviceBindingResponse, request),
        request,
      );
    }

    const route = findRoute(request);
    const { pathname } = new URL(request.url);

    if (
      isAssetLikePathname(pathname) &&
      !routeMatchesExactly(route, pathname)
    ) {
      const assetResponse = await fetchAsset(request, env);

      if (assetResponse) {
        return finalizeResponseForRequest(assetResponse, request);
      }

      return finalizeResponseForRequest(
        withAppCorsHeaders(new Response('Not found', { status: 404 }), request),
        request,
      );
    }

    const localeRedirectResponse = createLocaleRedirectResponseForRequest(
      route,
      request,
    );

    if (localeRedirectResponse) {
      return finalizeResponseForRequest(
        withAppCorsHeaders(localeRedirectResponse, request),
        request,
      );
    }

    if (route?.worker) {
      const renderableRequest = createRenderableRequest(request);

      return finalizeResponseForRequest(
        withAppCorsHeaders(
          await dispatchRouteWorker(route, renderableRequest, env, ctx),
          request,
        ),
        request,
      );
    }

    const htmlResponse = await fetchRouteHtml(route, request, env);

    if (htmlResponse) {
      return finalizeResponseForRequest(htmlResponse, request);
    }

    const assetResponse = await fetchAsset(request, env);

    if (assetResponse) {
      return finalizeResponseForRequest(assetResponse, request);
    }

    return finalizeResponseForRequest(
      withAppCorsHeaders(new Response('Not found', { status: 404 }), request),
      request,
    );
  },
};
