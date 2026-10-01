import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ServerRoute } from '@modern-js/types';
import { compatPlugin, createServerBase } from '../../src';
import {
  type StaticAssetResponder,
  type StaticPublicFallbackResponder,
  serverStaticPlugin,
  serveStaticAsset,
} from '../../src/adapters/node';
import { getDefaultAppContext, getDefaultConfig } from '../helpers';

const roots: string[] = [];

async function fixture() {
  const pwd = await mkdtemp(path.join(os.tmpdir(), 'native-static-responder-'));
  roots.push(pwd);
  for (const directory of ['static', 'public']) {
    await mkdir(path.join(pwd, directory));
    await writeFile(path.join(pwd, directory, 'asset.txt'), 'original body');
    await writeFile(
      path.join(pwd, directory, 'asset.txt.alternate'),
      'alternate',
    );
  }
  return pwd;
}

async function createServer(
  pwd: string,
  respondAsset?: StaticAssetResponder,
  assetPrefix?: string,
  respondPublicFallback?: StaticPublicFallbackResponder,
) {
  const routes = [
    {
      urlPath: '/document',
      entryPath: 'public/asset.txt',
      isSSR: false,
      responseHeaders: { 'x-public-route': 'native' },
    },
  ] as ServerRoute[];
  const server = createServerBase({
    config: {
      ...getDefaultConfig(),
      output: assetPrefix ? { assetPrefix } : {},
    },
    appContext: getDefaultAppContext(),
    pwd,
    routes,
  });
  server.addPlugins([
    compatPlugin(),
    {
      name: 'test-page-route',
      setup(api) {
        api.onPrepare(() => {
          api.getServerContext().middlewares.push({
            name: 'test-page-route',
            handler: async (context, next) => {
              if (context.req.path === '/static/page') {
                context.set('route', {} as never);
              }
              return next();
            },
          });
        });
      },
    },
    serverStaticPlugin({ respondAsset, respondPublicFallback }),
  ]);
  await server.init();
  return server;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })));
});

describe('native selected asset responder', () => {
  it.each([
    ['/static/asset.txt', 'static'],
    ['/document', 'public'],
  ] as const)(
    'serves a selected representation for %s through the native continuation',
    async (url, kind) => {
      const pwd = await fixture();
      const seen: unknown[] = [];
      const server = await createServer(pwd, async (context, asset, serve) => {
        seen.push({ filename: asset.filename, kind: asset.kind });
        context.header('x-representation', 'alternate');
        return serve({ filename: `${asset.filename}.alternate` });
      });
      const response = await server.request(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('alternate');
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('x-representation')).toBe('alternate');
      expect(seen).toEqual([
        { filename: path.join(pwd, kind, 'asset.txt'), kind },
      ]);
      if (kind === 'public') {
        expect(response.headers.get('x-public-route')).toBe('native');
      } else {
        expect(response.headers.get('content-length')).toBe('9');
      }
    },
  );

  it('uses native prefix resolution before calling the responder', async () => {
    const pwd = await fixture();
    const filenames: string[] = [];
    const server = await createServer(
      pwd,
      async (_context, asset, serve) => {
        filenames.push(asset.filename);
        return serve({ filename: `${asset.filename}.alternate` });
      },
      'https://cdn.example/assets/',
    );
    const response = await server.request('/assets/static/asset.txt');
    expect(await response.text()).toBe('alternate');
    expect(filenames).toEqual([path.join(pwd, 'static/asset.txt')]);
  });

  it.each(['/static/asset.txt', '/document'])(
    'lets a responder decline %s without changing native fallback',
    async url => {
      let calls = 0;
      const server = await createServer(await fixture(), () => {
        calls += 1;
        return undefined;
      });
      const response = await server.request(url);
      expect(await response.text()).toBe('original body');
      expect(calls).toBe(1);
    },
  );

  it('continues downstream when the chosen representation is missing', async () => {
    const server = await createServer(
      await fixture(),
      (_context, asset, serve) =>
        serve({ filename: `${asset.filename}.missing` }),
    );
    const response = await server.request('/static/asset.txt');
    expect(response.status).toBe(404);
  });

  it('does not call the responder for an unmatched or absent static file', async () => {
    let calls = 0;
    const server = await createServer(await fixture(), () => {
      calls += 1;
      return new Response('extension');
    });
    for (const url of ['/unmatched', '/static/missing.txt']) {
      const response = await server.request(url);
      expect(response.status).toBe(404);
    }
    expect(calls).toBe(0);
  });

  it('returns a responder response without reading the original representation', async () => {
    const server = await createServer(
      await fixture(),
      () =>
        new Response(null, {
          status: 406,
          headers: { vary: 'Accept-Encoding' },
        }),
    );
    const response = await server.request('/static/asset.txt');
    expect(response.status).toBe(406);
    expect(response.headers.get('vary')).toBe('Accept-Encoding');
    expect(await response.text()).toBe('');
  });

  it('propagates a responder rejection to the native server error handler', async () => {
    const failure = new Error('responder failed');
    const server = await createServer(await fixture(), async () => {
      throw failure;
    });
    const seen: Error[] = [];
    server.onError((error, context) => {
      seen.push(error);
      return context.text('handled failure', 503);
    });
    const response = await server.request('/static/asset.txt');
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('handled failure');
    expect(seen).toEqual([failure]);
  });
});

it('keeps static misses out of public fallback and lets fallback surround native public serving', async () => {
  const calls: string[] = [];
  const server = await createServer(
    await fixture(),
    () => {
      calls.push('public asset');
      return undefined;
    },
    undefined,
    async (_context, respondPublic, request) => {
      expect(request.pathPrefix).toBe('/');
      calls.push('before public');
      const response = await respondPublic();
      calls.push(response ? 'public hit' : 'public miss');
      return response ?? new Response('fallback body');
    },
  );
  const matched = await server.request('/document');
  expect(await matched.text()).toBe('original body');
  expect(calls.splice(0)).toEqual([
    'before public',
    'public asset',
    'public hit',
  ]);
  const unmatched = await server.request('/unmatched');
  expect(await unmatched.text()).toBe('fallback body');
  expect(calls.splice(0)).toEqual(['before public', 'public miss']);
  const staticMiss = await server.request('/static/missing.txt');
  expect(staticMiss.status).toBe(404);
  expect(calls).toEqual([]);
});

it('allows a responder to skip a selected asset without retrying native serving', async () => {
  const server = await createServer(await fixture(), () => null);
  const response = await server.request('/static/asset.txt');
  expect(response.status).toBe(404);
});

it('keeps extensionless matched pages out of asset and fallback responders', async () => {
  const pwd = await fixture();
  await writeFile(path.join(pwd, 'static/page'), 'not a page response');
  let calls = 0;
  const server = await createServer(
    pwd,
    () => {
      calls += 1;
      return undefined;
    },
    undefined,
    () => {
      calls += 1;
      return new Response('fallback');
    },
  );
  const response = await server.request('/static/page');
  expect(response.status).toBe(404);
  expect(calls).toBe(0);
});

it.each([false, true])(
  'native file responder contains files at root (symlink=%s)',
  async realpath => {
    const pwd = await fixture();
    const outside = path.join(pwd, 'private.txt');
    const link = path.join(pwd, 'public/escape.txt');
    await writeFile(outside, 'private');
    await symlink(outside, link);
    const server = await createServer(pwd, context =>
      serveStaticAsset(context, {
        filename: realpath ? link : outside,
        kind: 'static',
        root: path.join(pwd, 'public'),
        realpath,
      }),
    );
    const response = await server.request('/static/asset.txt');
    expect(response.status).toBe(404);
  },
);
