import { createServerBase, logPlugin } from '../../src';
import type { ServerPlugin } from '../../src/types';
import { getDefaultAppContext, getDefaultConfig } from '../helpers';

const createLoggedServer = () => {
  const debug = rstest.fn();
  const monitorsPlugin: ServerPlugin = {
    name: 'test-monitors',
    setup(api) {
      api.onPrepare(() => {
        api.getServerContext().middlewares.push({
          name: 'test-monitors',
          handler: async (c, next) => {
            c.set('monitors', { debug } as any);
            await next();
          },
        });
      });
    },
  };
  const server = createServerBase({
    config: getDefaultConfig(),
    pwd: '',
    appContext: getDefaultAppContext(),
  });
  server.addPlugins([monitorsPlugin, logPlugin()]);
  return { server, debug };
};

const outgoingLine = (debug: ReturnType<typeof rstest.fn>) =>
  debug.mock.calls
    .map(([line]) => String(line))
    .find(line => line.includes('-->'));

describe('request log plugin', () => {
  it('logs the handler status while the Node response is still unsent', async () => {
    const { server, debug } = createLoggedServer();
    await server.init();
    server.all('*', c => c.text('missing', 404));
    // A Node adapter writes the Response after the chain, so the raw
    // response still reports its default status here.
    const res = { statusCode: 200, headersSent: false };
    const response = await server.request(
      '/does-not-exist',
      {},
      { node: { req: {}, res } },
    );

    expect(response.status).toBe(404);
    expect(outgoingLine(debug)).toContain('GET /does-not-exist');
    expect(outgoingLine(debug)).toContain('404');
  });

  it('logs the Node status when a Node handler already sent the response', async () => {
    const { server, debug } = createLoggedServer();
    await server.init();
    server.all('*', c => c.text('ok'));
    const res = { statusCode: 302, headersSent: true };
    await server.request('/legacy', {}, { node: { req: {}, res } });

    expect(outgoingLine(debug)).toContain('302');
  });
});
