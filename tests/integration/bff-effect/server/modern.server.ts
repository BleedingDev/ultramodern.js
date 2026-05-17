// @effect-diagnostics asyncFunction:off globalDate:off
import {
  defineServerConfig,
  type MiddlewareHandler,
} from '@modern-js/server-runtime';

const requestTiming: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  await next();
  const duration = Date.now() - startedAt;
  c.res.headers.set(
    'x-effect-request-middleware',
    `dur=${duration}; path=${c.req.path}`,
  );
};

const renderTiming: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  await next();
  const duration = Date.now() - startedAt;
  c.res.headers.set(
    'x-effect-render-middleware',
    `dur=${duration}; path=${c.req.path}`,
  );
};

export default defineServerConfig({
  middlewares: [
    {
      name: 'effect-request-timing',
      handler: requestTiming,
    },
  ],
  renderMiddlewares: [
    {
      name: 'effect-render-timing',
      handler: renderTiming,
    },
  ],
  onError: (_error, c) => {
    if (c.req.path.includes('managed')) {
      return c.json(
        {
          error: 'customize response in effect serverConfig',
        },
        501,
      );
    }
  },
});
