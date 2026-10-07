import type { Monitors, ServerRoute } from '@modern-js/types';
import { describe, expect, it } from '@rstest/core';
import { Hono } from 'hono';
import { createRender } from '../../src/plugins/render/render';
import type { RenderOptions, ServerEnv, ServerManifest } from '../../src/types';
import { uniqueKeyByRoute } from '../../src/utils';
import { getDefaultConfig } from '../helpers';

const main: ServerRoute = {
  entryName: 'main',
  urlPath: '/',
  entryPath: 'main.html',
  isSSR: false,
};
const user: ServerRoute = {
  entryName: 'user',
  urlPath: '/user',
  entryPath: 'user.html',
  isSSR: true,
};
const monitors: Monitors = {
  push() {},
  error() {},
  warn() {},
  debug() {},
  info() {},
  trace() {},
  timing() {},
  counter() {},
};

async function execute({
  routes = [main, user],
  request = new Request('http://localhost/original'),
  rewrite = {},
  serverManifest = {},
  omitTemplate = false,
}: {
  routes?: ServerRoute[];
  request?: Request;
  rewrite?: Pick<RenderOptions, 'matchEntryName' | 'matchPathname'>;
  serverManifest?: ServerManifest;
  omitTemplate?: boolean;
} = {}) {
  const render = await createRender({
    routes,
    pwd: '',
    config: getDefaultConfig(),
  });
  const app = new Hono<ServerEnv>();
  let original: ServerRoute | undefined;
  let final: ServerRoute | undefined;
  app.all('*', async context => {
    context.set('route', { entryName: 'original', urlPath: '/original' });
    context.set('renderRoute', main);
    const response = await render(context.req.raw, {
      monitors,
      serverContext: context,
      templates: omitTemplate
        ? {}
        : Object.fromEntries(
            routes.map(route => [
              uniqueKeyByRoute(route),
              `<html>${route.entryName ?? 'implicit-main'}</html>`,
            ]),
          ),
      serverManifest,
      ...rewrite,
    });
    original = context.get('route');
    final = context.get('renderRoute');
    return response;
  });
  const response = await app.request(request);
  return { response, original, final };
}

describe('actual render match exposed to server extensions', () => {
  it('exposes the actual CSR route and preserves the original middleware route', async () => {
    const result = await execute();
    expect(result.final).toBe(main);
    expect(result.original).toEqual({
      entryName: 'original',
      urlPath: '/original',
    });
    expect(await result.response.text()).toBe('<html>main</html>');
    expect(result.response.headers.get('x-modernjs-render')).toBe('client');
  });

  it('publishes a rewritten SSR route before the real bundle handler executes', async () => {
    const result = await execute({
      rewrite: { matchPathname: '/user/details' },
      serverManifest: {
        renderBundles: {
          user: {
            requestHandler: Promise.resolve(async (_request, options) => {
              expect(options.resource.route).toBe(user);
              return new Response('actual user SSR');
            }),
          },
        },
      },
    });
    expect(result.final).toBe(user);
    expect(result.original?.entryName).toBe('original');
    expect(await result.response.text()).toBe('actual user SSR');
    expect(result.response.headers.get('x-modernjs-render')).toBe('server');
  });

  it('reflects the executor entry override only when overlapping routes honor it', async () => {
    const overlap = await execute({
      rewrite: { matchPathname: '/user/details', matchEntryName: 'main' },
    });
    expect(overlap.final).toBe(main);
    const single = await execute({ rewrite: { matchEntryName: 'user' } });
    expect(single.final).toBe(main);
    expect(await single.response.text()).toBe('<html>main</html>');
  });

  it('clears stale final route on a failed rewrite match without changing original route', async () => {
    const result = await execute({
      routes: [user],
      rewrite: { matchPathname: '/missing' },
    });
    expect(result.final).toBeUndefined();
    expect(result.original?.entryName).toBe('original');
    expect(result.response.status).toBe(404);
  });

  it('exposes a valid selected route even when its template is missing', async () => {
    const result = await execute({
      rewrite: { matchPathname: '/user' },
      omitTemplate: true,
    });
    expect(result.final).toBe(user);
    expect(result.response.status).toBe(404);
  });

  it('preserves the existing loader response and selects its rewritten entry', async () => {
    const body = JSON.stringify({ actual: 'user loader' });
    const result = await execute({
      request: new Request('http://localhost/original?__loader=page'),
      rewrite: { matchPathname: '/user/details' },
      serverManifest: {
        loaderBundles: {
          user: {
            routes: [],
            handleRequest: async () =>
              new Response(body, {
                headers: { 'content-type': 'application/json' },
              }),
          },
        },
      },
    });
    expect(result.final).toBe(user);
    expect(result.response.headers.get('content-type')).toBe(
      'application/json',
    );
    expect(await result.response.text()).toBe(body);
  });

  it.each(['rsc-tree', 'rsc-action'] as const)(
    'exposes the same actual route for %s without changing the existing protocol',
    async mode => {
      const result = await execute({
        request: new Request('http://localhost/original', {
          method: mode === 'rsc-action' ? 'POST' : 'GET',
          headers: { [`x-${mode}`]: 'actual-control' },
        }),
        rewrite: { matchPathname: '/user/details' },
        serverManifest: {
          renderBundles: {
            user: {
              rscPayloadHandler: async (_request, options) => {
                expect(options.resource.route).toBe(user);
                return new Response('actual flight', {
                  headers: { 'content-type': 'text/x-component' },
                });
              },
              handleAction: async () =>
                new Response('actual action', { status: 201 }),
            },
          },
        },
      });
      expect(result.final).toBe(user);
      expect(await result.response.text()).toBe(
        mode === 'rsc-action' ? 'actual action' : 'actual flight',
      );
      expect(result.response.status).toBe(mode === 'rsc-action' ? 201 : 200);
    },
  );

  it('preserves a route with omitted entryName and the executor main bundle default', async () => {
    const implicit: ServerRoute = {
      urlPath: '/implicit',
      entryPath: 'main.html',
      isSSR: true,
    };
    const result = await execute({
      routes: [implicit],
      rewrite: { matchPathname: '/implicit' },
      serverManifest: {
        renderBundles: {
          main: {
            requestHandler: Promise.resolve(
              async () => new Response('implicit main SSR'),
            ),
          },
        },
      },
    });
    expect(result.final).toBe(implicit);
    expect(result.final?.entryName).toBeUndefined();
    expect(await result.response.text()).toBe('implicit main SSR');
  });
});
