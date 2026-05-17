// @effect-diagnostics asyncFunction:off globalDate:off
import {
  defineServerConfig,
  type MiddlewareHandler,
} from '@modern-js/server-runtime';

const requestTiming: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  c.res.headers.set('x-middleware', `dur=${Date.now() - start}`);
};

export default defineServerConfig({
  middlewares: [
    {
      name: 'request-timing',
      handler: requestTiming,
    },
  ],
  onError: (_error, c) => {
    if (c.req.path.toLowerCase().includes('managed')) {
      return c.json(
        {
          error: 'customize parity response in serverConfig',
        },
        501,
      );
    }
  },
});
