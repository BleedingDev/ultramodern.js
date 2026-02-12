import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
