import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '@modern-js/app-tools-extensions/cloudflare';
import { resolveTopologyDeliveryUnit } from '@modern-js/app-tools-extensions/cloudflare/delivery-unit';
import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerPublicAssetConfig,
  CloudflareWorkerSecurityConfig,
  CloudflareWorkerServiceBindingConfig,
  JsonValue,
} from '@modern-js/app-tools-extensions/config';
import { normalizeRouterAssetPublicPath } from '../../src/builder/shared/bundlerPlugins/RouterPlugin';
import { cloudflareWorkerSources } from '../fixtures/cloudflare/worker-sources';

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

      if (response.status !== 404) {
        return response;
      }

      const { pathname } = new URL(request.url);

      if (path.extname(pathname) === '') {
        return new Response('<!doctype html><div id="root"></div>', {
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
          status: 200,
        });
      }

      return response;
    },
  };
};

const effectEdgePackageSource = `
let currentContext;

function normalizePrefix(prefix) {
  if (!prefix || prefix === '/') {
    return '';
  }

  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function matchesPrefix(pathname, prefix) {
  const normalized = normalizePrefix(prefix);

  return (
    !normalized ||
    pathname === normalized ||
    pathname.startsWith(\`\${normalized}/\`)
  );
}

function createRequestForMountedPrefix(request, prefix) {
  const normalized = normalizePrefix(prefix);

  if (!normalized) {
    return request;
  }

  const url = new URL(request.url);

  if (!matchesPrefix(url.pathname, normalized)) {
    return request;
  }

  const nextPath = url.pathname.slice(normalized.length) || '/';
  url.pathname = nextPath.startsWith('/') ? nextPath : \`/\${nextPath}\`;

  return new Request(url, request);
}

function getRuntimeModule(workerModule) {
  const defaultExport = workerModule.default;
  const nestedDefaultExport =
    defaultExport && typeof defaultExport === 'object'
      ? defaultExport.default
      : undefined;

  return defaultExport && typeof defaultExport === 'object'
    ? {
        ...workerModule,
        ...defaultExport,
        ...(nestedDefaultExport && typeof nestedDefaultExport === 'object'
          ? nestedDefaultExport
          : {}),
      }
    : workerModule;
}

export async function createEffectBffEdgeHandler(options) {
  const runtime = getRuntimeModule(options.module);
  const created =
    typeof runtime.createHandler === 'function'
      ? runtime.createHandler()
      : undefined;
  const handler =
    typeof created?.handler === 'function'
      ? created.handler
      : runtime.api &&
          runtime.layer &&
          typeof runtime.layer.handle === 'function'
        ? runtime.layer.handle
        : undefined;

  if (typeof handler !== 'function') {
    throw new Error('test Effect BFF worker has no handler');
  }

  return {
    handler: async (request, dispatchOptions = {}) => {
      const url = new URL(request.url);

      if (!matchesPrefix(url.pathname, options.prefix)) {
        return new Response(null, { status: 404 });
      }

      const effectRequest = createRequestForMountedPrefix(
        request,
        options.prefix,
      );
      const context = {
        request: effectRequest,
        env: dispatchOptions.env || {},
        path: url.pathname,
        method: request.method,
        operationContext: {
          request: effectRequest,
          env: dispatchOptions.env || {},
          path: url.pathname,
          method: request.method,
          routePath: new URL(effectRequest.url).pathname,
          attributes: {
            mountedPath: url.pathname,
          },
        },
      };
      const previousContext = currentContext;

      currentContext = context;

      try {
        const response = await handler(effectRequest);
        return new Response(response.body, response);
      } finally {
        currentContext = previousContext;
      }
    },
    dispose: created?.dispose || (async () => {}),
  };
}

export async function createEffectBffEdgeDispatcher(options) {
  const effectHandler = await createEffectBffEdgeHandler(options);

  return {
    dispatch: effectHandler.handler,
    dispose: effectHandler.dispose,
  };
}

export function useEffectContext() {
  if (!currentContext) {
    throw new Error("Can't call useEffectContext out of Effect runtime scope");
  }

  return currentContext;
}
`;

const bundledEffectDispatcherSource = `
let currentEffectContext;

function useEffectContext() {
  if (!currentEffectContext) {
    throw new Error("Can't call useEffectContext out of Effect runtime scope");
  }

  return currentEffectContext;
}

function normalizeEffectPrefix(prefix) {
  if (!prefix || prefix === '/') {
    return '';
  }

  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

const __modern_create_effect_bff_dispatcher = async options => {
  const created =
    typeof effectModule.createHandler === 'function'
      ? effectModule.createHandler()
      : undefined;
  const handler =
    typeof created?.handler === 'function'
      ? created.handler
      : effectModule.api &&
          effectModule.layer &&
          typeof effectModule.layer.handle === 'function'
        ? effectModule.layer.handle
        : undefined;

  if (typeof handler !== 'function') {
    throw new Error('test Effect BFF worker has no handler');
  }

  return {
    dispatch: async (request, dispatchOptions = {}) => {
      const url = new URL(request.url);
      const prefix = normalizeEffectPrefix(options.prefix);
      if (
        prefix &&
        url.pathname !== prefix &&
        !url.pathname.startsWith(\`\${prefix}/\`)
      ) {
        return new Response(null, { status: 404 });
      }

      const mountedPath = url.pathname;
      if (prefix) {
        url.pathname = url.pathname.slice(prefix.length) || '/';
      }
      const effectRequest = prefix ? new Request(url, request) : request;
      const previousContext = currentEffectContext;
      currentEffectContext = {
        env: dispatchOptions.env || {},
        method: request.method,
        operationContext: {
          attributes: { mountedPath },
          env: dispatchOptions.env || {},
          method: request.method,
          path: mountedPath,
          request: effectRequest,
          routePath: new URL(effectRequest.url).pathname,
        },
        path: mountedPath,
        request: effectRequest,
      };

      try {
        const response = await handler(effectRequest);
        return new Response(response.body, response);
      } finally {
        currentEffectContext = previousContext;
      }
    },
    dispose: created?.dispose || (async () => {}),
  };
};
`;

const defaultEffectBffWorkerSource = `
const createHandler = () => ({
  handler: async request => {
    const context = useEffectContext();

    return new Response(JSON.stringify({
      pathname: new URL(request.url).pathname,
      originalPath: context.path,
      method: context.method,
      envValue: context.env.TEST_VALUE,
    }), { headers: { 'content-type': 'application/json' } });
  },
  dispose: async () => {},
});

Object.defineProperty(createHandler, Symbol.for('modernjs.effect.validatorAware'), {
  value: true,
});

const effectModule = { createHandler };
${bundledEffectDispatcherSource}

module.exports = {
  __modern_create_effect_bff_dispatcher,
  default: effectModule,
};
`;

const effectHttpApiWorkerSource = `
const effectModule = {
  api: { name: 'CatalogHttpApi' },
  layer: {
    handle: async request => {
      const context = useEffectContext();

      return new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        routePath: context.operationContext.routePath,
        originalPath: context.path,
        envValue: context.env.TEST_VALUE,
      }), { headers: { 'content-type': 'application/json' } });
    },
  },
};
${bundledEffectDispatcherSource}

module.exports = {
  __modern_create_effect_bff_dispatcher,
  default: effectModule,
};
`;

const effectDrizzleWorkerSource = `
// bundled from drizzle-orm/sqlite-core
const entityKind = Symbol.for('drizzle:entityKind');
class Table {
  static [entityKind] = 'Table';

  constructor(name) {
    this.name = name;
  }
}
class SQLiteTable extends Table {
  static [entityKind] = 'SQLiteTable';
}
const text = name => ({ name, type: 'text' });
const sqliteTable = (name, columns) => {
  class CatalogFixtureTable extends SQLiteTable {
    static [entityKind] = 'SQLiteTable';
  }

  return Object.assign(new CatalogFixtureTable(name), {
    columns,
    [entityKind]: CatalogFixtureTable[entityKind],
  });
};

const createHandler = () => ({
  handler: async request => {
    const context = useEffectContext();
    const table = sqliteTable('catalog_addresses', {
      street: text('street'),
    });

    return new Response(JSON.stringify({
      pathname: new URL(request.url).pathname,
      originalPath: context.path,
      envValue: context.env.TEST_VALUE,
      tableName: table.name,
      entityKind: table[entityKind],
    }), { headers: { 'content-type': 'application/json' } });
  },
  dispose: async () => {},
});

Object.defineProperty(createHandler, Symbol.for('modernjs.effect.validatorAware'), {
  value: true,
});

const effectModule = { createHandler };
${bundledEffectDispatcherSource}

module.exports = {
  __modern_create_effect_bff_dispatcher,
  default: effectModule,
};
`;

const recoveringEffectBffWorkerSource = `
let createCount = 0;
let disposeCount = 0;

const __modern_create_effect_bff_dispatcher = async () => {
  createCount += 1;

  if (createCount === 1) {
    return {
      dispose: async () => {
        disposeCount += 1;
      },
    };
  }

  return {
    dispatch: async () =>
      new Response(JSON.stringify({ createCount, disposeCount }), {
        headers: { 'content-type': 'application/json' },
      }),
    dispose: async () => {
      disposeCount += 1;
    },
  };
};

module.exports = { __modern_create_effect_bff_dispatcher };
`;

const configurationAwareEffectBffWorkerSource = `
const __modern_create_effect_bff_dispatcher = async options => ({
  dispatch: async () => Response.json(options),
  dispose: async () => {},
});

module.exports = { __modern_create_effect_bff_dispatcher };
`;

async function createFixture({
  artifacts,
  bffCrossProjectPolicy,
  bffEffect,
  bffIsCrossProjectServer,
  bffPrefix = '/commerce-api',
  bffRequestId,
  bffWorkerSource = defaultEffectBffWorkerSource,
  compatibilityDate,
  d1Databases,
  distFiles,
  includeBffWorker = true,
  includeRootRoute = false,
  includeServerOnlyDistSources = false,
  releaseEnvelopeEnabled = false,
  publicAssetExcludes,
  publicAssets,
  serverPlugins,
  services,
  sourceFiles,
  wrangler,
  workerName,
  workerSecurity,
  deliveryUnit,
  buildModuleIdentity,
}: {
  artifacts?: CloudflareWorkerArtifactConfig[];
  bffCrossProjectPolicy?: Record<string, unknown>;
  bffEffect?: Record<string, unknown>;
  bffIsCrossProjectServer?: boolean;
  bffPrefix?: string;
  bffRequestId?: string;
  bffWorkerSource?: string;
  compatibilityDate?: string;
  d1Databases?: CloudflareWorkerD1DatabaseConfig[];
  distFiles?: Record<string, string>;
  includeBffWorker?: boolean;
  includeRootRoute?: boolean;
  includeServerOnlyDistSources?: boolean;
  releaseEnvelopeEnabled?: boolean;
  publicAssetExcludes?: string[];
  publicAssets?: CloudflareWorkerPublicAssetConfig[];
  serverPlugins?: Array<{
    name: string;
    options?: Record<string, unknown>;
  }>;
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
  buildModuleIdentity?: {
    unitId: string;
    buildMarker: string;
    sourceRevision: string;
  };
} = {}) {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-cloudflare-deploy-'),
  );
  tempDirectories.push(appDirectory);

  const effectEdgePackageDirectory = path.join(
    appDirectory,
    'node_modules/@modern-js/plugin-bff',
  );
  await fs.mkdir(effectEdgePackageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(effectEdgePackageDirectory, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        exports: {
          './effect-edge': './effect-edge.mjs',
        },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(effectEdgePackageDirectory, 'effect-edge.mjs'),
    effectEdgePackageSource,
  );

  const drizzlePackageDirectory = path.join(
    appDirectory,
    'node_modules/drizzle-orm',
  );
  await fs.mkdir(path.join(drizzlePackageDirectory, 'sqlite-core'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(drizzlePackageDirectory, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        exports: {
          './sqlite-core': './sqlite-core/index.mjs',
        },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(drizzlePackageDirectory, 'sqlite-core/index.mjs'),
    `
export const entityKind = Symbol.for('drizzle:entityKind');

export class Table {
  static [entityKind] = 'Table';

  constructor(name) {
    this.name = name;
  }
}

export class SQLiteTable extends Table {
  static [entityKind] = 'SQLiteTable';
}

export function text(name) {
  return { name, type: 'text' };
}

export function sqliteTable(name, columns) {
  class CatalogFixtureTable extends SQLiteTable {
    static [entityKind] = 'SQLiteTable';
  }

  return Object.assign(new CatalogFixtureTable(), {
    columns,
    name,
    [entityKind]: CatalogFixtureTable[entityKind],
  });
}
`,
  );

  const distDirectory = path.join(appDirectory, 'dist');
  if (includeServerOnlyDistSources) {
    await fs.mkdir(path.join(appDirectory, 'api'), { recursive: true });
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
  }
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
    cloudflareWorkerSources.main,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/empty.js'),
    cloudflareWorkerSources.empty,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/dirname.js'),
    cloudflareWorkerSources.dirname,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/html.js'),
    cloudflareWorkerSources.html,
  );
  await fs.writeFile(
    path.join(distDirectory, 'worker/head.js'),
    cloudflareWorkerSources.head,
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
    cloudflareWorkerSources.empty,
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
    cloudflareWorkerSources.promiseDefault,
  );
  await fs.writeFile(
    path.join(distDirectory, 'bundles/main.js'),
    cloudflareWorkerSources.bundleFallback,
  );
  if (includeBffWorker) {
    await fs.writeFile(
      path.join(distDirectory, 'worker/__modern_bff_effect.js'),
      bffWorkerSource,
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
    path.join(distDirectory, 'backend-mf-manifest.json'),
    JSON.stringify({
      remotes: [
        {
          alias: 'catalog-backend',
          entry: 'backendRemoteEntry.cjs',
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(distDirectory, 'backendRemoteEntry.cjs'),
    'module.exports = { name: "catalog-backend" };',
  );
  await fs.writeFile(
    path.join(distDirectory, 'route.json'),
    JSON.stringify({
      routes: [
        ...(includeRootRoute
          ? [
              {
                urlPath: '/',
                entryName: 'main',
                entryPath: 'html/main/index.html',
                isSSR: true,
                worker: 'worker/main.js',
                bundle: 'bundles/main.js',
              },
            ]
          : []),
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
  if (includeServerOnlyDistSources) {
    await fs.mkdir(path.join(distDirectory, 'api'), { recursive: true });
    await fs.mkdir(path.join(distDirectory, 'shared'), { recursive: true });
    await fs.mkdir(path.join(distDirectory, 'private-assets'), {
      recursive: true,
    });
    await fs.writeFile(path.join(distDirectory, 'api/index.ts'), 'server api');
    await fs.writeFile(
      path.join(distDirectory, 'shared/schema.ts'),
      'server shared',
    );
    await fs.writeFile(
      path.join(distDirectory, 'private-assets/data.json'),
      '{}',
    );
  }

  for (const [filename, content] of Object.entries(distFiles ?? {})) {
    const filePath = path.join(distDirectory, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  if (deliveryUnit) {
    await fs.mkdir(path.join(appDirectory, '.modernjs'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, '.modernjs/ultramodern.json'),
      `${JSON.stringify(
        {
          topology: {
            apps: [
              {
                id: 'checkout',
                kind: 'remote',
                path: '.',
                api: { prefix: bffPrefix },
                deliveryUnit: {
                  unitId: deliveryUnit.unitId,
                  buildMarker: deliveryUnit.buildMarker,
                  sourceRevision: deliveryUnit.sourceRevision,
                },
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    const buildIdentity = buildModuleIdentity ?? deliveryUnit;
    await fs.mkdir(path.join(appDirectory, 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(appDirectory, 'shared/ultramodern-build.ts'),
      `export const ultramodernDeliveryUnit = {
  build: '${buildIdentity.buildMarker}',
  sourceRevision: '${buildIdentity.sourceRevision}',
  unitId: '${buildIdentity.unitId}',
} as const;
`,
    );
  }

  const preset = createCloudflarePreset({
    appContext: {
      appDirectory,
      distDirectory,
      serverPlugins: serverPlugins ?? [],
    } as any,
    modernConfig: {
      bff: {
        crossProjectPolicy: bffCrossProjectPolicy,
        effect: bffEffect,
        isCrossProjectServer: bffIsCrossProjectServer,
        prefix: bffPrefix,
        requestId: bffRequestId,
        runtimeFramework: 'effect',
      },
      deploy: {
        worker: {
          artifacts,
          compatibilityDate,
          d1Databases,
          name: workerName,
          publicAssetExcludes,
          publicAssets,
          security: workerSecurity,
          services,
          wrangler,
        },
      },
    } as any,
    api: {
      isPluginExists: (name: string) =>
        releaseEnvelopeEnabled &&
        name === '@modern-js/ultramodern-release-envelope',
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
  it('resolves the Rspack auto public path from the Worker origin root', async () => {
    const fixtureDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-cloudflare-loadable-'),
    );
    tempDirectories.push(fixtureDirectory);
    const templatePath = path.join(fixtureDirectory, 'loadable-server.mjs');
    await fs.copyFile(
      path.resolve(
        __dirname,
        '../../../app-tools-extensions/src/templates/cloudflare-worker-loadable-server.mjs',
      ),
      templatePath,
    );
    for (const [packageName, source] of [
      [
        'react',
        'export default { createContext: () => ({}), createElement: () => undefined };',
      ],
      [
        '@loadable/component',
        'export default { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {} };',
      ],
    ]) {
      const packageDirectory = path.join(
        fixtureDirectory,
        'node_modules',
        packageName,
      );
      await fs.mkdir(packageDirectory, { recursive: true });
      await fs.writeFile(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({ type: 'module', exports: './index.js' }),
      );
      await fs.writeFile(path.join(packageDirectory, 'index.js'), source);
    }
    const { ChunkExtractor } = await import(
      `${pathToFileURL(templatePath).href}?t=${Date.now()}`
    );
    for (const publicPath of ['auto', 'auto/']) {
      const extractor = new ChunkExtractor({
        entrypoints: ['main'],
        stats: {
          namedChunkGroups: {
            main: {
              assets: [
                'static/js/main.12345678.js',
                'static/css/main.12345678.css',
              ],
              childAssets: {},
              chunks: [],
            },
          },
          publicPath,
        },
      });

      expect(extractor.getChunkAssets('main').map(asset => asset.url)).toEqual([
        '/static/js/main.12345678.js',
        '/static/css/main.12345678.css',
      ]);
    }

    expect(normalizeRouterAssetPublicPath('auto')).toBe('/');
    expect(normalizeRouterAssetPublicPath('auto/')).toBe('/');
  });

  it('fails clearly when Effect BFF is configured but its worker bundle is missing', async () => {
    await expect(createFixture({ includeBffWorker: false })).rejects.toThrow(
      /Cloudflare Effect API runtime is configured, but the BFF worker bundle is missing: .*worker[\\/]__modern_bff_effect\.js.*@modern-js\/plugin-bff\/effect-edge/u,
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
        compatibility_date: '2026-05-01',
        compatibility_flags: ['streams_enable_constructors', 'nodejs_compat'],
        main: 'custom-entry.mjs',
        assets: {
          binding: 'CUSTOM_ASSETS',
          directory: './static-assets',
          html_handling: 'auto-trailing-slash',
          run_worker_first: false,
        },
        observability: {
          enabled: true,
        },
        placement: {
          mode: 'smart',
        },
        vars: {
          FEATURE_FLAG: 'enabled',
        },
      },
    });
    const wranglerConfig = JSON.parse(
      await fs.readFile(path.join(outputDirectory, 'wrangler.json'), 'utf-8'),
    );

    expect(wranglerConfig.compatibility_date).toBe('2026-05-01');
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
    expect(wranglerConfig.observability).toEqual({
      enabled: true,
    });
    expect(wranglerConfig.placement).toEqual({
      mode: 'smart',
    });
    expect(wranglerConfig.vars).toEqual({
      FEATURE_FLAG: 'enabled',
    });
    await expect(
      fs
        .readFile(
          path.join(outputDirectory, 'config/runtime-policy.json'),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toEqual({ revision: '2026-06-27' });
  });

  it('stages configured public assets under Cloudflare Worker Static Assets', async () => {
    const { outputDirectory } = await createFixture({
      publicAssets: [
        {
          from: 'ops/owned-data',
          to: 'fixture-owned-data',
        },
        {
          from: 'public-surface',
          to: '.',
        },
      ],
      sourceFiles: {
        'ops/owned-data': {
          'manifest.json': '{"schemaVersion":"fixture-owned-artifacts/v1"}',
          'postal-prefix/CZ/101.json': '{"records":[]}',
        },
        'public-surface': {
          'robots.txt': 'User-agent: *\nDisallow: /\n',
          'site.webmanifest': '{"name":"Fixture Catalog"}',
        },
      },
    });

    await expect(
      fs
        .readFile(
          path.join(outputDirectory, 'public/fixture-owned-data/manifest.json'),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toEqual({ schemaVersion: 'fixture-owned-artifacts/v1' });
    await expect(
      fs
        .readFile(
          path.join(
            outputDirectory,
            'public/fixture-owned-data/postal-prefix/CZ/101.json',
          ),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toEqual({ records: [] });
    await expect(
      fs.readFile(path.join(outputDirectory, 'public/robots.txt'), 'utf-8'),
    ).resolves.toBe('User-agent: *\nDisallow: /\n');
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'public/site.webmanifest'),
        'utf-8',
      ),
    ).resolves.toBe('{"name":"Fixture Catalog"}');
  });

  it('flattens generated dist/public assets into the Worker Static Assets root', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        'public/robots.txt': 'User-agent: *\nAllow: /\n',
        'public/sitemap.xml': '<urlset />',
        'public/site.webmanifest': '{"name":"Fixture Catalog"}',
      },
    });

    await expect(
      fs.readFile(path.join(outputDirectory, 'public/robots.txt'), 'utf-8'),
    ).resolves.toBe('User-agent: *\nAllow: /\n');
    await expect(
      fs.readFile(path.join(outputDirectory, 'public/sitemap.xml'), 'utf-8'),
    ).resolves.toBe('<urlset />');
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'public/site.webmanifest'),
        'utf-8',
      ),
    ).resolves.toBe('{"name":"Fixture Catalog"}');
    await expect(
      fs.access(path.join(outputDirectory, 'public/public/robots.txt')),
    ).rejects.toThrow();
  });

  it('applies public asset exclusions to flattened dist/public assets', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        'public/.env': 'SECRET_TOKEN=public-leak',
        'public/.well-known/security.txt': 'contact: security@example.com',
        'public/private-assets/data.json': '{"private":true}',
        'public/release/envelope.json': '{"internal":true}',
        'public/route.json': '{"routes":[]}',
        'public/static/.env.local': 'SECRET_TOKEN=static-leak',
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
      fs.readFile(
        path.join(publicDirectory, '.well-known/security.txt'),
        'utf-8',
      ),
    ).resolves.toBe('contact: security@example.com');
    await expect(
      fs.access(path.join(publicDirectory, '.env')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'static/.env.local')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'private-assets/data.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'release/envelope.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'route.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'worker/index.mjs')),
    ).rejects.toThrow();
  });

  it('requires a release envelope only when its plugin is explicitly selected', async () => {
    const fullStackMarkers = {
      'backend-mf-manifest.json': '{}',
      'ultramodern-build.json': '{}',
    };

    await expect(
      createFixture({ distFiles: fullStackMarkers }),
    ).resolves.toHaveProperty('outputDirectory');
    await expect(
      createFixture({
        distFiles: fullStackMarkers,
        releaseEnvelopeEnabled: true,
      }),
    ).rejects.toThrow('required envelope is missing');
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

  it('rejects mixed declarative and raw Wrangler D1 config', async () => {
    await expect(
      createFixture({
        d1Databases: [
          {
            binding: 'DB',
            databaseName: 'app',
            databaseId: '11111111-1111-4111-8111-111111111111',
          },
        ],
        wrangler: {
          d1_databases: [],
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.d1Databases.*wrangler\.d1_databases/u);
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

  it('keeps distributed SSR fragment metadata in the worker manifest only', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_INVENTORY_WORKER',
          fragments: [
            {
              boundaryId: 'verticalInventory',
              expose: './Widget',
              path: '/{locale}/_mf/fragment/widget',
              remote: 'inventory',
            },
          ],
          service: 'tractor-inventory-worker',
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
        binding: 'VERTICAL_INVENTORY_WORKER',
        service: 'tractor-inventory-worker',
      },
    ]);
    expect(workerManifest.serviceBindings).toEqual([
      {
        binding: 'VERTICAL_INVENTORY_WORKER',
        fragments: [
          {
            boundaryId: 'verticalInventory',
            expose: './Widget',
            path: '/{locale}/_mf/fragment/widget',
            remote: 'inventory',
          },
        ],
        interface: 'fetch',
        service: 'tractor-inventory-worker',
      },
    ]);
  });

  it('rejects mixed typed and raw wrangler service bindings', async () => {
    await expect(
      createFixture({
        services: [
          {
            binding: 'VERTICAL_CATALOG_WORKER',
            prefix: '/catalog-api',
            service: 'tractor-catalog-worker',
          },
        ],
        wrangler: {
          services: [],
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.services.*wrangler\.services/u);
  });

  it('rejects artifacts staged into framework-owned Cloudflare output paths', async () => {
    const reservedDestinations = [
      'public/config.json',
      'server/config.json',
      'worker/config.js',
      'wrangler.json',
      'package.json',
    ];

    for (const destination of reservedDestinations) {
      await expect(
        createFixture({
          artifacts: [
            {
              from: 'ops/config.json',
              to: destination,
            },
          ],
          sourceFiles: {
            ops: {
              'config.json': '{}',
            },
          },
        }),
      ).rejects.toThrow(/deploy\.worker\.artifacts\[0\]\.to/u);
    }
  });

  it('rejects artifact paths that escape through parent directory segments', async () => {
    await expect(
      createFixture({
        artifacts: [
          {
            from: 'ops/..',
            to: 'config/runtime-policy.json',
          },
        ],
        sourceFiles: {
          ops: {
            'runtime-policy.json': '{}',
          },
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.artifacts\[0\]\.from/u);

    await expect(
      createFixture({
        artifacts: [
          {
            from: 'ops/runtime-policy.json',
            to: 'config/..',
          },
        ],
        sourceFiles: {
          ops: {
            'runtime-policy.json': '{}',
          },
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.artifacts\[0\]\.to/u);
  });

  it('rejects public asset paths escape through parent directory segments', async () => {
    await expect(
      createFixture({
        publicAssets: [
          {
            from: 'ops/..',
            to: 'fixture-owned-data',
          },
        ],
        sourceFiles: {
          ops: {
            'manifest.json': '{}',
          },
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.publicAssets\[0\]\.from/u);

    await expect(
      createFixture({
        publicAssets: [
          {
            from: 'ops/manifest.json',
            to: 'fixture-owned-data/..',
          },
        ],
        sourceFiles: {
          ops: {
            'manifest.json': '{}',
          },
        },
      }),
    ).rejects.toThrow(/deploy\.worker\.publicAssets\[0\]\.to/u);
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
      fs
        .readFile(
          path.join(publicDirectory, 'backend-mf-manifest.json'),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toMatchObject({
      remotes: [
        {
          alias: 'catalog-backend',
          entry: 'backendRemoteEntry.cjs',
        },
      ],
    });
    const backendRemote = await import(
      pathToFileURL(path.join(publicDirectory, 'backendRemoteEntry.cjs')).href
    );
    expect(backendRemote.default).toEqual({ name: 'catalog-backend' });
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
      fs.access(path.join(outputDirectory, 'worker/package.json')),
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

  it('stages backend federation artifacts into Cloudflare public assets', async () => {
    const backendManifest = JSON.stringify({
      name: 'commerce-backend',
      remoteEntry: 'backendRemoteEntry.cjs',
    });
    const backendRemoteEntry = 'module.exports = { get: () => "commerce" };\n';
    const { outputDirectory } = await createFixture({
      distFiles: {
        'backend-mf-manifest.json': backendManifest,
        'backendRemoteEntry.cjs': backendRemoteEntry,
      },
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    await expect(
      fs
        .readFile(
          path.join(publicDirectory, 'backend-mf-manifest.json'),
          'utf-8',
        )
        .then(JSON.parse),
    ).resolves.toEqual(JSON.parse(backendManifest));
    const stagedRemote = await import(
      pathToFileURL(path.join(publicDirectory, 'backendRemoteEntry.cjs')).href
    );
    expect(stagedRemote.default.get()).toBe('commerce');
  });

  it('excludes server-only and configured paths from Cloudflare public assets', async () => {
    const { outputDirectory } = await createFixture({
      includeServerOnlyDistSources: true,
      publicAssetExcludes: ['private-assets', 'static/app.css'],
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    await expect(
      fs.access(path.join(publicDirectory, 'static/app.js')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(publicDirectory, 'static/app.css')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'api/index.ts')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'shared/schema.ts')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, 'private-assets/data.json')),
    ).rejects.toThrow();
  });

  it('does not expose dotenv files through Cloudflare public assets', async () => {
    const { outputDirectory } = await createFixture({
      distFiles: {
        '.env': 'SECRET_TOKEN=public-leak',
        '.env.production': 'SECRET_TOKEN=production-leak',
        'static/.env.local': 'SECRET_TOKEN=static-leak',
        '.well-known/security.txt': 'contact: security@example.com',
      },
    });
    const publicDirectory = path.join(outputDirectory, 'public');

    await expect(
      fs.access(path.join(publicDirectory, '.env')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(publicDirectory, '.env.production')),
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
      dispatcherExport: '__modern_create_effect_bff_dispatcher',
      runtimeFramework: 'effect',
      prefix: '/commerce-api',
      worker: 'worker/__modern_bff_effect.js',
      effect: {
        crossProjectPolicy: {
          allowUnknownOperations: false,
          enabled: false,
          expectedOperationContracts: {},
          requireEnvelope: true,
          requireOperationContext: true,
          requireOperationContextDetails: true,
          requireOperationSchemaHash: true,
          requireOperationVersion: true,
        },
      },
    });
    await expect(
      fs.access(path.join(outputDirectory, 'worker/__modern_bff_effect.js')),
    ).resolves.toBeUndefined();
    await expect(
      fs
        .readFile(path.join(outputDirectory, 'package.json'), 'utf-8')
        .then(JSON.parse),
    ).resolves.toEqual({ type: 'module' });
    await expect(
      fs
        .readFile(path.join(outputDirectory, 'worker/package.json'), 'utf-8')
        .then(JSON.parse),
    ).resolves.toEqual({ type: 'commonjs' });
  });

  it('stamps the delivery-unit identity into the Cloudflare worker manifest', async () => {
    const deliveryUnit = {
      unitId: 'acme/checkout',
      buildMarker: '0123456789abcdef',
      sourceRevision: 'workspace',
    };
    const { outputDirectory } = await createFixture({ deliveryUnit });
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(workerManifest.deliveryUnit).toEqual({
      ...deliveryUnit,
      surfaces: {
        ui: { ...deliveryUnit, surface: 'ui' },
        api: { ...deliveryUnit, surface: 'api' },
      },
    });
  });

  it('fails closed when the bundled build marker drifts from the topology delivery-unit record', async () => {
    await expect(
      createFixture({
        deliveryUnit: {
          unitId: 'acme/checkout',
          buildMarker: '0123456789abcdef',
          sourceRevision: 'workspace',
        },
        buildModuleIdentity: {
          unitId: 'acme/checkout',
          buildMarker: 'deadbeefdeadbeef',
          sourceRevision: 'workspace',
        },
      }),
    ).rejects.toThrow(/delivery-unit-drift/u);
  });

  it('does not use single-app delivery-unit fallback when topology apps omit current app', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-cloudflare-delivery-unit-'),
    );
    tempDirectories.push(workspaceRoot);

    const appDirectory = path.join(workspaceRoot, 'apps/checkout');
    await fs.mkdir(appDirectory, { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, '.modernjs'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, '.modernjs/ultramodern.json'),
      `${JSON.stringify(
        {
          deliveryUnit: {
            unitId: 'acme/root',
            buildMarker: 'root-build',
            sourceRevision: 'root-revision',
          },
          topology: {
            apps: [
              {
                id: 'catalog',
                kind: 'remote',
                path: 'apps/catalog',
                deliveryUnit: {
                  unitId: 'acme/catalog',
                  buildMarker: 'catalog-build',
                  sourceRevision: 'catalog-revision',
                },
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    await expect(resolveTopologyDeliveryUnit(appDirectory)).resolves.toBe(
      undefined,
    );
  });

  it('emits native Cloudflare locale redirects from i18n server plugin options', async () => {
    const i18nServerPlugin = {
      name: '@modern-js/plugin-i18n/server',
      options: {
        localeDetection: {
          fallbackLanguage: 'en',
          ignoreRedirectRoutes: ['/assets'],
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls: {
            '/terms-of-service': {
              cs: '/obchodni-podminky',
              en: '/terms-of-service',
            },
          },
        },
        staticRoutePrefixes: ['/public-assets'],
      },
    };
    const { outputDirectory } = await createFixture({
      includeRootRoute: true,
      serverPlugins: [i18nServerPlugin],
    });
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );

    expect(workerManifest.i18n.entries.main).toMatchObject({
      fallbackLanguage: 'en',
      i18nextDetector: true,
      ignoreRedirectRoutes: ['/assets'],
      languages: ['en', 'cs'],
      staticRoutePrefixes: ['/public-assets'],
    });
    expect(workerManifest.i18n.entries.main.localisedUrls).toEqual({
      '/terms-of-service': {
        cs: '/obchodni-podminky',
        en: '/terms-of-service',
      },
    });

    const worker = (
      await import(
        `${pathToFileURL(path.join(outputDirectory, 'server/index.mjs')).href}?t=${Date.now()}`
      )
    ).default;
    const env = {
      ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
    };

    const rootCs = await worker.fetch(
      new Request('https://example.com/', {
        headers: {
          'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.1',
        },
      }),
      env,
    );
    expect(rootCs.status).toBe(302);
    expect(rootCs.headers.get('location')).toBe('/cs');
    expect(rootCs.headers.get('cache-control')).toBe('private, no-store');
    expect(rootCs.headers.get('vary')).toBe('Accept-Language, Cookie');

    const queryWins = await worker.fetch(
      new Request('https://example.com/?lng=en&utm=tractor', {
        headers: {
          'accept-language': 'cs-CZ,cs;q=0.9',
        },
      }),
      env,
    );
    expect(queryWins.status).toBe(302);
    expect(queryWins.headers.get('location')).toBe('/en?lng=en&utm=tractor');

    const cookieWinsOverHeader = await worker.fetch(
      new Request('https://example.com/', {
        headers: {
          'accept-language': 'cs-CZ,cs;q=0.9',
          cookie: 'i18next=en',
        },
      }),
      env,
    );
    expect(cookieWinsOverHeader.status).toBe(302);
    expect(cookieWinsOverHeader.headers.get('location')).toBe('/en');

    const mountedRoute = await worker.fetch(
      new Request('https://example.com/dashboard/settings', {
        headers: {
          'accept-language': 'cs-CZ,cs;q=0.9',
        },
      }),
      env,
    );
    expect(mountedRoute.status).toBe(302);
    expect(mountedRoute.headers.get('location')).toBe('/dashboard/cs/settings');

    const localisedRoute = await worker.fetch(
      new Request('https://example.com/terms-of-service', {
        headers: {
          'accept-language': 'cs-CZ,cs;q=0.9',
        },
      }),
      env,
    );
    expect(localisedRoute.status).toBe(302);
    expect(localisedRoute.headers.get('location')).toBe(
      '/cs/obchodni-podminky',
    );

    const canonicalisedRoute = await worker.fetch(
      new Request('https://example.com/cs/terms-of-service'),
      env,
    );
    expect(canonicalisedRoute.status).toBe(302);
    expect(canonicalisedRoute.headers.get('location')).toBe(
      '/cs/obchodni-podminky',
    );

    const ignoredRoute = await worker.fetch(
      new Request('https://example.com/assets/logo'),
      env,
    );
    expect(ignoredRoute.status).toBe(200);
    await expect(ignoredRoute.json()).resolves.toMatchObject({
      pathname: '/assets/logo',
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
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(
      response.headers.get('content-security-policy-report-only'),
    ).toBeNull();
    expect(await response.text()).toBe('app();');
  });

  it('does not route non-GET/HEAD asset requests through ASSETS', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const assetRequests: string[] = [];

    for (const method of ['POST', 'PUT']) {
      const response = await worker.fetch(
        new Request('https://example.com/static/app.js', { method }),
        {
          ASSETS: {
            fetch: async (request: Request) => {
              assetRequests.push(
                `${request.method} ${new URL(request.url).pathname}`,
              );
              throw new Error(
                'ASSETS.fetch should not be called for non-GET/HEAD requests',
              );
            },
          },
        },
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
    }
    expect(assetRequests).toEqual([]);
  });

  it('serves HEAD asset requests without a response body', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const assetBinding = createAssetBinding(
      path.join(outputDirectory, 'public'),
    );
    const assetRequests: string[] = [];

    const response = await worker.fetch(
      new Request('https://example.com/static/app.js', { method: 'HEAD' }),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            assetRequests.push(
              `${request.method} ${new URL(request.url).pathname}`,
            );
            return assetBinding.fetch(request);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('');
    expect(assetRequests).toEqual(['HEAD /static/app.js']);
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

  it('treats missing HTML paths as asset misses instead of SSR fallback', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/dashboard/missing.html'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not found');
  });

  it('does not route Cloudflare asset preflight requests through asset binding', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const assetRequests: string[] = [];

    const response = await worker.fetch(
      new Request('https://example.com/mf-manifest.json', {
        headers: {
          origin: 'https://shell.example.com',
          'access-control-request-method': 'GET',
        },
        method: 'OPTIONS',
      }),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            assetRequests.push(
              `${request.method} ${new URL(request.url).pathname}`,
            );
            return new Response('asset preflight should not reach binding');
          },
        },
      },
    );

    expect(assetRequests).toEqual([]);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not read route HTML assets for non-GET/HEAD requests', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');
    const requestedPaths: string[] = [];
    const assetBinding = createAssetBinding(publicDirectory);

    const response = await worker.fetch(
      new Request('https://example.com/plain/details', { method: 'POST' }),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            requestedPaths.push(
              `${request.method} ${new URL(request.url).pathname}`,
            );
            return assetBinding.fetch(request);
          },
        },
      },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(requestedPaths).toEqual([]);
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
    expect(requestedPaths).toEqual(['/html/plain/index.html']);
  });

  it('dispatches SSR document routes before Cloudflare Assets SPA fallback', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const publicDirectory = path.join(outputDirectory, 'public');
    const requestedPaths: string[] = [];
    const assetBinding = createSpaFallbackAssetBinding(publicDirectory);

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
    expect(requestedPaths).toEqual([
      '/html/main/index.html',
      '/routes-manifest.json',
      '/loadable-stats.json',
    ]);
    expect(requestedPaths).not.toContain('/dashboard/settings');
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
      '</static/app.css>; rel=preload; as=style',
    );
    expect(await response.text()).toContain(
      '<link rel="stylesheet" href="/static/app.css">',
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

  it('percent-encodes same-origin Link header targets', async () => {
    const asset = '/assets/styles/a > b.css';
    const { outputDirectory } = await createFixture({
      distFiles: {
        'loadable-stats.json': JSON.stringify({ publicPath: 'auto' }),
        'routes-manifest.json': JSON.stringify({
          routeAssets: {
            main: {
              referenceCssAssets: [asset],
            },
          },
        }),
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

    expect(response.headers.get('link')).toContain(
      '</assets/styles/a%20%3E%20b.css>; rel=preload; as=style',
    );
  });

  it('preserves Cloudflare SSR HTML responses when no CSS links are discovered', async () => {
    const html =
      '<!doctype html><html><head><title>unstyled</title></head><body>SSR content</body></html>';
    const { outputDirectory } = await createFixture({
      distFiles: {
        'routes-manifest.json': JSON.stringify({ routeAssets: {} }),
        'worker/html.js': `module.exports = { requestHandler: async () => new Response(${JSON.stringify(
          html,
        )}, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };`,
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

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(html);
  });

  it('deduplicates stylesheet links emitted by multiple distributed fragments', async () => {
    const href = 'https://explore.example.com/static/css/explore.css';
    const html = `<!doctype html><html><head></head><body><link href="${href}" rel="stylesheet" type="text/css"><section>Header</section><link rel="stylesheet" href="${href}"><section>Home</section></body></html>`;
    const { outputDirectory } = await createFixture({
      distFiles: {
        'routes-manifest.json': JSON.stringify({ routeAssets: {} }),
        'worker/html.js': `module.exports = { requestHandler: async () => new Response(${JSON.stringify(
          html,
        )}, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };`,
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
    const rendered = await response.text();

    expect(rendered.split(href)).toHaveLength(2);
    expect(rendered).toContain(
      `<link href="${href}" rel="stylesheet" type="text/css">`,
    );
    expect(rendered).not.toContain('data-rspack=');
    expect(rendered).toContain('<section>Header</section>');
    expect(rendered).toContain('<section>Home</section>');
  });

  it('does not collapse federated stylesheets under distinct same-origin mounts', async () => {
    const firstHref = 'https://example.com/one/static/css/shared.css';
    const secondHref = 'https://example.com/two/static/css/shared.css';
    const html = `<!doctype html><html><head><link href="${firstHref}" rel="stylesheet"><link href="${secondHref}" rel="stylesheet"></head><body>SSR content</body></html>`;
    const { outputDirectory } = await createFixture({
      distFiles: {
        'routes-manifest.json': JSON.stringify({ routeAssets: {} }),
        'worker/html.js': `module.exports = { requestHandler: async () => new Response(${JSON.stringify(
          html,
        )}, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };`,
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
    const rendered = await response.text();

    expect(rendered).toContain(`<link href="${firstHref}" rel="stylesheet">`);
    expect(rendered).toContain(`<link href="${secondHref}" rel="stylesheet">`);
    expect(rendered).not.toContain('data-rspack=');
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
      expect(linkHeader).toContain('</static/app.css>; rel=preload; as=style');
      expect(linkHeader).toContain(
        '<https://explore.example.com/static/css/explore.css>; rel=preload; as=style',
      );
      expect(linkHeader).toContain(
        '<https://checkout.example.com/static/css/checkout.css>; rel=preload; as=style',
      );
      expect(html).toContain('<link rel="stylesheet" href="/static/app.css">');
      expect(html).not.toContain(
        '<link rel="stylesheet" href="https://example.com/static/app.css">',
      );
      expect(html).toContain(
        '<link href="https://explore.example.com/static/css/explore.css" rel="stylesheet" type="text/css" data-precedence="default">',
      );
      expect(html).toContain(
        '<link href="https://checkout.example.com/static/css/checkout.css" rel="stylesheet" type="text/css" data-precedence="default">',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('resolves relative and automatic remote publicPath values against the remote manifest URL', async () => {
    const { outputDirectory } = await createFixture();
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const originalFetch = globalThis.fetch;
    const remoteManifests: Record<string, unknown> = {
      'https://checkout.example.com/mf-manifest.json': {
        metaData: {
          publicPath: '/',
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
            referenceCssAssets: ['static/css/checkout.css'],
          },
        },
      },
      'https://explore.example.com/mf-manifest.json': {
        metaData: {
          publicPath: 'auto/',
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
      expect(linkHeader).toContain(
        '<https://explore.example.com/static/css/explore.css>; rel=preload; as=style',
      );
      expect(linkHeader).toContain(
        '<https://checkout.example.com/static/css/checkout.css>; rel=preload; as=style',
      );
      expect(html).toContain(
        '<link href="https://explore.example.com/static/css/explore.css" rel="stylesheet" type="text/css" data-precedence="default">',
      );
      expect(html).toContain(
        '<link href="https://checkout.example.com/static/css/checkout.css" rel="stylesheet" type="text/css" data-precedence="default">',
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
        '<link href="https://explore.example.com/static/css/explore.css" rel="stylesheet" type="text/css" data-precedence="default">',
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
        '<link href="https://explore.example.com/static/css/explore.css" rel="stylesheet" type="text/css" data-precedence="default">',
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

  it('dispatches configured service binding prefixes before SSR route fallback', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_CATALOG_WORKER',
          prefix: '/catalog-api',
          service: 'tractor-catalog-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const calls: string[] = [];

    const response = await worker.fetch(
      new Request('https://example.com/catalog-api/catalog/readiness'),
      {
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
        VERTICAL_CATALOG_WORKER: {
          fetch: async (request: Request) => {
            calls.push(request.url);

            return Response.json({
              pathname: new URL(request.url).pathname,
              source: 'catalog-worker',
            });
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'https://example.com/catalog-api/catalog/readiness',
    ]);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      pathname: '/catalog-api/catalog/readiness',
      source: 'catalog-worker',
    });
  });

  it('describes expose-specific CSS on distributed SSR fragment responses', async () => {
    const renderedFragment =
      '<section data-sku="CL-08-GR">Inventory SSR</section><output>7750</output>';
    const { outputDirectory } = await createFixture({
      deliveryUnit: {
        buildMarker: 'inventory-build-b',
        sourceRevision: 'inventory-revision-b',
        unitId: 'tractor-store/inventory',
      },
      distFiles: {
        'mf-manifest.json': JSON.stringify({
          name: 'verticalInventory',
          exposes: [
            {
              assets: {
                css: {
                  async: ['static/css/inventory.css'],
                  sync: [],
                },
              },
              path: './Widget',
            },
          ],
        }),
        'worker/main.js': `module.exports = { requestHandler: async (_request, options) => {
          const fragment = options.locals.__modernDistributedSsrFragmentRequest;
          return new Response('<!doctype html><html><head></head><body><template data-modern-boundary-id="verticalInventory" data-modern-distributed-ssr-marker="start" data-modern-mf-expose="./Widget"></template><section data-sku="' + fragment.props.sku + '">Inventory SSR</section><output>' + fragment.props.price + '</output><template data-modern-boundary-id="verticalInventory" data-modern-distributed-ssr-marker="end" data-modern-mf-expose="./Widget"></template></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
        } };`,
      },
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    expect(workerManifest.moduleFederation).toEqual({
      exposes: [
        {
          css: ['static/css/inventory.css'],
          path: './Widget',
        },
      ],
      name: 'verticalInventory',
    });

    const response = await worker.fetch(
      new Request('https://inventory.example.com/dashboard', {
        headers: {
          'x-modern-distributed-ssr-boundary-id': 'verticalInventory',
          'x-modern-distributed-ssr-expose': './Widget',
          'x-modern-distributed-ssr-props': encodeURIComponent(
            JSON.stringify({ price: 7750, sku: 'CL-08-GR' }),
          ),
          'x-modern-distributed-ssr-remote': 'inventory',
          'x-modern-distributed-ssr-source-url':
            'https://tractor.example.com/en/tractors/holland-hamster',
          'x-modern-js-fragment-request': '1',
        },
      }),
      {
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
      },
    );

    expect(response.headers.get('x-modern-distributed-ssr-css')).toBe(
      JSON.stringify(['static/css/inventory.css']),
    );
    const provenance = JSON.parse(
      decodeURIComponent(
        response.headers.get('x-modern-distributed-ssr-provenance') ?? '',
      ),
    );
    const expectedDigest = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(renderedFragment),
        ),
      ),
    ]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(provenance).toEqual({
      boundaryId: 'verticalInventory',
      buildMarker: 'inventory-build-b',
      digest: expectedDigest,
      expose: './Widget',
      remote: 'inventory',
      sourceRevision: 'inventory-revision-b',
      unitId: 'tractor-store/inventory',
    });
  });

  it('resolves prop-bearing multi-root fragments lazily with verified delivery provenance', async () => {
    const renderedFragment =
      '<button data-sku="CL-08-GR">Add Holland Hamster</button><output>7750</output>';
    const digestBytes = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(renderedFragment),
      ),
    );
    const digest = [...digestBytes]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    const provenance = {
      boundaryId: 'verticalCheckout',
      buildMarker: 'checkout-build-b',
      digest,
      expose: './AddToCart',
      remote: 'checkout',
      sourceRevision: 'checkout-revision-b',
      unitId: 'tractor-store/checkout',
    };
    const { outputDirectory } = await createFixture({
      distFiles: {
        'mf-manifest.json': JSON.stringify({
          remotes: [
            {
              alias: 'checkout',
              entry: 'https://checkout.example.com/mf-manifest.json',
              federationContainerName: 'verticalCheckout',
            },
          ],
        }),
        'worker/main.js': `module.exports = { requestHandler: async (_request, options) => {
          const fragment = await options.locals.__modernDistributedSsrFragments.resolve(
            'checkout',
            './AddToCart',
            { price: 7750, sku: 'CL-08-GR', variant: undefined },
          );
          return Response.json(fragment);
        } };`,
      },
      services: [
        {
          binding: 'VERTICAL_CHECKOUT_WORKER',
          fragments: [
            {
              boundaryId: 'verticalCheckout',
              expose: './AddToCart',
              path: '/{locale}/_mf/fragment/add-to-cart',
              remote: 'checkout',
            },
          ],
          service: 'tractor-checkout-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const calls: Array<{
      expose: string | null;
      method: string;
      props: unknown;
      remote: string | null;
      sourceUrl: string | null;
      url: string;
    }> = [];

    const response = await worker.fetch(
      new Request('https://tractor.example.com/dashboard?sku=CL-08-GR'),
      {
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
        VERTICAL_CHECKOUT_WORKER: {
          fetch: async (request: Request) => {
            calls.push({
              expose: request.headers.get('x-modern-distributed-ssr-expose'),
              method: request.method,
              props: JSON.parse(
                decodeURIComponent(
                  request.headers.get('x-modern-distributed-ssr-props') ?? '',
                ),
              ),
              remote: request.headers.get('x-modern-distributed-ssr-remote'),
              sourceUrl: request.headers.get(
                'x-modern-distributed-ssr-source-url',
              ),
              url: request.url,
            });
            return new Response(
              `<!doctype html><html><head></head><body><template data-modern-boundary-id="verticalCheckout" data-modern-distributed-ssr-marker="start" data-modern-mf-expose="./AddToCart"></template>${renderedFragment}<template data-modern-boundary-id="verticalCheckout" data-modern-distributed-ssr-marker="end" data-modern-mf-expose="./AddToCart"></template></body></html>`,
              {
                headers: {
                  'content-type': 'text/html; charset=utf-8',
                  'x-modern-distributed-ssr-css': JSON.stringify([
                    'static/css/add-to-cart.css',
                  ]),
                  'x-modern-distributed-ssr-provenance': encodeURIComponent(
                    JSON.stringify(provenance),
                  ),
                },
              },
            );
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        expose: './AddToCart',
        method: 'GET',
        props: { price: 7750, sku: 'CL-08-GR' },
        remote: 'checkout',
        sourceUrl: 'https://tractor.example.com/dashboard?sku=CL-08-GR',
        url: 'https://tractor.example.com/dashboard/_mf/fragment/add-to-cart',
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      boundaryId: 'verticalCheckout',
      buildMarker: 'checkout-build-b',
      digest,
      expose: './AddToCart',
      html: `<!--$-->${renderedFragment}<!--/$-->`,
      provenance,
      remote: 'checkout',
      status: 'ready',
    });
  });

  it('preloads service-composed fragment CSS without duplication or remote network fetches', async () => {
    const renderedFragment =
      '<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget"><link href="/static/css/inventory.css" rel="stylesheet"><link href="https://inventory.example.com/static/css/inventory.css" rel="stylesheet" type="text/css"><div>Inventory SSR</div></section>';
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(renderedFragment),
        ),
      ),
    ]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    const provenance = {
      boundaryId: 'verticalInventory',
      buildMarker: 'inventory-build',
      digest,
      expose: './Widget',
      remote: 'inventory',
      sourceRevision: 'inventory-revision',
      unitId: 'tractor-store/inventory',
    };
    const { outputDirectory } = await createFixture({
      distFiles: {
        'mf-manifest.json': JSON.stringify({
          remotes: [
            {
              alias: 'inventory',
              entry: 'https://inventory.example.com/mf-manifest.json',
              federationContainerName: 'verticalInventory',
            },
          ],
        }),
        'routes-manifest.json': JSON.stringify({
          routeAssets: {
            main: {
              referenceCssAssets: ['static/css/shell.css'],
            },
          },
        }),
        'worker/main.js': `module.exports = { requestHandler: async (_request, options) => {
          const fragment = await options.locals.__modernDistributedSsrFragments.resolve(
            'inventory',
            './Widget',
            {},
          );
          return new Response('<!doctype html><html><head><link rel="stylesheet" href="/static/css/shell.css"><meta data-modern-cloudflare-stylesheet-links></head><body>' + fragment.html + '</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
        } };`,
      },
      services: [
        {
          binding: 'VERTICAL_INVENTORY_WORKER',
          fragments: [
            {
              boundaryId: 'verticalInventory',
              expose: './Widget',
              path: '/en/_mf/fragment/widget',
              remote: 'inventory',
            },
          ],
          service: 'tractor-inventory-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const outboundRequests: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      outboundRequests.push(
        input instanceof Request ? input.url : String(input),
      );
      return new Response('network disabled', { status: 502 });
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request('https://example.com/dashboard'),
        {
          ASSETS: createSpaFallbackAssetBinding(
            path.join(outputDirectory, 'public'),
          ),
          VERTICAL_INVENTORY_WORKER: {
            fetch: async () =>
              new Response(
                `<!doctype html><html><head><link href="/static/css/route.css" rel="stylesheet"><link href="/static/css/inventory.css" rel="stylesheet"></head><body>${renderedFragment}</body></html>`,
                {
                  headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'x-modern-distributed-ssr-css': JSON.stringify([
                      'static/css/inventory.css',
                    ]),
                    'x-modern-distributed-ssr-provenance': encodeURIComponent(
                      JSON.stringify(provenance),
                    ),
                  },
                },
              ),
          },
        },
      );
      const html = await response.text();

      expect(outboundRequests).toEqual([]);
      expect(response.headers.get('link')).toContain(
        '</static/css/shell.css>; rel=preload; as=style',
      );
      expect(response.headers.get('link')).toContain(
        '<https://inventory.example.com/static/css/inventory.css>; rel=preload; as=style',
      );
      expect(html.split('/static/css/shell.css')).toHaveLength(2);
      expect(html).not.toContain('href="/static/css/inventory.css"');
      expect(html).toContain(
        '<link href="https://inventory.example.com/static/css/inventory.css" rel="stylesheet" type="text/css" data-precedence="default">',
      );
      expect(html).toContain(
        '<!--$--><section data-modern-boundary-id="verticalInventory"',
      );
      expect(
        html.split('https://inventory.example.com/static/css/inventory.css'),
      ).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retains late distributed fragment CSS in route order without draining the HTML stream', async () => {
    const inventoryFragment =
      '<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget">Inventory SSR</section>';
    const checkoutFragment =
      '<section data-modern-boundary-id="verticalCheckout" data-modern-mf-expose="./Cart">Checkout SSR</section>';
    const [inventoryDigest, checkoutDigest] = await Promise.all(
      [inventoryFragment, checkoutFragment].map(async html =>
        [
          ...new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(html),
            ),
          ),
        ]
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join(''),
      ),
    );
    const { outputDirectory } = await createFixture({
      distFiles: {
        'mf-manifest.json': JSON.stringify({
          remotes: [
            {
              alias: 'inventory',
              entry: 'https://inventory.example.com/mf-manifest.json',
              federationContainerName: 'verticalInventory',
            },
            {
              alias: 'checkout',
              entry: 'https://checkout.example.com/mf-manifest.json',
              federationContainerName: 'verticalCheckout',
            },
          ],
        }),
        'html/main/index.html':
          '<!doctype html><html><head></HeAd><body></body></html>',
        'worker/main.js': `module.exports = { requestHandler: async (_request, options) => {
          if (!options.resource.htmlTemplate.includes('<meta data-modern-cloudflare-stylesheet-links>')) {
            return new Response('missing Cloudflare stylesheet sentinel', { status: 500 });
          }
          const inventoryPromise = options.locals.__modernDistributedSsrFragments.resolve('inventory', './Widget', {});
          const checkoutPromise = options.locals.__modernDistributedSsrFragments.resolve('checkout', './Cart', {});
          const encoder = new TextEncoder();
          return new Response(new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode('<!doctype html><html><head><title>Distributed</title><link href="/theme.css" rel="stylesheet" media="print"><link href="/theme.css" rel="stylesheet" media="screen"><meta data-modern-cloudflare-style'));
              const [inventory, checkout] = await Promise.all([inventoryPromise, checkoutPromise]);
              await fetch('https://stream-gate.invalid/release');
              controller.enqueue(encoder.encode('sheet-links></head><body>' + inventory.html + checkout.html + '</body></html>'));
              controller.close();
            },
          }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
        } };`,
      },
      services: [
        {
          binding: 'VERTICAL_INVENTORY_WORKER',
          fragments: [
            {
              boundaryId: 'verticalInventory',
              expose: './Widget',
              path: '/en/_mf/fragment/widget',
              remote: 'inventory',
            },
          ],
          service: 'tractor-inventory-worker',
        },
        {
          binding: 'VERTICAL_CHECKOUT_WORKER',
          fragments: [
            {
              boundaryId: 'verticalCheckout',
              expose: './Cart',
              path: '/en/_mf/fragment/cart',
              remote: 'checkout',
            },
          ],
          service: 'tractor-checkout-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const createFragmentResponse = (
      html: string,
      provenance: Record<string, string>,
      css: string,
    ) =>
      new Response(
        `<!doctype html><html><head></head><body><template data-modern-boundary-id="${provenance.boundaryId}" data-modern-distributed-ssr-marker="start" data-modern-mf-expose="${provenance.expose}"></template>${html}<template data-modern-boundary-id="${provenance.boundaryId}" data-modern-distributed-ssr-marker="end" data-modern-mf-expose="${provenance.expose}"></template></body></html>`,
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-modern-distributed-ssr-css': JSON.stringify([css]),
            'x-modern-distributed-ssr-provenance': encodeURIComponent(
              JSON.stringify(provenance),
            ),
          },
        },
      );
    let releaseBody!: () => void;
    let reportBodyBlocked!: () => void;
    const bodyRelease = new Promise<void>(resolve => {
      releaseBody = resolve;
    });
    const bodyBlocked = new Promise<void>(resolve => {
      reportBodyBlocked = resolve;
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async input => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === 'https://stream-gate.invalid/release') {
        reportBodyBlocked();
        await bodyRelease;

        return new Response('released');
      }

      return Response.json({});
    };

    try {
      let responseSettled = false;
      const fetchPromise = worker.fetch(
        new Request('https://tractor.example.com/dashboard'),
        {
          ASSETS: createSpaFallbackAssetBinding(
            path.join(outputDirectory, 'public'),
          ),
          VERTICAL_CHECKOUT_WORKER: {
            fetch: async () =>
              createFragmentResponse(
                checkoutFragment,
                {
                  boundaryId: 'verticalCheckout',
                  buildMarker: 'checkout-build',
                  digest: checkoutDigest,
                  expose: './Cart',
                  remote: 'checkout',
                  sourceRevision: 'checkout-revision',
                  unitId: 'tractor-store/checkout',
                },
                'static/css/checkout.css',
              ),
          },
          VERTICAL_INVENTORY_WORKER: {
            fetch: async () => {
              await new Promise(resolve => setTimeout(resolve, 25));

              return createFragmentResponse(
                inventoryFragment,
                {
                  boundaryId: 'verticalInventory',
                  buildMarker: 'inventory-build',
                  digest: inventoryDigest,
                  expose: './Widget',
                  remote: 'inventory',
                  sourceRevision: 'inventory-revision',
                  unitId: 'tractor-store/inventory',
                },
                'static/css/inventory.css',
              );
            },
          },
        },
      );
      void fetchPromise.then(() => {
        responseSettled = true;
      });

      await bodyBlocked;
      await new Promise(resolve => setTimeout(resolve, 0));
      const returnedBeforeBodyRelease = responseSettled;

      releaseBody();

      const response = await fetchPromise;
      const html = await response.text();
      const inventoryHref =
        'https://inventory.example.com/static/css/inventory.css';
      const checkoutHref =
        'https://checkout.example.com/static/css/checkout.css';
      const linkHeader = response.headers.get('link') ?? '';

      expect(html).toContain(inventoryHref);
      expect(html).toContain(checkoutHref);
      expect(html.indexOf(inventoryHref)).toBeLessThan(
        html.indexOf(checkoutHref),
      );
      expect(linkHeader).toContain(inventoryHref);
      expect(linkHeader).toContain(checkoutHref);
      expect(linkHeader.indexOf(inventoryHref)).toBeLessThan(
        linkHeader.indexOf(checkoutHref),
      );
      expect(html).toContain(
        '<link href="/theme.css" rel="stylesheet" media="print">',
      );
      expect(html).toContain(
        '<link href="/theme.css" rel="stylesheet" media="screen">',
      );
      expect(html).not.toContain(
        '<meta data-modern-cloudflare-stylesheet-links>',
      );
      expect(returnedBeforeBodyRelease).toBe(true);
    } finally {
      releaseBody();
      globalThis.fetch = originalFetch;
    }
  });

  it('fails clearly when configured service binding is unavailable', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_CATALOG_WORKER',
          prefix: '/catalog-api',
          service: 'tractor-catalog-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/catalog-api/catalog/readiness'),
      {
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
      },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('x-modern-js-service-binding')).toBe(
      'VERTICAL_CATALOG_WORKER',
    );
    await expect(response.text()).resolves.toContain(
      'Cloudflare service binding not available: VERTICAL_CATALOG_WORKER',
    );
  });

  it('emits the typed microvertical degraded event when a service binding is unavailable', async () => {
    const { outputDirectory } = await createFixture({
      services: [
        {
          binding: 'VERTICAL_CATALOG_WORKER',
          prefix: '/catalog-api',
          service: 'tractor-catalog-worker',
        },
      ],
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const errorLogs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(' '));
    };

    let response: Response;
    try {
      response = await worker.fetch(
        new Request('https://example.com/catalog-api/catalog/readiness'),
        {
          ASSETS: createSpaFallbackAssetBinding(
            path.join(outputDirectory, 'public'),
          ),
        },
      );
    } finally {
      console.error = originalConsoleError;
    }

    // HTTP failure response stays correct.
    expect(response.status).toBe(502);
    expect(response.headers.get('x-modern-js-service-binding')).toBe(
      'VERTICAL_CATALOG_WORKER',
    );
    // Typed degraded markers on the response.
    expect(response.headers.get('x-modern-js-degraded')).toBe(
      'remote-unavailable',
    );
    expect(response.headers.get('x-modern-js-telemetry-event')).toBe(
      'modernjs:microvertical-server-fallback',
    );

    // Structured telemetry event with the framework's degraded shape.
    const eventLog = errorLogs.find(entry =>
      entry.includes('modernjs:microvertical-server-fallback'),
    );
    expect(eventLog).toBeDefined();
    expect(JSON.parse(eventLog as string)).toMatchObject({
      eventName: 'modernjs:microvertical-server-fallback',
      phase: 'discovery',
      reason: 'remote-unavailable',
      schemaVersion: 1,
      metadata: {
        classification: 'remote-unavailable',
        pathname: '/catalog-api/catalog/readiness',
        platform: 'cloudflare-service-binding',
        prefix: '/catalog-api',
        remote: 'VERTICAL_CATALOG_WORKER',
        serviceBinding: 'VERTICAL_CATALOG_WORKER',
        status: 'degraded',
      },
    });
  });

  it('dispatches Effect BFF worker modules before SSR route fallback', async () => {
    const { outputDirectory } = await createFixture({ bffPrefix: '/api' });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/api/effect/recommendations'),
      {
        TEST_VALUE: 'edge-env',
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
      },
    );

    expect(response.status).toBe(200);
    // BFF responses are same-origin by default: no wildcard CORS leak.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      pathname: '/effect/recommendations',
      originalPath: '/api/effect/recommendations',
      method: 'GET',
      envValue: 'edge-env',
    });

    const fallbackResponse = await worker.fetch(
      new Request('https://example.com/dashboard/settings'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(fallbackResponse.status).toBe(200);
    await expect(fallbackResponse.json()).resolves.toEqual({
      pathname: '/dashboard/settings',
      entryName: 'main',
      htmlTemplate: '<!doctype html><html>main</html>',
      routeAssetKeys: ['main'],
      loadableName: 'loadable-fixture',
    });
  });

  it('carries normalized Effect policy, OpenAPI, and data-platform config from manifest to dispatcher', async () => {
    const openapi = { path: '/schema/openapi.json' };
    const dataPlatform = {
      enabled: true,
      expectedNamespace: 'catalog',
      requireEnvelope: true,
      batch: { enabled: false },
    };
    const expectedOperationContracts = {
      'GET:/products': {
        operationVersion: 4,
        schemaHash: 'catalog-products-v4',
      },
    };
    const { outputDirectory } = await createFixture({
      bffCrossProjectPolicy: { expectedOperationContracts },
      bffEffect: { dataPlatform, openapi },
      bffIsCrossProjectServer: true,
      bffRequestId: 'catalog.producer',
      bffWorkerSource: configurationAwareEffectBffWorkerSource,
      bffPrefix: '/api',
    });
    const workerManifest = JSON.parse(
      await fs.readFile(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        'utf-8',
      ),
    );
    const normalizedPolicy = {
      allowUnknownOperations: false,
      enabled: true,
      expectedOperationContracts,
      requireEnvelope: true,
      requireOperationContext: true,
      requireOperationContextDetails: true,
      requireOperationSchemaHash: true,
      requireOperationVersion: true,
    };

    expect(workerManifest.bff.effect).toEqual({
      crossProjectPolicy: normalizedPolicy,
      dataPlatform,
      openapi,
    });

    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const response = await worker.fetch(
      new Request('https://example.com/api/products'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      crossProjectPolicy: normalizedPolicy,
      dataPlatform,
      openapi,
      prefix: '/api',
    });
  });

  it('fails closed before dispatcher creation when normalized Effect policy is malformed', async () => {
    const { outputDirectory } = await createFixture({
      bffCrossProjectPolicy: {
        enabled: 'true',
        expectedOperationContracts: {},
      },
      bffWorkerSource: configurationAwareEffectBffWorkerSource,
      bffPrefix: '/api',
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/api/products'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      'cross-project policy requires boolean enabled',
    );
  });

  it('fails closed when a staged manifest attempts to downgrade the Effect runtime', async () => {
    const { outputDirectory } = await createFixture({ bffPrefix: '/api' });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const entrySource = await fs.readFile(entryPath, 'utf-8');
    await fs.writeFile(
      entryPath,
      entrySource.replace(
        '"runtimeFramework": "effect"',
        '"runtimeFramework": "hono"',
      ),
    );
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/api/products'),
      {
        ASSETS: createAssetBinding(path.join(outputDirectory, 'public')),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      'manifest must declare runtimeFramework "effect"',
    );
  });

  it('disposes invalid Effect dispatchers, retries initialization, and caches recovery', async () => {
    const { outputDirectory } = await createFixture({
      bffPrefix: '/api',
      bffWorkerSource: recoveringEffectBffWorkerSource,
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;
    const env = {
      ASSETS: createSpaFallbackAssetBinding(
        path.join(outputDirectory, 'public'),
      ),
    };
    const request = new Request('https://example.com/api/effect/lifecycle');

    const invalidResponse = await worker.fetch(request, env);
    expect(invalidResponse.status).toBe(500);
    await expect(invalidResponse.text()).resolves.toContain(
      'did not return a dispatcher with a dispatch function',
    );

    const recoveredResponse = await worker.fetch(request, env);
    expect(recoveredResponse.status).toBe(200);
    await expect(recoveredResponse.json()).resolves.toEqual({
      createCount: 2,
      disposeCount: 1,
    });

    const cachedResponse = await worker.fetch(request, env);
    expect(cachedResponse.status).toBe(200);
    await expect(cachedResponse.json()).resolves.toEqual({
      createCount: 2,
      disposeCount: 1,
    });
  });

  it('dispatches Effect HttpApi modules without a second handler argument', async () => {
    const { outputDirectory } = await createFixture({
      bffWorkerSource: effectHttpApiWorkerSource,
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/http-api'),
      {
        TEST_VALUE: 'http-api-env',
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pathname: '/effect/http-api',
      routePath: '/effect/http-api',
      originalPath: '/commerce-api/effect/http-api',
      envValue: 'http-api-env',
    });
  });

  it('executes generated Effect BFF workers with Drizzle sqlite-core entityKind class markers without post-build mutation', async () => {
    const { outputDirectory } = await createFixture({
      bffWorkerSource: effectDrizzleWorkerSource,
    });
    const entryPath = path.join(outputDirectory, 'server/index.mjs');
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    const response = await worker.fetch(
      new Request('https://example.com/commerce-api/effect/drizzle'),
      {
        TEST_VALUE: 'drizzle-env',
        ASSETS: createSpaFallbackAssetBinding(
          path.join(outputDirectory, 'public'),
        ),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pathname: '/effect/drizzle',
      originalPath: '/commerce-api/effect/drizzle',
      envValue: 'drizzle-env',
      tableName: 'catalog_addresses',
      entityKind: 'SQLiteTable',
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
