import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '../../src/plugins/deploy/platforms/cloudflare';

const tempDirectories: string[] = [];

const createAssetBinding = (publicDirectory: string) => ({
  fetch: async (request: Request) => {
    const { pathname } = new URL(request.url);
    const assetPath = path.join(publicDirectory, pathname);

    try {
      return new Response(await fs.readFile(assetPath), { status: 200 });
    } catch {
      return new Response('missing', { status: 404 });
    }
  },
});

async function createFixture({ workerName }: { workerName?: string } = {}) {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-deploy-'),
  );
  tempDirectories.push(appDirectory);

  const distDirectory = path.join(appDirectory, 'dist');
  await fs.mkdir(path.join(distDirectory, 'static'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'worker'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'bundles'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/plain'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/main'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/fallback'), {
    recursive: true,
  });
  await fs.writeFile(path.join(distDirectory, 'static/app.js'), 'app();');
  await fs.writeFile(
    path.join(distDirectory, 'worker/main.js'),
    `export const requestHandler = async (request, options) => new Response(JSON.stringify({
      pathname: new URL(request.url).pathname,
      entryName: options.resource.entryName,
      htmlTemplate: options.resource.htmlTemplate,
      routeAssetKeys: Object.keys(options.resource.routeManifest.routeAssets || {}),
      loadableName: options.resource.loadableStats.name
    }), { headers: { 'content-type': 'application/json' } });`,
  );
  await fs.writeFile(path.join(distDirectory, 'worker/empty.js'), 'export {};');
  await fs.writeFile(
    path.join(distDirectory, 'worker/dirname.js'),
    `export const requestHandler = async () => new Response(JSON.stringify({
      dirname: __dirname,
      filename: __filename
    }), { headers: { 'content-type': 'application/json' } });`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/empty.js.map'),
    '{"version":3}',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/main.js.gz'),
    'compressed',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/main.js.br'),
    'compressed',
  );
  await fs.mkdir(path.join(distDirectory, 'worker/.rsdoctor'), {
    recursive: true,
  });
  await fs.writeFile(path.join(distDirectory, 'worker/.rsdoctor/summary'), 'x');
  await fs.mkdir(path.join(distDirectory, 'worker/@mf-types'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(distDirectory, 'worker/@mf-types/Route.d.ts'),
    'export {};',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/promise-default.js'),
    `export default {
      requestHandler: Promise.resolve(async (request, options) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        source: 'promised-default',
        entryName: options.resource.entryName,
        htmlTemplate: options.resource.htmlTemplate
      }), { headers: { 'content-type': 'application/json' } }))
    };`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'bundles/main.js'),
    `module.exports = {
      requestHandler: async (request, options) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        source: 'bundle-fallback',
        entryName: options.resource.entryName,
        htmlTemplate: options.resource.htmlTemplate
      }), { headers: { 'content-type': 'application/json' } })
    };`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/__modern_bff_effect.js'),
    `export const createHandler = () => ({
      handler: async (request, context) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        originalPath: context.path,
        method: context.method,
        envValue: context.env.TEST_VALUE
      }), { headers: { 'content-type': 'application/json' } }),
      dispose: async () => {}
    });`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'html/main/index.html'),
    '<!doctype html><html>main</html>',
  );
  await fs.writeFile(
    path.join(distDirectory, 'html/plain/index.html'),
    '<!doctype html><html>plain</html>',
  );
  await fs.writeFile(
    path.join(distDirectory, 'html/fallback/index.html'),
    '<!doctype html><html>fallback</html>',
  );
  await fs.writeFile(
    path.join(distDirectory, 'routes-manifest.json'),
    JSON.stringify({
      routeAssets: {
        main: {
          assets: ['static/app.js'],
        },
      },
    }),
  );
  await fs.writeFile(
    path.join(distDirectory, 'loadable-stats.json'),
    JSON.stringify({
      name: 'loadable-fixture',
    }),
  );
  await fs.writeFile(
    path.join(distDirectory, 'route.json'),
    JSON.stringify({
      routes: [
        {
          urlPath: '/dashboard',
          entryName: 'main',
          entryPath: 'html/main/index.html',
          isSSR: true,
          worker: 'worker/main.js',
          bundle: 'bundles/main.js',
        },
        {
          urlPath: '/fallback',
          entryName: 'fallback',
          entryPath: 'html/fallback/index.html',
          isSSR: true,
          worker: 'worker/empty.js',
          bundle: 'bundles/main.js',
        },
        {
          urlPath: '/promise-default',
          entryName: 'fallback',
          entryPath: 'html/fallback/index.html',
          isSSR: true,
          worker: 'worker/promise-default.js',
        },
        {
          urlPath: '/dirname',
          entryName: 'fallback',
          entryPath: 'html/fallback/index.html',
          isSSR: true,
          worker: 'worker/dirname.js',
        },
        {
          urlPath: '/plain',
          entryName: 'plain',
          entryPath: 'html/plain/index.html',
          isSSR: false,
        },
      ],
    }),
  );

  const preset = createCloudflarePreset({
    appContext: {
      appDirectory,
      distDirectory,
    } as any,
    modernConfig: {
      bff: {
        prefix: '/commerce-api',
        runtimeFramework: 'effect',
      },
      deploy: {
        worker: {
          name: workerName,
        },
      },
    } as any,
    api: {} as any,
  });

  await preset.prepare?.();
  await preset.writeOutput?.();
  await preset.genEntry?.();

  return {
    appDirectory,
    outputDirectory: path.join(appDirectory, '.output'),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(directory =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('cloudflare deploy preset', () => {
  it('emits a wrangler config with an ASSETS binding and module worker main', async () => {
    const { outputDirectory } = await createFixture();
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.main).toBe('server/index.mjs');
    expect(wranglerConfig.compatibility_flags).toEqual(['nodejs_compat']);
    expect(wranglerConfig.assets).toEqual({
      directory: './public',
      binding: 'ASSETS',
      run_worker_first: true,
    });
    expect(wranglerConfig.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses configured Cloudflare worker names when provided', async () => {
    const { outputDirectory } = await createFixture({
      workerName: 'commerce-production-worker',
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.name).toBe('commerce-production-worker');
  });

  it('places client-facing assets under the configured public asset root only', async () => {
    const { outputDirectory } = await createFixture();
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );
    const publicDirectory = path.join(
      outputDirectory,
      wranglerConfig.assets.directory.replace(/^\.\//u, ''),
    );

    await expect(
      fs.access(path.join(publicDirectory, 'static/app.js')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(publicDirectory, 'html/plain/index.html')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(outputDirectory, 'server/index.mjs')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(publicDirectory, 'server/index.mjs')),
    ).rejects.toThrow();
    await expect(
      fs.access(
        path.join(publicDirectory, 'server/modern-worker-manifest.json'),
      ),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'worker/main.js')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/main.js')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/empty.js.map')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/main.js.gz')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/main.js.br')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/.rsdoctor/summary')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/@mf-types/Route.d.ts')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'bundles/main.js')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'bundles/main.js')),
    ).rejects.toThrow();
  });

  it('emits a structured route.worker manifest for module-worker dispatch', async () => {
    const { outputDirectory } = await createFixture();
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(workerManifest.runtime).toEqual({
      type: 'cloudflare-module-worker',
      entry: 'server/index.mjs',
      fetchExport: true,
      nodeListen: false,
    });
    expect(workerManifest.workerBundles).toMatchObject({
      directory: 'worker',
      format: 'esm',
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    });
    expect(workerManifest.assets).toEqual({
      directory: './public',
      binding: 'ASSETS',
      runWorkerFirst: true,
    });
    expect(workerManifest.routeSpec.file).toBe('server/route.json');
    expect(workerManifest.routeSpec.routes).toContainEqual(
      expect.objectContaining({
        urlPath: '/dashboard',
        entryName: 'main',
        worker: 'worker/main.js',
        workerExists: true,
      }),
    );
    expect(workerManifest.resources).toEqual({
      loadableStats: 'loadable-stats.json',
      routeManifest: 'routes-manifest.json',
    });
    expect(workerManifest.bff).toEqual({
      runtimeFramework: 'effect',
      prefix: '/commerce-api',
      worker: 'worker/__modern_bff_effect.js',
    });
  });

  it('emits a fetch-based worker entry that serves bound assets', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');

    const response = await worker.fetch(
      new Request('https://example.com/static/app.js'),
      {
        ASSETS: createAssetBinding(publicDirectory),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe('app();');
  });

  it('answers Cloudflare CORS preflight requests for federated assets', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/mf-manifest.json', {
        headers: {
          origin: 'https://shell.example.com',
          'access-control-request-method': 'GET',
        },
        method: 'OPTIONS',
      }),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain(
      'GET',
    );
  });

  it('uses route metadata for non-worker HTML fallback after asset miss', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');
    const requestedPaths: string[] = [];
    const assetBinding = createAssetBinding(publicDirectory);

    const response = await worker.fetch(
      new Request('https://example.com/plain/details'),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            const pathname = new URL(request.url).pathname;
            requestedPaths.push(pathname);

            return assetBinding.fetch(request);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<!doctype html><html>plain</html>');
    expect(requestedPaths).toEqual([
      '/plain/details',
      '/html/plain/index.html',
    ]);
  });

  it('dispatches route.worker modules with request handler resources', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/dashboard/settings'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pathname: '/dashboard/settings',
      entryName: 'main',
      htmlTemplate: '<!doctype html><html>main</html>',
      routeAssetKeys: ['main'],
      loadableName: 'loadable-fixture',
    });
  });

  it('follows same-origin asset redirects when reading SSR templates', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');
    const assetBinding = createAssetBinding(publicDirectory);

    const response = await worker.fetch(
      new Request('https://example.com/dashboard/settings'),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            const { pathname } = new URL(request.url);

            if (pathname === '/html/main/index.html') {
              return new Response(null, {
                status: 307,
                headers: {
                  location: '/html/main/',
                },
              });
            }

            if (pathname === '/html/main/') {
              return new Response('<!doctype html><html>main</html>', {
                status: 200,
                headers: {
                  'content-type': 'text/html; charset=utf-8',
                },
              });
            }

            return assetBinding.fetch(request);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pathname: '/dashboard/settings',
      entryName: 'main',
      htmlTemplate: '<!doctype html><html>main</html>',
      routeAssetKeys: ['main'],
      loadableName: 'loadable-fixture',
    });
  });

  it('fails clearly instead of importing Node route.bundle modules', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/fallback/settings'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('x-modern-js-route-worker')).toBe(
      'worker/empty.js',
    );
    await expect(response.text()).resolves.toContain(
      'Worker bundle has no fetch or requestHandler export',
    );
  });

  it('dispatches promised default request handlers from Modern server bundles', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/promise-default/settings'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pathname: '/promise-default/settings',
      source: 'promised-default',
      entryName: 'fallback',
      htmlTemplate: '<!doctype html><html>fallback</html>',
    });
  });

  it('provides Node-style path globals for module worker SSR compatibility', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/dirname'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dirname: '/',
      filename: '/index.js',
    });
  });

  it('dispatches Effect BFF worker modules before SSR route fallback', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/recommendations'),
      {
        TEST_VALUE: 'edge-env',
        ASSETS: {
          fetch: async () => new Response('missing', { status: 404 }),
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      pathname: '/effect/recommendations',
      originalPath: '/commerce-api/effect/recommendations',
      method: 'GET',
      envValue: 'edge-env',
    });
  });
});
