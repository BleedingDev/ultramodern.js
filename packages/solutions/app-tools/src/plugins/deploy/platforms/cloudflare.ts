import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerSecurityConfig,
  JsonValue,
} from '../../../types/config/deploy';
import { readTemplate } from '../utils';
import type { CreatePreset } from './platform';

const WORKER_ENTRY = 'server/index.mjs';
const WORKER_MANIFEST = 'server/modern-worker-manifest.json';
const WRANGLER_CONFIG_FILE = 'wrangler.json';
const OUTPUT_PACKAGE_FILE = 'package.json';
const ASSETS_BINDING = 'ASSETS';
const ROUTE_SPEC_FILE = 'route.json';
const ROUTE_SPEC_OUTPUT = `server/${ROUTE_SPEC_FILE}`;
const LOADABLE_STATS_FILE = 'loadable-stats.json';
const ROUTE_MANIFEST_FILE = 'routes-manifest.json';
const PUBLIC_ASSETS_DIRECTORY = 'public';
const WORKER_BUNDLE_DIRECTORY = 'worker';
const SERVER_BUNDLE_DIRECTORY = 'bundles';
const SERVER_OUTPUT_DIRECTORY = 'server';
const DEFAULT_SERVER_ONLY_PUBLIC_ASSET_EXCLUDES = ['api', 'shared'] as const;
const BFF_EFFECT_WORKER_ENTRY = `${WORKER_BUNDLE_DIRECTORY}/__modern_bff_effect.js`;
const EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE =
  'Ensure the Effect API entry exists at api/index.ts or bff.effect.entry, and import Cloudflare edge handlers from @modern-js/plugin-bff/effect-edge instead of lambda/Hono server helpers.';
const DEFAULT_COMPATIBILITY_DATE = '2026-06-02';
const COMPATIBILITY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const REQUIRED_COMPATIBILITY_FLAGS = [
  'nodejs_compat',
  'global_fetch_strictly_public',
] as const;
const RESERVED_ARTIFACT_DESTINATION_FILES = new Set([
  WRANGLER_CONFIG_FILE,
  OUTPUT_PACKAGE_FILE,
]);
const RESERVED_ARTIFACT_DESTINATION_DIRECTORIES = new Set([
  PUBLIC_ASSETS_DIRECTORY,
  SERVER_OUTPUT_DIRECTORY,
  WORKER_BUNDLE_DIRECTORY,
]);
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

const normalizeRelativePath = (
  value: unknown,
  label: string,
  scope = 'app output',
) => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a relative path inside the ${scope}.`);
  }

  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '');
  const segments = normalized.split('/');

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized === '.' ||
    segments.includes('..')
  ) {
    throw new Error(`${label} must be a relative path inside the ${scope}.`);
  }

  return normalized;
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

const isJsonRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getConfiguredWrangler = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const wrangler = modernConfig.deploy?.worker?.wrangler;

  if (wrangler === undefined) {
    return {};
  }

  if (!isJsonRecord(wrangler)) {
    throw new Error('deploy.worker.wrangler must be a JSON object.');
  }

  return wrangler;
};

const createWranglerCompatibilityFlags = (
  configuredFlags: JsonValue | undefined,
) => {
  if (configuredFlags === undefined) {
    return [...REQUIRED_COMPATIBILITY_FLAGS];
  }

  if (
    !Array.isArray(configuredFlags) ||
    configuredFlags.some(flag => typeof flag !== 'string')
  ) {
    throw new Error(
      'deploy.worker.wrangler.compatibility_flags must be an array of strings.',
    );
  }

  return [...new Set([...configuredFlags, ...REQUIRED_COMPATIBILITY_FLAGS])];
};

const createWranglerAssetsConfig = (
  configuredAssets: JsonValue | undefined,
) => {
  if (configuredAssets !== undefined && !isJsonRecord(configuredAssets)) {
    throw new Error('deploy.worker.wrangler.assets must be an object.');
  }

  return {
    ...(isJsonRecord(configuredAssets) ? configuredAssets : {}),
    directory: `./${PUBLIC_ASSETS_DIRECTORY}`,
    binding: ASSETS_BINDING,
    run_worker_first: true,
  };
};

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
};

const normalizeD1Database = (
  database: CloudflareWorkerD1DatabaseConfig,
  index: number,
) => {
  const binding = assertNonEmptyString(
    database.binding,
    `deploy.worker.d1Databases[${index}].binding`,
  );
  const databaseName = assertNonEmptyString(
    database.databaseName,
    `deploy.worker.d1Databases[${index}].databaseName`,
  );
  const databaseId = assertNonEmptyString(
    database.databaseId,
    `deploy.worker.d1Databases[${index}].databaseId`,
  );
  const migrationsDir =
    database.migrationsDir === undefined
      ? undefined
      : normalizeRelativePath(
          database.migrationsDir,
          `deploy.worker.d1Databases[${index}].migrationsDir`,
          'app root',
        );
  const previewDatabaseId =
    database.previewDatabaseId === undefined
      ? undefined
      : assertNonEmptyString(
          database.previewDatabaseId,
          `deploy.worker.d1Databases[${index}].previewDatabaseId`,
        );

  return {
    binding,
    database_name: databaseName,
    database_id: databaseId,
    ...(migrationsDir === undefined ? {} : { migrations_dir: migrationsDir }),
    ...(previewDatabaseId === undefined
      ? {}
      : { preview_database_id: previewDatabaseId }),
    ...(database.remote === undefined ? {} : { remote: database.remote }),
  };
};

const createWranglerD1Databases = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
  configuredWranglerD1: JsonValue | undefined,
) => {
  const d1Databases = modernConfig.deploy?.worker?.d1Databases;
  if (d1Databases === undefined) {
    return configuredWranglerD1;
  }

  if (configuredWranglerD1 !== undefined) {
    throw new Error(
      'Use deploy.worker.d1Databases or deploy.worker.wrangler.d1_databases, not both.',
    );
  }

  if (!Array.isArray(d1Databases)) {
    throw new Error('deploy.worker.d1Databases must be an array.');
  }

  return d1Databases.map(normalizeD1Database);
};

const createWranglerConfig = (
  appDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  const wrangler = getConfiguredWrangler(modernConfig);
  const d1Databases = createWranglerD1Databases(
    modernConfig,
    wrangler.d1_databases,
  );

  return {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: getConfiguredWorkerName(appDirectory, modernConfig),
    compatibility_date: getCompatibilityDate(modernConfig),
    ...wrangler,
    main: WORKER_ENTRY,
    compatibility_flags: createWranglerCompatibilityFlags(
      wrangler.compatibility_flags,
    ),
    assets: createWranglerAssetsConfig(wrangler.assets),
    ...(d1Databases === undefined ? {} : { d1_databases: d1Databases }),
  };
};

const normalizeCloudflareArtifact = (
  artifact: CloudflareWorkerArtifactConfig,
  index: number,
) => {
  const from = normalizeRelativePath(
    artifact.from,
    `deploy.worker.artifacts[${index}].from`,
    'app root',
  );
  const to = normalizeRelativePath(
    artifact.to,
    `deploy.worker.artifacts[${index}].to`,
    'Cloudflare output',
  );
  const [topLevelDestination] = to.split('/');
  const reservedDestination = RESERVED_ARTIFACT_DESTINATION_FILES.has(to)
    ? to
    : topLevelDestination;

  if (
    RESERVED_ARTIFACT_DESTINATION_FILES.has(to) ||
    RESERVED_ARTIFACT_DESTINATION_DIRECTORIES.has(topLevelDestination)
  ) {
    throw new Error(
      `deploy.worker.artifacts[${index}].to must not target generated Cloudflare output path ${JSON.stringify(
        reservedDestination,
      )}.`,
    );
  }

  return {
    from,
    to,
    index,
  };
};

const getCloudflareArtifacts = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) =>
  (modernConfig.deploy?.worker?.artifacts ?? []).map(
    normalizeCloudflareArtifact,
  );

const copyCloudflareArtifacts = async (
  appDirectory: string,
  outputDirectory: string,
  artifacts: ReturnType<typeof getCloudflareArtifacts>,
) => {
  for (const artifact of artifacts) {
    const sourcePath = path.join(appDirectory, artifact.from);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.artifacts[${artifact.index}].from does not exist: ${artifact.from}`,
      );
    }

    await fse.copy(sourcePath, path.join(outputDirectory, artifact.to));
  }
};

const copyCloudflareD1Migrations = async (
  appDirectory: string,
  outputDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) => {
  for (const [index, database] of (
    modernConfig.deploy?.worker?.d1Databases ?? []
  ).entries()) {
    if (!database.migrationsDir) {
      continue;
    }

    const migrationsDir = normalizeRelativePath(
      database.migrationsDir,
      `deploy.worker.d1Databases[${index}].migrationsDir`,
      'app root',
    );
    const sourcePath = path.join(appDirectory, migrationsDir);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.d1Databases[${index}].migrationsDir does not exist: ${migrationsDir}`,
      );
    }

    await fse.copy(sourcePath, path.join(outputDirectory, migrationsDir));
  }
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

const createMissingEffectBffWorkerError = (
  outputDirectory: string,
  worker: string,
) =>
  new Error(
    `Cloudflare Effect API runtime is configured, but the BFF worker bundle is missing: ${path.join(
      outputDirectory,
      worker,
    )}. ${EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE}`,
  );

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
  const isEffectApi =
    Boolean(modernConfig.bff) && modernConfig.bff?.runtimeFramework !== 'hono';
  const effectApiWorkerExists = await fse.pathExists(
    path.join(outputDirectory, BFF_EFFECT_WORKER_ENTRY),
  );

  if (isEffectApi && primaryBffPrefix && !effectApiWorkerExists) {
    throw createMissingEffectBffWorkerError(
      outputDirectory,
      BFF_EFFECT_WORKER_ENTRY,
    );
  }

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
      isEffectApi && primaryBffPrefix && effectApiWorkerExists
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

const getPublicAssetExcludes = (
  appDirectory: string,
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) =>
  [
    ...DEFAULT_SERVER_ONLY_PUBLIC_ASSET_EXCLUDES.filter(directory => {
      try {
        return fse.statSync(path.join(appDirectory, directory)).isDirectory();
      } catch {
        return false;
      }
    }),
    ...(modernConfig.deploy?.worker?.publicAssetExcludes ?? []),
  ].map(entry =>
    normalizeRelativePath(entry, 'deploy.worker.publicAssetExcludes'),
  );

const shouldCopyToPublicAssets = (
  src: string,
  distDirectory: string,
  publicAssetExcludes: string[],
) => {
  const relativePath = path.relative(distDirectory, src);

  if (!relativePath) {
    return true;
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const [topLevelDirectory] = normalizedRelativePath.split('/');

  return (
    normalizedRelativePath !== ROUTE_SPEC_FILE &&
    topLevelDirectory !== WORKER_BUNDLE_DIRECTORY &&
    topLevelDirectory !== SERVER_BUNDLE_DIRECTORY &&
    !publicAssetExcludes.some(
      exclude =>
        normalizedRelativePath === exclude ||
        normalizedRelativePath.startsWith(`${exclude}/`),
    )
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
  const wranglerConfigPath = path.join(outputDirectory, WRANGLER_CONFIG_FILE);
  const cloudflareArtifacts = getCloudflareArtifacts(modernConfig);
  const publicAssetExcludes = getPublicAssetExcludes(
    appDirectory,
    modernConfig,
  );

  return {
    async prepare() {
      await fse.remove(outputDirectory);
    },
    async writeOutput() {
      await fse.copy(distDirectory, publicDirectory, {
        filter: src =>
          shouldCopyToPublicAssets(src, distDirectory, publicAssetExcludes),
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
      await copyCloudflareArtifacts(
        appDirectory,
        outputDirectory,
        cloudflareArtifacts,
      );
      await copyCloudflareD1Migrations(
        appDirectory,
        outputDirectory,
        modernConfig,
      );

      await fse.writeJSON(
        wranglerConfigPath,
        createWranglerConfig(appDirectory, modernConfig),
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
      await fse.writeJSON(path.join(outputDirectory, OUTPUT_PACKAGE_FILE), {
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
