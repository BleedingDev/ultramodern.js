// @effect-diagnostics asyncFunction:off
export default {
  handler: async (request: Request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname.endsWith('/health')) {
      return Response.json({
        ok: true,
        pathname,
      });
    }

    return new Response('Not Found', {
      status: 404,
    });
  },
};
