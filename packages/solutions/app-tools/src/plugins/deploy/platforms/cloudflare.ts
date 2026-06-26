import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import type { CloudflareWorkerSecurityConfig } from '../../../types/config/deploy';
import { readTemplate } from '../utils';
import type { CreatePreset } from './platform';

const WORKER_ENTRY = 'server/index.mjs';
const WORKER_MANIFEST = 'server/modern-worker-manifest.json';
const ASSETS_BINDING = 'ASSETS';
const ROUTE_SPEC_FILE = 'route.json';
const ROUTE_SPEC_OUTPUT = `server/${ROUTE_SPEC_FILE}`;
const LOADABLE_STATS_FILE = 'loadable-stats.json';
const ROUTE_MANIFEST_FILE = 'routes-manifest.json';
const PUBLIC_ASSETS_DIRECTORY = 'public';
const WORKER_BUNDLE_DIRECTORY = 'worker';
const SERVER_BUNDLE_DIRECTORY = 'bundles';
const BFF_EFFECT_WORKER_ENTRY = `${WORKER_BUNDLE_DIRECTORY}/__modern_bff_effect.js`;
const DEFAULT_COMPATIBILITY_DATE = '2026-06-02';
const COMPATIBILITY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DEFAULT_SECURITY_HEADERS = {
  referrerPolicy: 'strict-origin-when-cross-origin',
  contentTypeOptions: 'nosniff',
  permissionsPolicy:
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
} as const;
const DEFAULT_CORS_ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  'base-uri': [`'self'`],
  'connect-src': [`'self'`, 'https:', 'http:', 'wss:', 'ws:'],
  'default-src': [`'self'`],
  'font-src': [`'self'`, 'data:', 'https:', 'http:'],
  'form-action': [`'self'`],
  'frame-ancestors': [`'self'`],
  'img-src': [`'self'`, 'data:', 'blob:', 'https:', 'http:'],
  'manifest-src': [`'self'`, 'https:', 'http:'],
  'object-src': [`'none'`],
  'script-src': [
    `'self'`,
    `'unsafe-inline'`,
    `'unsafe-eval'`,
    'https:',
    'http:',
    'blob:',
  ],
  'style-src': [`'self'`, `'unsafe-inline'`, 'https:', 'http:'],
  'worker-src': [`'self'`, 'blob:'],
};

const getCompatibilityDate = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const configuredDate = modernConfig.deploy?.worker?.compatibilityDate?.trim();
  const compatibilityDate = configuredDate || DEFAULT_COMPATIBILITY_DATE;

  if (!COMPATIBILITY_DATE_PATTERN.test(compatibilityDate)) {
    throw new Error(
      `deploy.worker.compatibilityDate must use YYYY-MM-DD, received ${JSON.stringify(
        compatibilityDate,
      )}.`,
    );
  }

  return compatibilityDate;
};

const getWorkerName = (appDirectory: string) => {
  const basename = path.basename(appDirectory);
  return basename.replace(/[^a-zA-Z0-9-_]/g, '-') || 'modern-cloudflare-worker';
};

const getConfiguredWorkerName = (
  appDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const configuredName = modernConfig.deploy?.worker?.name?.trim();
  return configuredName || getWorkerName(appDirectory);
};

const normalizeDirectiveValues = (value: string[] | string) => {
  const values = Array.isArray(value) ? value : [value];

  return [...new Set(values.map(entry => entry.trim()).filter(Boolean))];
};

const appendDirectiveValues = (
  directives: Record<string, string[]>,
  name: string,
  values: string[] | undefined,
) => {
  if (!values?.length) {
    return;
  }

  directives[name] = normalizeDirectiveValues([
    ...(directives[name] ?? []),
    ...values,
  ]);
};

const createContentSecurityPolicy = (
  config?: CloudflareWorkerSecurityConfig['contentSecurityPolicy'],
) => {
  const mode = config?.mode ?? 'report-only';

  if (mode === 'off') {
    return {
      mode,
      directives: {},
      reason: config?.reason,
    };
  }

  const directives = Object.fromEntries(
    Object.entries(DEFAULT_CSP_DIRECTIVES).map(([name, values]) => [
      name,
      [...values],
    ]),
  );

  for (const [name, value] of Object.entries(config?.directives ?? {})) {
    if (value === false) {
      delete directives[name];
    } else {
      directives[name] = normalizeDirectiveValues(value);
    }
  }

  if (config?.frameAncestors === false) {
    delete directives['frame-ancestors'];
  } else if (config?.frameAncestors) {
    directives['frame-ancestors'] = normalizeDirectiveValues(
      config.frameAncestors,
    );
  }

  appendDirectiveValues(directives, 'script-src', config?.additionalScriptSrc);
  appendDirectiveValues(directives, 'style-src', config?.additionalStyleSrc);
  appendDirectiveValues(
    directives,
    'connect-src',
    config?.additionalConnectSrc,
  );
  appendDirectiveValues(directives, 'img-src', config?.additionalImgSrc);

  if (config?.reportUri) {
    directives['report-uri'] = [config.reportUri];
  }

  return {
    mode,
    directives,
    reason: config?.reason,
  };
};

const createNoindexPolicy = (
  noindex: CloudflareWorkerSecurityConfig['noindex'],
) => {
  if (noindex === false) {
    return {
      workersDev: false,
      localhost: false,
      previewHostnames: [],
    };
  }

  if (noindex === true || noindex === undefined) {
    return {
      workersDev: true,
      localhost: true,
      previewHostnames: [],
    };
  }

  return {
    workersDev: noindex.workersDev ?? true,
    localhost: noindex.localhost ?? true,
    previewHostnames: noindex.previewHostnames ?? [],
    reason: noindex.reason,
  };
};

const createCloudflareWorkerCorsPolicy = (
  cors: CloudflareWorkerSecurityConfig['cors'],
) => ({
  assets: cors?.assets ?? true,
  allowedOrigins: normalizeDirectiveValues(cors?.allowedOrigins ?? []),
  allowedMethods: cors?.allowedMethods?.length
    ? normalizeDirectiveValues(
        cors.allowedMethods.map(method => method.toUpperCase()),
      )
    : DEFAULT_CORS_ALLOWED_METHODS,
  allowedHeaders: cors?.allowedHeaders?.length
    ? normalizeDirectiveValues(cors.allowedHeaders)
    : ['*'],
  reason: cors?.reason,
});

const createCloudflareWorkerSecurityPolicy = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const security = modernConfig.deploy?.worker?.security;

  if (security?.enabled === false) {
    return {
      enabled: false,
      cors: createCloudflareWorkerCorsPolicy(security.cors),
      reason: security.reason,
    };
  }

  return {
    enabled: true,
    headers: {
      referrerPolicy:
        security?.headers?.referrerPolicy ??
        DEFAULT_SECURITY_HEADERS.referrerPolicy,
      contentTypeOptions:
        security?.headers?.contentTypeOptions ??
        DEFAULT_SECURITY_HEADERS.contentTypeOptions,
      permissionsPolicy:
        security?.headers?.permissionsPolicy ??
        DEFAULT_SECURITY_HEADERS.permissionsPolicy,
    },
    contentSecurityPolicy: createContentSecurityPolicy(
      security?.contentSecurityPolicy,
    ),
    noindex: createNoindexPolicy(security?.noindex),
    cors: createCloudflareWorkerCorsPolicy(security?.cors),
    reason: security?.reason,
  };
};

const readRouteSpec = async (outputDirectory: string) => {
  const routeSpecPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);

  if (!(await fse.pathExists(routeSpecPath))) {
    return { routes: [] };
  }

  const routeSpec = await fse.readJSON(routeSpecPath);

  return {
    ...routeSpec,
    routes: Array.isArray(routeSpec.routes) ? routeSpec.routes : [],
  };
};

const createWorkerManifest = async (
  outputDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const routeSpec = await readRouteSpec(outputDirectory);
  const routes = await Promise.all(
    routeSpec.routes.map(async (route: Record<string, any>) => {
      const worker =
        typeof route.worker === 'string' ? route.worker : undefined;

      return {
        urlPath: route.urlPath,
        entryName: route.entryName,
        entryPath: route.entryPath,
        isSSR: Boolean(route.isSSR),
        worker,
        workerExists: worker
          ? await fse.pathExists(path.join(outputDirectory, worker))
          : false,
      };
    }),
  );

  const bffPrefix = modernConfig.bff?.prefix;
  const primaryBffPrefix = Array.isArray(bffPrefix) ? bffPrefix[0] : bffPrefix;
  const isEffectBff =
    Boolean(modernConfig.bff) && modernConfig.bff?.runtimeFramework !== 'hono';
  const effectBffWorkerExists = await fse.pathExists(
    path.join(outputDirectory, BFF_EFFECT_WORKER_ENTRY),
  );

  return {
    version: 1,
    runtime: {
      type: 'cloudflare-module-worker',
      entry: WORKER_ENTRY,
      fetchExport: true,
      nodeListen: false,
    },
    assets: {
      binding: ASSETS_BINDING,
      directory: `./${PUBLIC_ASSETS_DIRECTORY}`,
      runWorkerFirst: true,
    },
    routeSpec: {
      file: ROUTE_SPEC_OUTPUT,
      routes,
    },
    workerBundles: {
      directory: WORKER_BUNDLE_DIRECTORY,
      format: 'commonjs',
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    },
    resources: {
      loadableStats: LOADABLE_STATS_FILE,
      routeManifest: ROUTE_MANIFEST_FILE,
    },
    security: createCloudflareWorkerSecurityPolicy(modernConfig),
    bff:
      isEffectBff && primaryBffPrefix && effectBffWorkerExists
        ? {
            runtimeFramework: 'effect',
            prefix: primaryBffPrefix,
            worker: BFF_EFFECT_WORKER_ENTRY,
          }
        : undefined,
  };
};

const createWorkerModuleLoaders = (manifest: any) => {
  const imports = new Map<string, string>();

  for (const route of manifest.routeSpec.routes) {
    if (route.worker && route.workerExists) {
      const importPath = `../${String(route.worker).replace(/^\/+/u, '')}`;
      imports.set(route.worker, `() => import(${JSON.stringify(importPath)})`);
    }
  }

  if (manifest.bff?.worker) {
    const importPath = `../${String(manifest.bff.worker).replace(/^\/+/u, '')}`;
    imports.set(
      manifest.bff.worker,
      `() => import(${JSON.stringify(importPath)})`,
    );
  }

  if (imports.size === 0) {
    return '{}';
  }

  const loaders = [...imports.entries()].map(
    ([worker, loader]) => `${JSON.stringify(worker)}: ${loader}`,
  );

  return `{\n${loaders.join(',\n')}\n}`;
};

const shouldCopyToPublicAssets = (src: string, distDirectory: string) => {
  const relativePath = path.relative(distDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const [topLevelDirectory] = normalizedRelativePath.split('/');

  return (
    normalizedRelativePath !== ROUTE_SPEC_FILE &&
    topLevelDirectory !== WORKER_BUNDLE_DIRECTORY &&
    topLevelDirectory !== SERVER_BUNDLE_DIRECTORY
  );
};

const shouldCopyToWorkerBundle = (
  src: string,
  workerBundleDirectory: string,
) => {
  const relativePath = path.relative(workerBundleDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const basename = path.basename(normalizedRelativePath);

  if (basename.startsWith('.') || normalizedRelativePath.includes('/.')) {
    return false;
  }

  if (fse.statSync(src).isDirectory()) {
    return true;
  }

  return ['.cjs', '.js', '.mjs'].includes(path.extname(normalizedRelativePath));
};

export const createCloudflarePreset: CreatePreset = ({
  appContext,
  modernConfig,
}) => {
  const { appDirectory, distDirectory } = appContext;

  const outputDirectory = path.join(appDirectory, '.output');
  const publicDirectory = path.join(outputDirectory, PUBLIC_ASSETS_DIRECTORY);
  const workerEntryPath = path.join(outputDirectory, WORKER_ENTRY);
  const workerManifestPath = path.join(outputDirectory, WORKER_MANIFEST);
  const routeSpecOutputPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);
  const wranglerConfigPath = path.join(outputDirectory, 'wrangler.json');
  const workerName = getConfiguredWorkerName(appDirectory, modernConfig);

  return {
    async prepare() {
      await fse.remove(outputDirectory);
    },
    async writeOutput() {
      await fse.copy(distDirectory, publicDirectory, {
        filter: src => shouldCopyToPublicAssets(src, distDirectory),
      });
      await fse.ensureDir(path.dirname(workerEntryPath));
      await fse.ensureDir(path.dirname(workerManifestPath));

      const routeSpecSourcePath = path.join(distDirectory, ROUTE_SPEC_FILE);
      if (await fse.pathExists(routeSpecSourcePath)) {
        await fse.copy(routeSpecSourcePath, routeSpecOutputPath);
      }

      const workerBundleSourceDirectory = path.join(
        distDirectory,
        WORKER_BUNDLE_DIRECTORY,
      );
      const workerBundleOutputDirectory = path.join(
        outputDirectory,
        WORKER_BUNDLE_DIRECTORY,
      );
      if (await fse.pathExists(workerBundleSourceDirectory)) {
        await fse.copy(
          workerBundleSourceDirectory,
          workerBundleOutputDirectory,
          {
            filter: src =>
              shouldCopyToWorkerBundle(src, workerBundleSourceDirectory),
          },
        );
        await fse.writeJSON(
          path.join(workerBundleOutputDirectory, 'package.json'),
          {
            type: 'commonjs',
          },
        );
      }

      await fse.writeJSON(
        wranglerConfigPath,
        {
          $schema: 'node_modules/wrangler/config-schema.json',
          name: workerName,
          main: WORKER_ENTRY,
          compatibility_date: getCompatibilityDate(modernConfig),
          compatibility_flags: [
            'nodejs_compat',
            'global_fetch_strictly_public',
          ],
          assets: {
            directory: `./${PUBLIC_ASSETS_DIRECTORY}`,
            binding: ASSETS_BINDING,
            run_worker_first: true,
          },
        },
        {
          spaces: 2,
        },
      );

      await fse.writeJSON(
        workerManifestPath,
        await createWorkerManifest(outputDirectory, modernConfig),
        {
          spaces: 2,
        },
      );
      await fse.writeJSON(path.join(outputDirectory, 'package.json'), {
        type: 'module',
      });
    },
    async genEntry() {
      const template = await readTemplate('cloudflare-entry.mjs');
      const manifest = await fse.readJSON(workerManifestPath);

      await fse.writeFile(
        workerEntryPath,
        template
          .replace('p_workerManifest', JSON.stringify(manifest, null, 2))
          .replace(
            'p_workerModuleLoaders',
            createWorkerModuleLoaders(manifest),
          ),
      );
    },
  };
};
