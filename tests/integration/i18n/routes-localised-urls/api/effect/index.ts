// @effect-diagnostics asyncFunction:off
import {
  defineEffectBff,
  HttpApi,
  HttpApiBuilder,
} from '@modern-js/plugin-bff/effect-server';

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
