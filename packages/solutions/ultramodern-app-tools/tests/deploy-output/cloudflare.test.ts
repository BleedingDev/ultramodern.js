import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '@modern-js/app-tools-extensions/cloudflare';
import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerServiceBindingConfig,
  JsonValue,
} from '@modern-js/app-tools-extensions/config';
import { createUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';
import { cloudflareWorkerSources } from './fixtures/worker-sources';

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

const createSpaFallbackAssetBinding = (publicDirectory: string) => {
  const assetBinding = createAssetBinding(publicDirectory);

  return {
    fetch: async (request: Request) => {
      const response = await assetBinding.fetch(request);

      if (
        response.status !== 404 ||
        path.extname(new URL(request.url).pathname) !== ''
      ) {
        return response;
      }

      return new Response('<!doctype html><div id="root"></div>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      });
    },
  };
};

const effectBffWorkerSource = `
module.exports = {
  __modern_create_effect_bff_dispatcher: async () => ({
    dispatch: async request =>
      Response.json({ pathname: new URL(request.url).pathname }),
    dispose: async () => {},
  }),
};
`;

async function createFixture({
  apiOnly = false,
  artifacts,
  bffCrossProjectPolicy,
  d1Databases,
  distFiles,
  includeBffWorker = true,
  publicAssetExcludes,
  services,
  sourceFiles,
  wrangler,
  workerName,
  workerSecurity,
  deliveryUnit,
  buildArtifactIdentity,
}: {
  apiOnly?: boolean;
  artifacts?: CloudflareWorkerArtifactConfig[];
  bffCrossProjectPolicy?: Record<string, unknown>;
  d1Databases?: CloudflareWorkerD1DatabaseConfig[];
  distFiles?: Record<string, string>;
  includeBffWorker?: boolean;
  publicAssetExcludes?: string[];
  services?: CloudflareWorkerServiceBindingConfig[];
  sourceFiles?: Record<string, Record<string, string>>;
  wrangler?: Record<string, JsonValue>;
  workerName?: string;
  workerSecurity?: Record<string, unknown>;
  deliveryUnit?: {
    unitId: string;
    buildMarker: string;
    sourceRevision: string;
  };
  buildArtifactIdentity?: {
    unitId: string;
    buildMarker: string;
    sourceRevision: string;
  };
} = {}) {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-deploy-'),
  );
  tempDirectories.push(appDirectory);

  const distDirectory = path.join(appDirectory, 'dist');
  for (const [directory, files] of Object.entries(sourceFiles ?? {})) {
    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(appDirectory, directory, filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }
  await fs.mkdir(path.join(distDirectory, 'static'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'worker'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'bundles'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/plain'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/main'), { recursive: true });
  await fs.mkdir(path.join(distDirectory, 'html/fallback'), {
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
    cloudflareWorkerSources.main,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/main.js.map'),
    '{"version":3}',
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/empty.js'),
    cloudflareWorkerSources.empty,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/html.js'),
    cloudflareWorkerSources.html,
  );
  await fs.writeFile(
    path.join(distDirectory, 'bundles/main.js'),
    cloudflareWorkerSources.bundleFallback,
  );
  if (includeBffWorker) {
    await fs.writeFile(
      path.join(distDirectory, 'worker/__modern_bff_effect.js'),
      effectBffWorkerSource,
    );
  }
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
    JSON.stringify({ name: 'loadable-fixture' }),
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
          urlPath: '/styled',
          entryName: 'main',
          entryPath: 'html/main/index.html',
          isSSR: true,
          worker: 'worker/html.js',
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

  for (const [filename, content] of Object.entries(distFiles ?? {})) {
    const filePath = path.join(distDirectory, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  if (deliveryUnit) {
    await fs.mkdir(path.join(appDirectory, 'topology'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'topology/reference-topology.json'),
      `${JSON.stringify(
        {
          shell: {
            id: 'checkout',
            kind: 'shell',
            path: '.',
            package: '@acme/checkout',
            deliveryUnit,
          },
          verticals: [],
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(appDirectory, 'package.json'),
      JSON.stringify({ name: '@acme/checkout', version: '0.1.0' }),
    );

    const buildIdentity = buildArtifactIdentity ?? deliveryUnit;
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'shared/ultramodern-build.json'),
      JSON.stringify(
        createUltramodernBuildArtifact({
          ...buildIdentity,
          appId: 'checkout',
          deployProfile: 'cloudflare-ssr-mf-effect-v1',
          kind: 'microvertical-delivery-unit',
          packageName: '@acme/checkout',
          schemaVersion: 1,
          version: '0.1.0',
        }),
      ),
    );
  }

  const preset = createCloudflarePreset({
    appContext: {
      apiOnly,
      appDirectory,
      distDirectory,
      serverPlugins: [],
    } as any,
    modernConfig: {
      bff: {
        crossProjectPolicy: bffCrossProjectPolicy,
        prefix: '/commerce-api',
        runtimeFramework: 'effect',
      },
      deploy: {
        worker: {
          artifacts,
          d1Databases,
          name: workerName,
          publicAssetExcludes,
          security: workerSecurity,
          services,
          wrangler,
        },
      },
    } as any,
    api: {
      isPluginExists: () => false,
    } as any,
  });

  await preset.prepare?.();
  await preset.writeOutput?.();
  await preset.genEntry?.();

  return {
    appDirectory,
    outputDirectory: path.join(appDirectory, '.output'),
  };
}

const loadWorker = async (outputDirectory: string) =>
  (
    await import(
      `${
        pathToFileURL(path.join(outputDirectory, 'server/index.mjs')).href
      }?t=${Date.now()}`
    )
  ).default;

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
  it('fails clearly when Effect BFF is configured but its worker bundle is missing', async () => {
    await expect(createFixture({ includeBffWorker: false })).rejects.toThrow(
      /Cloudflare Effect API runtime is configured, but the BFF worker bundle is missing/u,
    );
  });

  it('fails closed when an Effect cross-project policy cannot be serialized into the worker manifest', async () => {
    await expect(
      createFixture({
        bffCrossProjectPolicy: {
          enabled: true,
          verifyProducerIdentity: () => 'catalog',
        },
      }),
    ).rejects.toThrow(
      /Cloudflare Effect BFF cannot serialize bff\.crossProjectPolicy\.verifyProducerIdentity/u,
    );
  });

  it('fails closed when the bundled build marker drifts from the topology delivery-unit record', async () => {
    await expect(
      createFixture({
        deliveryUnit: {
          unitId: 'acme/checkout',
          buildMarker: '0123456789abcdef',
          sourceRevision: 'workspace',
        },
        buildArtifactIdentity: {
          unitId: 'acme/checkout',
          buildMarker: 'deadbeefdeadbeef',
          sourceRevision: 'workspace',
        },
      }),
    ).rejects.toThrow(/delivery-unit-drift/u);
  });

  it('merges Wrangler config, stages artifacts, and enforces Worker invariants', async () => {
    const { outputDirectory } = await createFixture({
      artifacts: [
        {
          from: 'ops/runtime-policy.json',
          to: 'config/runtime-policy.json',
        },
      ],
      sourceFiles: {
        ops: {
          'runtime-policy.json': '{"revision":"2026-06-27"}',
        },
      },
      wrangler: {
        compatibility_date: '2026-07-01',
        compatibility_flags: ['streams_enable_constructors', 'nodejs_compat'],
        main: 'custom-entry.mjs',
        assets: {
          binding: 'CUSTOM_ASSETS',
          directory: './static-assets',
          html_handling: 'auto-trailing-slash',
          run_worker_first: false,
        },
        vars: {
          FEATURE_FLAG: 'enabled',
        },
      },
      workerName: 'commerce-production-worker',
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.name).toBe('commerce-production-worker');
    expect(wranglerConfig.compatibility_date).toBe('2026-07-01');
    expect(wranglerConfig.main).toBe('server/index.mjs');
    expect(wranglerConfig.compatibility_flags).toEqual([
      'streams_enable_constructors',
      'nodejs_compat',
      'global_fetch_strictly_public',
    ]);
    expect(wranglerConfig.assets).toEqual({
      binding: 'ASSETS',
      directory: './public',
      html_handling: 'auto-trailing-slash',
      run_worker_first: true,
    });
    expect(wranglerConfig.vars).toEqual({ FEATURE_FLAG: 'enabled' });
    await expect(
      fs
        .readFile(
          path.join(outputDirectory, 'config/runtime-policy.json'),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toEqual({ revision: '2026-06-27' });
  });

  it('rejects artifacts staged into framework-owned or escaping Cloudflare output paths', async () => {
    await expect(
      createFixture({
        artifacts: [{ from: 'ops/config.json', to: 'wrangler.json' }],
        sourceFiles: { ops: { 'config.json': '{}' } },
      }),
    ).rejects.toThrow(/deploy\.worker\.artifacts\[0\]\.to/u);
    await expect(
      createFixture({
        artifacts: [{ from: 'ops/..', to: 'config/runtime-policy.json' }],
        sourceFiles: { ops: { 'runtime-policy.json': '{}' } },
      }),
    ).rejects.toThrow(/deploy\.worker\.artifacts\[0\]\.from/u);
  });

  it('emits declarative D1 bindings and stages migrations', async () => {
    const { outputDirectory } = await createFixture({
      d1Databases: [
        {
          binding: 'DB',
          databaseName: 'app-data',
          databaseId: '11111111-1111-4111-8111-111111111111',
          migrationsDir: 'migrations/d1',
          previewDatabaseId: '22222222-2222-4222-8222-222222222222',
          remote: true,
        },
      ],
      sourceFiles: {
        'migrations/d1': {
          '0001_init.sql': 'CREATE TABLE suggestions (id TEXT PRIMARY KEY);',
        },
      },
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.d1_databases).toEqual([
      {
        binding: 'DB',
        database_name: 'app-data',
        database_id: '11111111-1111-4111-8111-111111111111',
        migrations_dir: 'migrations/d1',
        preview_database_id: '22222222-2222-4222-8222-222222222222',
        remote: true,
      },
    ]);
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'migrations/d1/0001_init.sql'),
        'utf-8',
      ),
    ).resolves.toBe('CREATE TABLE suggestions (id TEXT PRIMARY KEY);');
  });

  it('emits typed service bindings to wrangler and worker manifest', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_CATALOG_WORKER',
          prefix: '/catalog-api',
          service: 'tractor-catalog-worker',
        },
      ],
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(wranglerConfig.services).toEqual([
      {
        binding: 'VERTICAL_CATALOG_WORKER',
        service: 'tractor-catalog-worker',
      },
    ]);
    expect(workerManifest.serviceBindings).toEqual([
      {
        binding: 'VERTICAL_CATALOG_WORKER',
        interface: 'fetch',
        prefix: '/catalog-api',
        service: 'tractor-catalog-worker',
      },
    ]);
  });

  it('keeps server bundles and source maps out of Cloudflare public assets', async () => {
    const { outputDirectory } = await createFixture();
    const publicDirectory = path.join(outputDirectory, 'public');

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
      fs.access(path.join(publicDirectory, 'bundles/main.js')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(outputDirectory, 'worker/main.js.map')),
    ).rejects.toThrow();
  });

  it('publishes only explicit assets and backend contracts from API-only builds', async () => {
    const publicFiles = {
      '.well-known/ontos-module-manifest.json': '{"kind":"api-only"}',
      _headers: '/api/*\n  Cache-Control: no-store',
      'robots.txt': 'User-agent: *\nDisallow: /',
    };
    const backendFiles = {
      'backend-mf-manifest.json': '{"name":"payment-term"}',
      'backendRemoteEntry.cjs': 'module.exports = {};',
      'ultramodern-build.json': '{"buildMarker":"api-only"}',
    };
    const privateFiles = {
      'src/actions/change.js': 'export const change = () => {};',
      'src/actions/change.d.ts': 'export declare const change: () => void;',
      'domain/persistence/repository.js': 'export const database = "private";',
      'arbitrary-import-root/secret.json': '{"token":"private"}',
      'vertical.registration.js': 'export const registration = {};',
      'private.d.ts': 'export declare const privateValue: string;',
    };
    const { outputDirectory } = await createFixture({
      apiOnly: true,
      distFiles: {
        ...backendFiles,
        ...privateFiles,
        ...Object.fromEntries(
          Object.entries(publicFiles).map(([filename, content]) => [
            `public/${filename}`,
            content,
          ]),
        ),
      },
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    for (const [filename, content] of Object.entries({
      ...publicFiles,
      ...backendFiles,
    })) {
      await expect(
        fs.readFile(path.join(publicDirectory, filename), 'utf-8'),
      ).resolves.toBe(content);
    }
    for (const filename of Object.keys(privateFiles)) {
      await expect(
        fs.access(path.join(publicDirectory, filename)),
      ).rejects.toThrow();
    }
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'worker/__modern_bff_effect.js'),
        'utf-8',
      ),
    ).resolves.toBe(effectBffWorkerSource);
  });

  it('does not expose dotenv files through Cloudflare public assets', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        '.env': 'SECRET_TOKEN=public-leak',
        'static/.env.local': 'SECRET_TOKEN=static-leak',
        '.well-known/security.txt': 'contact: security@example.com',
      },
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    await expect(
      fs.access(path.join(publicDirectory, '.env')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'static/.env.local')),
    ).rejects.toThrow();
    await expect(
      fs.readFile(
        path.join(publicDirectory, '.well-known/security.txt'),
        'utf-8',
      ),
    ).resolves.toBe('contact: security@example.com');
  });

  it('applies public asset exclusions to flattened dist/public assets', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        'public/.env': 'SECRET_TOKEN=public-leak',
        'public/private-assets/data.json': '{"private":true}',
        'public/route.json': '{"routes":[]}',
        'public/static/app.js': 'console.log("public")',
        'public/worker/index.mjs': 'export const secret = true;',
      },
      publicAssetExcludes: ['private-assets'],
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    await expect(
      fs.readFile(path.join(publicDirectory, 'static/app.js'), 'utf-8'),
    ).resolves.toBe('console.log("public")');
    await expect(
      fs.access(path.join(publicDirectory, 'public/static/app.js')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, '.env')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'private-assets/data.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'route.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'worker/index.mjs')),
    ).rejects.toThrow();
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
    const worker = await loadWorker(outputDirectory);

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
    expect(csp).toContain('https://api.example.com');
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
    const worker = await loadWorker(outputDirectory);

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

  it('dispatches SSR document routes before Cloudflare Assets SPA fallback', async () => {
    const { outputDirectory } = await createFixture();
    const worker = await loadWorker(outputDirectory);
    const requestedPaths: string[] = [];
    const assetBinding = createSpaFallbackAssetBinding(
      path.join(outputDirectory, 'public'),
    );

    const response = await worker.fetch(
      new Request('https://example.com/dashboard/settings'),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            requestedPaths.push(new URL(request.url).pathname);

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
    expect(requestedPaths).not.toContain('/dashboard/settings');
  });

  it('dispatches encoded spellings of the BFF prefix to the BFF, never to Worker Static Assets', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        'commerce-api/orders.json': '{"secret":"static"}',
      },
    });
    const worker = await loadWorker(outputDirectory);
    const requestedAssets: string[] = [];
    const assetBinding = createAssetBinding(
      path.join(outputDirectory, 'public'),
    );
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          requestedAssets.push(new URL(request.url).pathname);
          return assetBinding.fetch(request);
        },
      },
    };
    const dispatch = async (pathname: string) => {
      const response = await worker.fetch(
        new Request(`https://example.com${pathname}`),
        env,
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { pathname: string }).pathname;
    };

    for (const pathname of [
      '/commerce-api/orders.json',
      '/%63ommerce-api/orders.json',
      '/%2563ommerce-api/orders.json',
      '/%252563ommerce-api/orders.json',
      '/commerce-api%2forders.json',
      '/commerce-api%2Forders.json',
      '/commerce-api%252Forders.json',
    ]) {
      await expect(dispatch(pathname)).resolves.toBe(
        '/commerce-api/orders.json',
      );
    }
    for (const pathname of [
      '/commerce-api%5Corders.json',
      '/commerce-api%5corders.json',
      '/commerce-api%ZZ/orders.json',
      '/COMMERCE-API%ZZ/orders.json',
    ]) {
      await expect(dispatch(pathname)).resolves.toBe(
        '/commerce-api/__invalid_encoded_path__',
      );
    }
    expect(requestedAssets).toEqual([]);

    const assetResponse = await worker.fetch(
      new Request('https://example.com/static/app.1234abcd.css'),
      env,
    );
    expect(assetResponse.status).toBe(200);
    expect(requestedAssets).toEqual(['/static/app.1234abcd.css']);
  });

  it('dispatches encoded spellings of a service binding prefix to the binding', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_CATALOG_WORKER',
          prefix: '/catalog-api',
          service: 'tractor-catalog-worker',
        },
      ],
    });
    const worker = await loadWorker(outputDirectory);
    const serviceRequests: string[] = [];

    for (const pathname of [
      '/%63atalog-api/items.json',
      '/catalog-api%2Fitems.json',
    ]) {
      const response = await worker.fetch(
        new Request(`https://example.com${pathname}`),
        {
          ASSETS: {
            fetch: async () => new Response('asset', { status: 200 }),
          },
          VERTICAL_CATALOG_WORKER: {
            fetch: async (request: Request) => {
              serviceRequests.push(new URL(request.url).pathname);
              return new Response('catalog', { status: 200 });
            },
          },
        },
      );
      await expect(response.text()).resolves.toBe('catalog');
    }
    expect(serviceRequests).toEqual([
      '/%63atalog-api/items.json',
      '/catalog-api%2Fitems.json',
    ]);
  });

  it('serves fingerprinted Cloudflare assets with immutable cache headers', async () => {
    const { outputDirectory } = await createFixture();
    const worker = await loadWorker(outputDirectory);

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
  });
});
