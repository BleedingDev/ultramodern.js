export default {
  async fetch(request, env, ctx) {
    const rendererRejection = createWorkerRendererGuardResponse(request);
    if (rendererRejection) {
      return finalizeResponseForRequest(
        withAppCorsHeaders(rendererRejection, request),
        request,
      );
    }
    const corsPreflightResponse = await createCorsPreflightResponse(
      request,
      env,
    );

    if (corsPreflightResponse) {
      return finalizeResponseForRequest(corsPreflightResponse, request);
    }

    const bffResponse = await dispatchBffRequest(request, env, ctx);

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

    // Native entries resolve the request language in their own handler, with
    // the same resolver the Node host uses; the legacy detector would differ.
    const localeRedirectResponse =
      route?.worker && getNativeRouteIdentity(route)
        ? null
        : createLocaleRedirectResponseForRequest(route, request);

    if (localeRedirectResponse) {
      return finalizeResponseForRequest(
        withAppCorsHeaders(localeRedirectResponse, request),
        request,
      );
    }

    if (route?.worker) {
      // Route data requests keep their method, as on the Node server.
      const routeDataResponse = await dispatchRouteDataRequest(route, request);

      return finalizeResponseForRequest(
        withAppCorsHeaders(
          routeDataResponse ??
            (await dispatchRouteWorker(
              route,
              createRenderableRequest(request),
              env,
              ctx,
            )),
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
