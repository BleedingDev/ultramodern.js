// @effect-diagnostics asyncFunction:off
const EFFECT_HELLO_PATH = '/effect/hello';

export default {
  handler: async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.endsWith(EFFECT_HELLO_PATH)) {
      return Response.json({
        message: 'Hello from effect-only runtime',
      });
    }

    return new Response('Not Found', {
      status: 404,
    });
  },
};
