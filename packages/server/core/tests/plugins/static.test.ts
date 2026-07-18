import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { ServerRoute } from '@modern-js/types';
import { compatPlugin, createServerBase } from '../../src';
import { serverStaticPlugin } from '../../src/adapters/node/plugins';
import { getDefaultAppContext, getDefaultConfig } from '../helpers';

const tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'modern-static-'));
  tempDirs.push(dir);
  return dir;
};

const createStaticServer = async (pwd: string, routes: ServerRoute[] = []) => {
  const server = createServerBase({
    config: getDefaultConfig(),
    pwd,
    routes,
    appContext: getDefaultAppContext(),
  });

  server.addPlugins([compatPlugin(), serverStaticPlugin()]);
  await server.init();

  return server;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('static plugin precompressed assets', () => {
  it('serves brotli assets when br is accepted', async () => {
    const pwd = await createTempDir();
    const originBody = Buffer.from('console.log("modern");');
    const brBody = brotliCompressSync(originBody);
    const gzipBody = gzipSync(originBody);
    const staticFile = path.join(pwd, 'static', 'app.js');

    await mkdir(path.dirname(staticFile), { recursive: true });
    await writeFile(staticFile, originBody);
    await writeFile(`${staticFile}.br`, brBody);
    await writeFile(`${staticFile}.gz`, gzipBody);

    const server = await createStaticServer(pwd);
    const response = await server.request('/static/app.js', {
      headers: new Headers({
        'accept-encoding': 'gzip, br',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    expect(Buffer.from(await response.arrayBuffer()).equals(brBody)).toBe(true);
  });

  it('respects accept-encoding quality values', async () => {
    const pwd = await createTempDir();
    const originBody = Buffer.from('hello quality');
    const brBody = brotliCompressSync(originBody);
    const gzipBody = gzipSync(originBody);
    const staticFile = path.join(pwd, 'static', 'priority.js');

    await mkdir(path.dirname(staticFile), { recursive: true });
    await writeFile(staticFile, originBody);
    await writeFile(`${staticFile}.br`, brBody);
    await writeFile(`${staticFile}.gz`, gzipBody);

    const server = await createStaticServer(pwd);
    const response = await server.request('/static/priority.js', {
      headers: new Headers({
        'accept-encoding': 'br;q=0.2, gzip;q=1',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(Buffer.from(await response.arrayBuffer()).equals(gzipBody)).toBe(
      true,
    );
  });

  it('falls back to origin asset when no variant is accepted', async () => {
    const pwd = await createTempDir();
    const originBody = Buffer.from('no supported encoding');
    const brBody = brotliCompressSync(originBody);
    const gzipBody = gzipSync(originBody);
    const staticFile = path.join(pwd, 'static', 'fallback.js');

    await mkdir(path.dirname(staticFile), { recursive: true });
    await writeFile(staticFile, originBody);
    await writeFile(`${staticFile}.br`, brBody);
    await writeFile(`${staticFile}.gz`, gzipBody);

    const server = await createStaticServer(pwd);
    const response = await server.request('/static/fallback.js', {
      headers: new Headers({
        'accept-encoding': 'deflate',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe(null);
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    expect(Buffer.from(await response.arrayBuffer()).equals(originBody)).toBe(
      true,
    );
  });

  it('supports precompressed public assets', async () => {
    const pwd = await createTempDir();
    const originBody = Buffer.from('public route body');
    const gzipBody = gzipSync(originBody);
    const publicFile = path.join(pwd, 'public', 'docs.txt');
    const routes = [
      {
        urlPath: '/docs',
        entryPath: 'public/docs.txt',
        isSSR: false,
        responseHeaders: {
          'x-route': 'ok',
        },
      },
    ] as unknown as ServerRoute[];

    await mkdir(path.dirname(publicFile), { recursive: true });
    await writeFile(publicFile, originBody);
    await writeFile(`${publicFile}.gz`, gzipBody);

    const server = await createStaticServer(pwd, routes);
    const response = await server.request('/docs', {
      headers: new Headers({
        'accept-encoding': 'gzip',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-route')).toBe('ok');
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');
    expect(Buffer.from(await response.arrayBuffer()).equals(gzipBody)).toBe(
      true,
    );
  });
});

describe('static plugin Module Federation backend assets', () => {
  it('serves backend manifests and remote entries from dist root', async () => {
    const pwd = await createTempDir();
    const manifestFile = path.join(pwd, 'backend-mf-manifest.json');
    const remoteEntryFile = path.join(pwd, 'backendRemoteEntry.cjs');

    await writeFile(
      manifestFile,
      JSON.stringify({
        metaData: {
          name: 'verticalExploreBackend',
          publicPath: '/',
          remoteEntry: {
            path: '',
            name: 'backendRemoteEntry.cjs',
            type: 'commonjs-module',
          },
        },
        exposes: [
          {
            name: './effect-api',
          },
        ],
      }),
    );
    await writeFile(remoteEntryFile, 'export function init() {}');

    const server = await createStaticServer(pwd);
    const manifestResponse = await server.request(
      '/backend-mf-manifest.json',
      {},
    );
    const remoteEntryResponse = await server.request(
      '/backendRemoteEntry.cjs',
      {},
    );

    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get('access-control-allow-origin')).toBe(
      '*',
    );
    expect(await manifestResponse.json()).toEqual(
      expect.objectContaining({
        metaData: expect.objectContaining({
          publicPath: '/',
        }),
      }),
    );
    expect(remoteEntryResponse.status).toBe(200);
    expect(remoteEntryResponse.headers.get('content-type')).toContain(
      'text/javascript',
    );
    expect(remoteEntryResponse.headers.get('access-control-allow-origin')).toBe(
      '*',
    );
    expect(await remoteEntryResponse.text()).toContain(
      'export function init() {}',
    );
  });
});

describe('static plugin generated public directory assets', () => {
  it('serves a dist/public asset at its root URL without a route manifest entry', async () => {
    const pwd = await createTempDir();
    const publicFile = path.join(pwd, 'public', 'robots.txt');
    const body = 'User-agent: *\nAllow: /\n';

    await mkdir(path.dirname(publicFile), { recursive: true });
    await writeFile(publicFile, body);

    const server = await createStaticServer(pwd);
    const response = await server.request('/robots.txt');
    const headResponse = await server.request('/robots.txt', {
      method: 'HEAD',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe(body);
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('content-length')).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(await headResponse.text()).toBe('');
  });

  it('rejects traversal, symlink escape, and non-read methods', async () => {
    const pwd = await createTempDir();
    const publicDirectory = path.join(pwd, 'public');
    const privateFile = path.join(pwd, 'private.txt');

    await mkdir(publicDirectory, { recursive: true });
    await writeFile(privateFile, 'private');
    await writeFile(path.join(publicDirectory, 'robots.txt'), 'public');
    await symlink(privateFile, path.join(publicDirectory, 'escape.txt'));

    const server = await createStaticServer(pwd);
    const traversalResponse = await server.request('/%2e%2e%2fprivate.txt');
    const symlinkResponse = await server.request('/escape.txt');
    const postResponse = await server.request('/robots.txt', {
      method: 'POST',
    });

    expect(traversalResponse.status).toBe(404);
    expect(symlinkResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
  });
});
