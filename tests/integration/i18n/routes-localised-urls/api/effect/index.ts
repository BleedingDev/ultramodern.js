// @effect-diagnostics asyncFunction:off
import { defineEffectBff } from '@modern-js/bff-effect/effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';

const api = HttpApi.make('LocalisedUrlsHealthApi');
const layer = HttpApiBuilder.layer(api);

export default defineEffectBff({
  api,
  layer,
  interceptRequest: ({ request, next }) => {
    const pathname = new URL(request.url).pathname;

    if (pathname.endsWith('/health')) {
      return Response.json({
        ok: true,
        pathname,
      });
    }

    return next();
  },
});
