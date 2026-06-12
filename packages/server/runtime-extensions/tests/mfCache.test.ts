import {
  createDefaultPlugins,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';
import { describe, expect, test } from '@rstest/core';
import {
  getRequestPathname,
  injectMfAssetCacheHeadersPlugin,
  isMfManifestAsset,
  isMfRemoteEntryAsset,
  resolveMfAssetCacheHeaders,
} from '../src/mfCache';
import { getDefaultAppContext, getDefaultConfig } from './helpers';

describe('mf cache headers', () => {
  test('detects MF manifest assets', () => {
    expect(isMfManifestAsset('/mf-manifest.json')).toBe(true);
    expect(isMfManifestAsset('/mf-stats.json')).toBe(true);
    expect(isMfManifestAsset('/foo/bar.json')).toBe(false);
  });

  test('detects remoteEntry assets', () => {
    expect(isMfRemoteEntryAsset('/remoteEntry.js')).toBe(true);
    expect(isMfRemoteEntryAsset('/assets/remoteEntry.abc123.js')).toBe(true);
    expect(isMfRemoteEntryAsset('/assets/index.js')).toBe(false);
  });

  test('resolves strict no-cache headers for MF manifest endpoints', () => {
    const headers = resolveMfAssetCacheHeaders('/mf-manifest.json');
    expect(headers).toEqual({
      'cache-control': 'no-cache, no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    });
  });

  test('resolves revalidation cache policy for non-versioned remoteEntry', () => {
    const headers = resolveMfAssetCacheHeaders('/remoteEntry.js');
    expect(headers).toEqual({
      'cache-control': 'public, max-age=0, must-revalidate',
    });
  });

  test('resolves immutable cache policy for version-pinned remoteEntry', () => {
    const headers = resolveMfAssetCacheHeaders('/remoteEntry.js', {
      mfv: 'remote-v1',
    });
    expect(headers).toEqual({
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  test('extracts pathname from full request URL', () => {
    expect(
      getRequestPathname('https://example.com/remoteEntry.js?mfv=remote-v1'),
    ).toBe('/remoteEntry.js');
  });
});

describe('injectMfAssetCacheHeadersPlugin', () => {
  const createServerWithStubAssets = async () => {
    const stubAssetsPlugin: ServerPlugin = {
      name: 'stub-static-assets',
      setup(api) {
        api.onPrepare(() => {
          const { middlewares } = api.getServerContext();
          middlewares.push({
            name: 'stub-static-assets',
            handler: async (c: any) => {
              const pathname = c.req.path as string;
              if (pathname === '/missing/remoteEntry.js') {
                return c.body('not found', 404);
              }
              if (pathname.endsWith('.json') || pathname.endsWith('.js')) {
                return c.body('asset-body', 200);
              }
              return c.json({ ok: true });
            },
          });
        });
      },
    };

    const server = createServerBase({
      config: getDefaultConfig(),
      pwd: process.cwd(),
      appContext: getDefaultAppContext(),
    });
    server.addPlugins([
      ...createDefaultPlugins({ logger: false }),
      injectMfAssetCacheHeadersPlugin(),
      stubAssetsPlugin,
    ]);
    await server.init();
    return server;
  };

  test('applies no-store policy to served MF manifests', async () => {
    const server = await createServerWithStubAssets();

    const response = await server.request('/mf-manifest.json', {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'no-cache, no-store, must-revalidate',
    );
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
  });

  test('applies revalidation policy to non-pinned remoteEntry assets', async () => {
    const server = await createServerWithStubAssets();

    const response = await server.request('/static/remoteEntry.js', {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=0, must-revalidate',
    );
  });

  test('applies immutable policy to version-pinned remoteEntry assets', async () => {
    const server = await createServerWithStubAssets();

    const response = await server.request(
      '/static/remoteEntry.js?mfv=remote-v1',
      {},
      {},
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  test('does not attach cache policies to error responses', async () => {
    const server = await createServerWithStubAssets();

    const response = await server.request('/missing/remoteEntry.js', {}, {});
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBeNull();
  });

  test('leaves non-MF assets untouched', async () => {
    const server = await createServerWithStubAssets();

    const response = await server.request('/static/js/app.js', {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
  });
});
