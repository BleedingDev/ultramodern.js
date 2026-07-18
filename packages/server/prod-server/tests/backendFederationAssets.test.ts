import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServerBase } from '@modern-js/server-core';
import { i18nServerPlugin } from '../../../runtime/plugin-i18n/src/server';
import { applyPlugins } from '../src/apply';
import type { ProdServerOptions } from '../src/types';

const createBackendFederationServer = async () => {
  const pwd = await mkdtemp(
    path.join(os.tmpdir(), 'modern-backend-federation-assets-'),
  );
  const manifestBytes = JSON.stringify({
    metaData: {
      name: 'verticalExploreBackend',
      publicPath: '/',
      remoteEntry: {
        name: 'backendRemoteEntry.cjs',
        path: '',
        type: 'commonjs-module',
      },
    },
  });
  const containerBytes = 'module.exports = { get() {}, init() {} };\n';
  await writeFile(path.join(pwd, 'backend-mf-manifest.json'), manifestBytes);
  await writeFile(path.join(pwd, 'backendRemoteEntry.cjs'), containerBytes);
  await writeFile(
    path.join(pwd, 'private-server-module.mjs'),
    'export const secret = true;\n',
  );

  const options = {
    pwd,
    routes: [
      {
        entryName: 'main',
        entryPath: 'index.html',
        isSSR: true,
        urlPath: '/',
      },
    ],
    serverConfigPath: path.join(pwd, 'modern.server.js'),
    appContext: {
      apiDirectory: '',
      lambdaDirectory: '',
      appDirectory: pwd,
    },
    config: {
      html: {},
      output: {},
      source: {},
      tools: {},
      server: {
        logger: false,
      },
      bff: {},
      dev: {},
      security: {},
    },
    plugins: [
      i18nServerPlugin({
        localeDetection: {
          fallbackLanguage: 'en',
          languages: ['en', 'cs'],
          localePathRedirect: true,
        },
        staticRoutePrefixes: [],
      }),
    ],
  } as unknown as ProdServerOptions;

  const server = createServerBase(options);
  await applyPlugins(server, options);
  await server.init();

  return { containerBytes, manifestBytes, pwd, server };
};

describe('production backend Module Federation assets', () => {
  test('serves root manifest and entry without locale redirects', async () => {
    const { containerBytes, manifestBytes, pwd, server } =
      await createBackendFederationServer();

    try {
      const manifest = await server.request(
        '/backend-mf-manifest.json',
        {},
        {},
      );
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get('location')).toBeNull();
      expect(manifest.headers.get('content-type')).toContain(
        'application/json',
      );
      expect(manifest.headers.get('access-control-allow-origin')).toBe('*');
      expect(manifest.headers.get('access-control-allow-methods')).toBe(
        'GET,HEAD,OPTIONS',
      );
      expect(manifest.headers.get('cache-control')).toBe(
        'no-cache, no-store, must-revalidate',
      );
      expect(
        createHash('sha256')
          .update(Buffer.from(await manifest.arrayBuffer()))
          .digest('hex'),
      ).toBe(createHash('sha256').update(manifestBytes).digest('hex'));

      const remoteEntry = await server.request(
        '/backendRemoteEntry.cjs',
        {},
        {},
      );
      expect(remoteEntry.status).toBe(200);
      expect(remoteEntry.headers.get('location')).toBeNull();
      expect(remoteEntry.headers.get('content-type')).toContain(
        'text/javascript',
      );
      expect(remoteEntry.headers.get('access-control-allow-origin')).toBe('*');
      expect(remoteEntry.headers.get('access-control-allow-methods')).toBe(
        'GET,HEAD,OPTIONS',
      );
      expect(remoteEntry.headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(
        createHash('sha256')
          .update(Buffer.from(await remoteEntry.arrayBuffer()))
          .digest('hex'),
      ).toBe(createHash('sha256').update(containerBytes).digest('hex'));
    } finally {
      await rm(pwd, { recursive: true, force: true });
    }
  });

  test.each([
    'HEAD',
    'OPTIONS',
  ])('keeps %s requests on the infrastructure asset path', async method => {
    const { pwd, server } = await createBackendFederationServer();

    try {
      for (const [assetPath, contentType, cacheControl] of [
        [
          '/backend-mf-manifest.json',
          'application/json',
          'no-cache, no-store, must-revalidate',
        ],
        [
          '/backendRemoteEntry.cjs',
          'text/javascript',
          'public, max-age=0, must-revalidate',
        ],
      ] as const) {
        const response = await server.request(assetPath, { method }, {});
        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
        expect(response.headers.get('content-type')).toContain(contentType);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('access-control-allow-methods')).toBe(
          'GET,HEAD,OPTIONS',
        );
        expect(response.headers.get('cache-control')).toBe(cacheControl);
      }
    } finally {
      await rm(pwd, { recursive: true, force: true });
    }
  });

  test('does not expose localized aliases or traversal-shaped asset paths', async () => {
    const { pwd, server } = await createBackendFederationServer();

    try {
      for (const assetPath of [
        '/en/backend-mf-manifest.json',
        '/cs/backendRemoteEntry.cjs',
      ]) {
        const response = await server.request(assetPath, {}, {});
        expect(response.status).toBe(404);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('cache-control')).toBeNull();
        expect(await response.text()).not.toContain('secret = true');
      }

      for (const assetPath of [
        '/%252e%252e/private-server-module.mjs',
        '/backendRemoteEntry.cjs/%252e%252e/private-server-module.mjs',
      ]) {
        const initialResponse = await server.request(assetPath, {}, {});
        const location = initialResponse.headers.get('location');
        const response =
          initialResponse.status === 302 && location
            ? await server.request(location, {}, {})
            : initialResponse;

        expect(response.status).toBe(404);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('cache-control')).toBeNull();
        expect(await response.text()).not.toContain('secret = true');
      }
    } finally {
      await rm(pwd, { recursive: true, force: true });
    }
  });
});
