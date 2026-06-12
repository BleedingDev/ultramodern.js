import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '../../src/plugins/deploy/platforms/cloudflare';
import type { CloudflareWorkerSecurityConfig } from '../../src/types/config/deploy';

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

async function createFixture({
  compatibilityDate,
  workerName,
  workerSecurity,
}: {
  compatibilityDate?: string;
  workerName?: string;
  workerSecurity?: Record<string, unknown>;
} = {}) {
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
  await fs.mkdir(path.join(distDirectory, 'worker/(lang)/cart'), {
    recursive: true,
  });
  await fs.writeFile(path.join(distDirectory, 'static/app.js'), 'app();');
  await fs.writeFile(path.join(distDirectory, 'static/app.css'), 'body{}');
  await fs.writeFile(
    path.join(distDirectory, 'static/app.1234abcd.css'),
    'body{}',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/main.js'),
    `module.exports = { requestHandler: async (request, options) => new Response(JSON.stringify({
      pathname: new URL(request.url).pathname,
      entryName: options.resource.entryName,
      htmlTemplate: options.resource.htmlTemplate,
      routeAssetKeys: Object.keys(options.resource.routeManifest.routeAssets || {}),
      loadableName: options.resource.loadableStats.name
    }), { headers: { 'content-type': 'application/json' } }) };`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/empty.js'),
    'module.exports = {};',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/dirname.js'),
    `module.exports = { requestHandler: async () => new Response(JSON.stringify({
      dirname: __dirname,
      filename: __filename
    }), { headers: { 'content-type': 'application/json' } }) };`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/html.js'),
    `module.exports = { requestHandler: async () => new Response('<!doctype html><html><head><title>styled</title></head><body><header data-modern-boundary-id="explore" data-modern-mf-expose="./Header">Header</header><main data-modern-boundary-id="checkout" data-modern-mf-expose="./CartPage">Cart</main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) };`,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/head.js'),
    `module.exports = { requestHandler: async request => {
      if (request.method !== 'GET') {
        return new Response('unexpected method', { status: 500 });
      }

      return new Response('<!doctype html><html><head><title>head</title></head><body>ok</body></html>', {
        headers: {
          'content-length': '77',
          'content-type': 'text/html; charset=utf-8',
          'x-render-method': request.method
        }
      });
    } };`,
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
  await fs.writeFile(
    path.join(distDirectory, 'worker/(lang)/page.js'),
    'module.exports = {};',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/(lang)/cart/page.mjs'),
    'export default {};',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/(lang)/cart/page.js.map'),
    '{"version":3}',
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
    `module.exports = { default: {
      requestHandler: Promise.resolve(async (request, options) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        source: 'promised-default',
        entryName: options.resource.entryName,
        htmlTemplate: options.resource.htmlTemplate
      }), { headers: { 'content-type': 'application/json' } }))
    } };`,
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
    `module.exports = { default: {
      handler: async (request, context) => new Response(JSON.stringify({
          pathname: new URL(request.url).pathname,
          originalPath: context.path,
          method: context.method,
          envValue: context.env.TEST_VALUE
        }), { headers: { 'content-type': 'application/json' } }),
      dispose: async () => {}
    } };`,
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
          assets: ['static/app.js', 'static/app.css'],
          referenceCssAssets: ['static/app.css'],
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
    path.join(distDirectory, 'mf-manifest.json'),
    JSON.stringify({
      remotes: [
        {
          alias: 'explore',
          federationContainerName: 'verticalExplore',
          entry: 'https://explore.example.com/mf-manifest.json',
        },
        {
          alias: 'checkout',
          federationContainerName: 'verticalCheckout',
          entry: 'https://checkout.example.com/mf-manifest.json',
        },
      ],
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
          urlPath: '/styled',
          entryName: 'main',
          entryPath: 'html/main/index.html',
          isSSR: true,
          worker: 'worker/html.js',
        },
        {
          urlPath: '/head-check',
          entryName: 'main',
          entryPath: 'html/main/index.html',
          isSSR: true,
          worker: 'worker/head.js',
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
          compatibilityDate,
          name: workerName,
          security: workerSecurity,
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
  it('emits Cloudflare worker security defaults in the worker manifest', async () => {
    const { outputDirectory } = await createFixture();
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(workerManifest.security).toMatchObject({
      enabled: true,
      headers: {
        referrerPolicy: 'strict-origin-when-cross-origin',
        contentTypeOptions: 'nosniff',
        permissionsPolicy:
          'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      },
      contentSecurityPolicy: {
        mode: 'report-only',
        directives: {
          'script-src': expect.arrayContaining([
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https:',
            'http:',
            'blob:',
          ]),
          'style-src': expect.arrayContaining([
            "'self'",
            "'unsafe-inline'",
            'https:',
            'http:',
          ]),
          'connect-src': expect.arrayContaining([
            "'self'",
            'https:',
            'http:',
            'wss:',
            'ws:',
          ]),
          'frame-ancestors': ["'self'"],
        },
      },
      noindex: {
        workersDev: true,
        localhost: true,
        previewHostnames: [],
      },
      cors: {
        assets: true,
        allowedOrigins: [],
        allowedMethods: [
          'GET',
          'HEAD',
          'POST',
          'PUT',
          'PATCH',
          'DELETE',
          'OPTIONS',
        ],
        allowedHeaders: ['*'],
      },
    });
    // The write-only cookies block is gone from the manifest.
    expect(workerManifest.security.cookies).toBeUndefined();
  });

  it('accepts the deprecated write-only cookies option as a typed no-op', async () => {
    // `modern create` workspaces (toolkit/create policy.ts
    // createCloudflareSecurityContract) still emit a `cookies` block into
    // generated modern.config.ts files. Until the generator drops it, the
    // block must stay assignable to the public config type (`satisfies`
    // below locks that in under tsc/tsgo) and must remain a runtime no-op:
    // it never reaches the worker manifest.
    const generatedSecurity = {
      enabled: true,
      noindex: {
        workersDev: true,
        localhost: true,
        previewHostnames: [],
      },
      cookies: {
        mutateSetCookie: false,
        reason:
          'Generated Cloudflare worker does not own application Set-Cookie headers.',
      },
    } satisfies CloudflareWorkerSecurityConfig;

    const { outputDirectory } = await createFixture({
      workerSecurity: generatedSecurity,
    });
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(workerManifest.security.cookies).toBeUndefined();
    expect(workerManifest.security.cors).toMatchObject({
      assets: true,
      allowedOrigins: [],
    });
  });

  it('supports typed Cloudflare worker security escape hatches', async () => {
    const { outputDirectory } = await createFixture({
      workerSecurity: {
        contentSecurityPolicy: {
          mode: 'enforce',
          additionalConnectSrc: ['https://api.example.com'],
          additionalScriptSrc: ['https://cdn.example.com'],
          frameAncestors: ["'self'", 'https://portal.example.com'],
          reason: 'embedded portal uses a remote CDN and API',
        },
        headers: {
          permissionsPolicy: 'camera=(), geolocation=()',
        },
        noindex: {
          workersDev: false,
          localhost: false,
          previewHostnames: ['preview.example.com'],
          reason: 'custom preview host',
        },
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://preview.example.com/styled'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );
    const csp = response.headers.get('content-security-policy');

    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toBeNull();
    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://api.example.com');
    expect(csp).toContain('script-src');
    expect(csp).toContain('https://cdn.example.com');
    expect(csp).toContain("frame-ancestors 'self' https://portal.example.com");
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=()',
    );
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('can disable Cloudflare worker security defaults for explicit legacy escapes', async () => {
    const { outputDirectory } = await createFixture({
      workerSecurity: {
        enabled: false,
        reason: 'legacy integration validated separately',
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/styled'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.headers.get('referrer-policy')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBeNull();
    expect(response.headers.get('permissions-policy')).toBeNull();
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toBeNull();
  });

  it('emits a wrangler config with an ASSETS binding and module worker main', async () => {
    const { outputDirectory } = await createFixture();
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.main).toBe('server/index.mjs');
    expect(wranglerConfig.compatibility_flags).toEqual([
      'nodejs_compat',
      'global_fetch_strictly_public',
    ]);
    expect(wranglerConfig.assets).toEqual({
      directory: './public',
      binding: 'ASSETS',
      run_worker_first: true,
    });
    expect(wranglerConfig.compatibility_date).toBe('2026-06-02');
  });

  it('uses configured Cloudflare compatibility dates when provided', async () => {
    const { outputDirectory } = await createFixture({
      compatibilityDate: '2026-05-27',
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.compatibility_date).toBe('2026-05-27');
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
      fs.access(path.join(outputDirectory, 'worker/(lang)/page.js')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/(lang)/cart/page.mjs')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/(lang)/cart/page.js.map')),
    ).rejects.toThrow();
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
      format: 'commonjs',
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
    await expect(
      fs.readFile(path.join(outputDirectory, 'package.json'), 'utf-8'),
    ).resolves.toBe('{"type":"commonjs"}\n');
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
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toBeNull();
    expect(await response.text()).toBe('app();');
  });

  it('does not send asset-like misses through SSR route fallback', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');

    const response = await worker.fetch(
      new Request('https://example.com/dashboard/missing.webp'),
      {
        ASSETS: createAssetBinding(publicDirectory),
      },
    );

    expect(response.status).toBe(404);
    // Application responses (including 404s) carry no CORS headers unless
    // deploy.worker.security.cors is configured.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('Not found');
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
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
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
    // SSR responses are same-origin by default: no wildcard CORS leak.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      pathname: '/dashboard/settings',
      entryName: 'main',
      htmlTemplate: '<!doctype html><html>main</html>',
      routeAssetKeys: ['main'],
      loadableName: 'loadable-fixture',
    });
  });

  it('renders Cloudflare SSR HEAD requests as GET and returns headers without a body', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/head-check', {
        method: 'HEAD',
      }),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-render-method')).toBe('GET');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-length')).toBeNull();
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toContain('script-src');
    await expect(response.text()).resolves.toBe('');
  });

  it('injects route CSS links into Cloudflare SSR HTML responses', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/styled'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    );
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toContain('script-src');
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toContain('style-src');
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toContain('connect-src');
    expect(response.headers.get('link')).toContain(
      '<https://example.com/static/app.css>; rel=preload; as=style',
    );
    expect(await response.text()).toContain(
      '<link rel="stylesheet" href="https://example.com/static/app.css">',
    );

    const workersDevResponse = await worker.fetch(
      new Request('https://commerce.example.workers.dev/styled'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(workersDevResponse.headers.get('x-robots-tag')).toBe(
      'noindex, nofollow',
    );
  });

  it('injects rendered federated remote CSS links into Cloudflare SSR HTML responses', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const originalFetch = globalThis.fetch;
    const remoteManifests: Record<string, unknown> = {
      'https://checkout.example.com/mf-manifest.json': {
        metaData: {
          publicPath: 'https://checkout.example.com/',
        },
        exposes: [
          {
            name: 'CartPage',
            path: './CartPage',
            assets: {
              css: {
                async: [],
                sync: [],
              },
            },
          },
        ],
      },
      'https://checkout.example.com/routes-manifest.json': {
        routeAssets: {
          index: {
            assets: ['static/js/checkout.js', 'static/css/checkout.css'],
            referenceCssAssets: ['static/css/checkout.css'],
          },
        },
      },
      'https://explore.example.com/mf-manifest.json': {
        metaData: {
          publicPath: 'https://explore.example.com/',
        },
        exposes: [
          {
            name: 'Header',
            path: './Header',
            assets: {
              css: {
                async: ['static/css/explore.css'],
                sync: [],
              },
            },
          },
        ],
      },
      'https://explore.example.com/routes-manifest.json': {
        routeAssets: {},
      },
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const manifest = remoteManifests[url];

      if (manifest) {
        return new Response(JSON.stringify(manifest), {
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      return originalFetch(input);
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/styled'),
        {
          ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
        },
      );
      const html = await response.text();
      const linkHeader = response.headers.get('link');

      expect(response.status).toBe(200);
      expect(
        response.headers.get('content-security-policy-report-only'),
      ).toContain('https:');
      expect(
        response.headers.get('content-security-policy-report-only'),
      ).toContain('http:');
      expect(linkHeader).toContain(
        '<https://example.com/static/app.css>; rel=preload; as=style',
      );
      expect(linkHeader).toContain(
        '<https://explore.example.com/static/css/explore.css>; rel=preload; as=style',
      );
      expect(linkHeader).toContain(
        '<https://checkout.example.com/static/css/checkout.css>; rel=preload; as=style',
      );
      expect(html).toContain(
        '<link rel="stylesheet" href="https://example.com/static/app.css">',
      );
      expect(html).toContain(
        '<link rel="stylesheet" href="https://explore.example.com/static/css/explore.css">',
      );
      expect(html).toContain(
        '<link rel="stylesheet" href="https://checkout.example.com/static/css/checkout.css">',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('serves fingerprinted Cloudflare assets with immutable cache headers', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/static/app.1234abcd.css'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('retries transient remote manifest misses before injecting federated CSS', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const originalFetch = globalThis.fetch;
    let exploreManifestFetches = 0;
    const remoteManifests: Record<string, unknown> = {
      'https://explore.example.com/mf-manifest.json': {
        metaData: {
          publicPath: 'https://explore.example.com/',
        },
        exposes: [
          {
            name: 'Header',
            path: './Header',
            assets: {
              css: {
                async: ['static/css/explore.css'],
                sync: [],
              },
            },
          },
        ],
      },
      'https://explore.example.com/routes-manifest.json': {
        routeAssets: {},
      },
      'https://checkout.example.com/mf-manifest.json': {
        metaData: {
          publicPath: 'https://checkout.example.com/',
        },
        exposes: [],
      },
      'https://checkout.example.com/routes-manifest.json': {
        routeAssets: {},
      },
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === 'https://explore.example.com/mf-manifest.json') {
        exploreManifestFetches += 1;

        if (exploreManifestFetches === 1) {
          return new Response('not ready', { status: 503 });
        }
      }

      const manifest = remoteManifests[url];

      if (manifest) {
        return new Response(JSON.stringify(manifest), {
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      return originalFetch(input);
    }) as typeof fetch;

    try {
      const assetBinding = createAssetBinding(
        path.join(outputDirectory, 'public'),
      );
      const firstResponse = await worker.fetch(
        new Request('https://example.com/styled'),
        {
          ASSETS: assetBinding,
        },
      );
      const firstHtml = await firstResponse.text();

      expect(firstResponse.status).toBe(200);
      expect(firstHtml).not.toContain(
        '<link rel="stylesheet" href="https://explore.example.com/static/css/explore.css">',
      );

      const secondResponse = await worker.fetch(
        new Request('https://example.com/styled'),
        {
          ASSETS: assetBinding,
        },
      );
      const secondHtml = await secondResponse.text();

      expect(secondResponse.status).toBe(200);
      expect(secondHtml).toContain(
        '<link rel="stylesheet" href="https://explore.example.com/static/css/explore.css">',
      );
      expect(exploreManifestFetches).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    const body = (await response.json()) as {
      dirname: string;
      filename: string;
    };
    expect(path.basename(body.dirname)).toBe('worker');
    expect(path.basename(body.filename)).toBe('dirname.js');
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
    // BFF responses are same-origin by default: no wildcard CORS leak.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      pathname: '/effect/recommendations',
      originalPath: '/commerce-api/effect/recommendations',
      method: 'GET',
      envValue: 'edge-env',
    });
  });

  it('applies configured CORS origins to BFF and SSR responses', async () => {
    const { outputDirectory } = await createFixture({
      workerSecurity: {
        cors: {
          allowedOrigins: ['https://shell.example.com'],
        },
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const env = {
      TEST_VALUE: 'edge-env',
      ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
    };

    const allowedBffResponse = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/recommendations', {
        headers: { origin: 'https://shell.example.com' },
      }),
      env,
    );

    expect(allowedBffResponse.status).toBe(200);
    expect(allowedBffResponse.headers.get('access-control-allow-origin')).toBe(
      'https://shell.example.com',
    );
    expect(allowedBffResponse.headers.get('vary')).toContain('origin');

    const disallowedBffResponse = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/recommendations', {
        headers: { origin: 'https://evil.example.com' },
      }),
      env,
    );

    expect(
      disallowedBffResponse.headers.get('access-control-allow-origin'),
    ).toBeNull();

    const ssrResponse = await worker.fetch(
      new Request('https://example.com/dashboard/settings', {
        headers: { origin: 'https://shell.example.com' },
      }),
      env,
    );

    expect(ssrResponse.status).toBe(200);
    expect(ssrResponse.headers.get('access-control-allow-origin')).toBe(
      'https://shell.example.com',
    );
  });

  it('answers application CORS preflights only for configured origins', async () => {
    const { outputDirectory } = await createFixture({
      workerSecurity: {
        cors: {
          allowedOrigins: ['https://shell.example.com'],
        },
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const env = {
      ASSETS: {
        fetch: async () => new Response('missing', { status: 404 }),
      },
    };

    const allowedPreflight = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/recommendations', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://shell.example.com',
          'access-control-request-method': 'POST',
        },
      }),
      env,
    );

    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get('access-control-allow-origin')).toBe(
      'https://shell.example.com',
    );
    // The advertised methods cover what the BFF actually serves.
    expect(
      allowedPreflight.headers.get('access-control-allow-methods'),
    ).toContain('POST');

    const disallowedPreflight = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/recommendations', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example.com',
          'access-control-request-method': 'POST',
        },
      }),
      env,
    );

    // Not answered as a CORS preflight; the OPTIONS request falls through to
    // the BFF handler and gets no CORS headers.
    expect(
      disallowedPreflight.headers.get('access-control-allow-origin'),
    ).toBeNull();
  });

  it('can disable wildcard CORS on asset responses', async () => {
    const { outputDirectory } = await createFixture({
      workerSecurity: {
        cors: {
          assets: false,
        },
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/static/app.js'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
