import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerPublicAssetConfig,
  CloudflareWorkerSecurityConfig,
  CloudflareWorkerServiceBindingConfig,
  JsonValue,
} from '../../../types/config/deploy';
import { readTemplate } from '../utils';
import {
  CLOUDFLARE_ASSETS_BINDING,
  CLOUDFLARE_OUTPUT_PACKAGE_FILE,
  CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY,
  CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS,
  CLOUDFLARE_RUNTIME_TYPE,
  CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  CLOUDFLARE_WORKER_BUNDLE_FORMAT,
  CLOUDFLARE_WORKER_ENTRY,
  CLOUDFLARE_WORKER_MANIFEST,
  CLOUDFLARE_WRANGLER_CONFIG_FILE,
} from './cloudflare-output-contract';
import { createCloudflareOutputPlan } from './cloudflare-output-plan';
import { assertCloudflareOutput } from './cloudflare-output-verifier';
import type { CreatePreset } from './platform';

const WORKER_ENTRY = CLOUDFLARE_WORKER_ENTRY;
const WORKER_MANIFEST = CLOUDFLARE_WORKER_MANIFEST;
const WRANGLER_CONFIG_FILE = CLOUDFLARE_WRANGLER_CONFIG_FILE;
const OUTPUT_PACKAGE_FILE = CLOUDFLARE_OUTPUT_PACKAGE_FILE;
const ASSETS_BINDING = CLOUDFLARE_ASSETS_BINDING;
const ROUTE_SPEC_FILE = 'route.json';
const ROUTE_SPEC_OUTPUT = `server/${ROUTE_SPEC_FILE}`;
const LOADABLE_STATS_FILE = 'loadable-stats.json';
const ROUTE_MANIFEST_FILE = 'routes-manifest.json';
const PUBLIC_ASSETS_DIRECTORY = CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY;
const WORKER_BUNDLE_DIRECTORY = CLOUDFLARE_WORKER_BUNDLE_DIRECTORY;
const SERVER_BUNDLE_DIRECTORY = 'bundles';
const SERVER_OUTPUT_DIRECTORY = 'server';
const DEFAULT_SERVER_ONLY_PUBLIC_ASSET_EXCLUDES = ['api', 'shared'] as const;
const BFF_EFFECT_WORKER_ENTRY = `${WORKER_BUNDLE_DIRECTORY}/__modern_bff_effect.js`;
const EFFECT_BFF_CLOUDFLARE_IMPORT_GUIDANCE =
  'Ensure the Effect API entry exists at api/index.ts or bff.effect.entry, and import Cloudflare edge handlers from @modern-js/plugin-bff/effect-edge instead of lambda/Hono server helpers.';
const DEFAULT_COMPATIBILITY_DATE = '2026-06-02';
const COMPATIBILITY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const REQUIRED_COMPATIBILITY_FLAGS = CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS;
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
const I18N_SERVER_PLUGIN_NAME = 'plugin-i18n/server';
const DEFAULT_I18NEXT_DETECTION_OPTIONS = {
  order: [
    'querystring',
    'cookie',
    'localStorage',
    'header',
    'navigator',
    'htmlTag',
    'path',
    'subdomain',
  ],
  lookupQuerystring: 'lng',
  lookupCookie: 'i18next',
  lookupHeader: 'accept-language',
} as const;
const SERVER_SIDE_I18N_DETECTORS = new Set(['querystring', 'cookie', 'header']);

type ServerPluginConfig = NonNullable<
  Parameters<CreatePreset>[0]['appContext']['serverPlugins']
>[number];

type WorkerI18nDetection = {
  order: string[];
  lookupQuerystring: string;
  lookupCookie: string;
  lookupHeader: string;
};

type WorkerI18nEntry = {
  i18nextDetector: boolean;
  languages: string[];
  fallbackLanguage: string;
  detection: WorkerI18nDetection;
  ignoreRedirectRoutes: string[];
  staticRoutePrefixes: string[];
  localisedUrls?: Record<string, Record<string, string>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const getI18nServerPlugin = (
  appContext: Parameters<CreatePreset>[0]['appContext'],
): ServerPluginConfig | undefined =>
  appContext.serverPlugins?.find(plugin =>
    plugin.name.includes(I18N_SERVER_PLUGIN_NAME),
  );

const removeLocaleDetectionByEntry = (config: Record<string, unknown>) => {
  const { localeDetectionByEntry: _localeDetectionByEntry, ...rest } = config;
  return rest;
};

const getEntryLocaleDetection = (
  entryName: string,
  localeDetection: Record<string, unknown>,
) => {
  const byEntry = isRecord(localeDetection.localeDetectionByEntry)
    ? localeDetection.localeDetectionByEntry
    : undefined;
  const entryConfig = byEntry?.[entryName];
  const globalConfig = removeLocaleDetectionByEntry(localeDetection);

  return isRecord(entryConfig)
    ? { ...globalConfig, ...entryConfig }
    : globalConfig;
};

const normalizeI18nDetection = (detection: unknown): WorkerI18nDetection => {
  const configured = isRecord(detection) ? detection : {};
  const rawOrder = Array.isArray(configured.order)
    ? configured.order
    : DEFAULT_I18NEXT_DETECTION_OPTIONS.order;
  const order = rawOrder.filter(
    (entry): entry is string =>
      typeof entry === 'string' && SERVER_SIDE_I18N_DETECTORS.has(entry),
  );

  return {
    order: order.length > 0 ? order : ['querystring', 'cookie', 'header'],
    lookupQuerystring:
      typeof configured.lookupQuerystring === 'string' &&
      configured.lookupQuerystring
        ? configured.lookupQuerystring
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupQuerystring,
    lookupCookie:
      typeof configured.lookupCookie === 'string' && configured.lookupCookie
        ? configured.lookupCookie
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupCookie,
    lookupHeader:
      typeof configured.lookupHeader === 'string' && configured.lookupHeader
        ? configured.lookupHeader
        : DEFAULT_I18NEXT_DETECTION_OPTIONS.lookupHeader,
  };
};

const normalizeLocalisedUrls = (
  localisedUrls: unknown,
): Record<string, Record<string, string>> | undefined => {
  if (!isRecord(localisedUrls) || Object.keys(localisedUrls).length === 0) {
    return undefined;
  }

  const normalized: Record<string, Record<string, string>> = {};
  for (const [canonicalPath, languageMap] of Object.entries(localisedUrls)) {
    if (!isRecord(languageMap)) {
      continue;
    }

    const normalizedLanguageMap = Object.fromEntries(
      Object.entries(languageMap).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].length > 0,
      ),
    );

    if (Object.keys(normalizedLanguageMap).length > 0) {
      normalized[canonicalPath] = normalizedLanguageMap;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeWorkerI18nEntry = (
  entryName: string,
  localeDetection: Record<string, unknown>,
  staticRoutePrefixes: string[],
): WorkerI18nEntry | undefined => {
  const entryConfig = getEntryLocaleDetection(entryName, localeDetection);
  const languages = toStringArray(entryConfig.languages);

  if (entryConfig.localePathRedirect !== true || languages.length === 0) {
    return undefined;
  }

  const fallbackLanguage =
    typeof entryConfig.fallbackLanguage === 'string' &&
    entryConfig.fallbackLanguage
      ? entryConfig.fallbackLanguage
      : 'en';
  const ignoreRedirectRoutes = Array.isArray(entryConfig.ignoreRedirectRoutes)
    ? toStringArray(entryConfig.ignoreRedirectRoutes)
    : [];
  const localisedUrls = normalizeLocalisedUrls(entryConfig.localisedUrls);

  return {
    i18nextDetector: entryConfig.i18nextDetector !== false,
    languages,
    fallbackLanguage,
    detection: normalizeI18nDetection(entryConfig.detection),
    ignoreRedirectRoutes,
    staticRoutePrefixes,
    ...(localisedUrls ? { localisedUrls } : {}),
  };
};

const createI18nWorkerManifest = (
  routeSpec: { routes: Array<Record<string, unknown>> },
  appContext: Parameters<CreatePreset>[0]['appContext'],
) => {
  const i18nServerPlugin = getI18nServerPlugin(appContext);
  const localeDetection = i18nServerPlugin?.options?.localeDetection;

  if (!isRecord(localeDetection)) {
    return undefined;
  }

  const staticRoutePrefixes = toStringArray(
    i18nServerPlugin?.options?.staticRoutePrefixes,
  );
  const entries: Record<string, WorkerI18nEntry> = {};

  for (const route of routeSpec.routes) {
    if (typeof route.entryName !== 'string' || entries[route.entryName]) {
      continue;
    }

    const entry = normalizeWorkerI18nEntry(
      route.entryName,
      localeDetection,
      staticRoutePrefixes,
    );

    if (entry) {
      entries[route.entryName] = entry;
    }
  }

  return Object.keys(entries).length > 0 ? { entries } : undefined;
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
  options: { allowRoot?: boolean } = {},
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
  const isRootDestination = normalized === '.';

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    (!options.allowRoot && isRootDestination) ||
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

const normalizeServiceBinding = (
  service: CloudflareWorkerServiceBindingConfig,
  index: number,
) => {
  const binding = assertNonEmptyString(
    service.binding,
    `deploy.worker.services[${index}].binding`,
  );
  const serviceName = assertNonEmptyString(
    service.service,
    `deploy.worker.services[${index}].service`,
  );
  const prefix =
    service.prefix === undefined
      ? undefined
      : assertNonEmptyString(
          service.prefix,
          `deploy.worker.services[${index}].prefix`,
        );

  return {
    binding,
    service: serviceName,
    ...(prefix === undefined ? {} : { prefix }),
  };
};

const createWorkerServiceBindings = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
  configuredWranglerServices: JsonValue | undefined,
) => {
  const services = modernConfig.deploy?.worker?.services;

  if (services === undefined) {
    return configuredWranglerServices;
  }

  if (configuredWranglerServices !== undefined) {
    throw new Error(
      'Use deploy.worker.services or deploy.worker.wrangler.services, not both.',
    );
  }

  if (!Array.isArray(services)) {
    throw new Error('deploy.worker.services must be an array.');
  }

  return services.map(normalizeServiceBinding);
};

const createWranglerServices = (
  serviceBindings: ReturnType<typeof createWorkerServiceBindings>,
) => {
  if (!Array.isArray(serviceBindings)) {
    return serviceBindings;
  }

  if (!serviceBindings.every(isJsonRecord)) {
    return serviceBindings;
  }

  return serviceBindings.map(service => {
    const { prefix, ...wranglerService } = service as {
      binding: string;
      service: string;
      prefix?: string;
    };

    return wranglerService;
  });
};

const createWorkerManifestServiceBindings = (
  serviceBindings: ReturnType<typeof createWorkerServiceBindings>,
) => {
  if (!Array.isArray(serviceBindings)) {
    return undefined;
  }

  const dispatchBindings = serviceBindings
    .filter(
      (
        service,
      ): service is {
        binding: string;
        service: string;
        prefix: string;
      } =>
        isJsonRecord(service) &&
        typeof service.binding === 'string' &&
        typeof service.service === 'string' &&
        typeof service.prefix === 'string',
    )
    .map(service => ({
      binding: service.binding,
      service: service.service,
      prefix: service.prefix,
      interface: 'fetch',
    }));

  return dispatchBindings.length > 0 ? dispatchBindings : undefined;
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
  const serviceBindings = createWorkerServiceBindings(
    modernConfig,
    wrangler.services,
  );
  const wranglerServices = createWranglerServices(serviceBindings);

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
    ...(wranglerServices === undefined ? {} : { services: wranglerServices }),
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

const normalizeCloudflarePublicAsset = (
  asset: CloudflareWorkerPublicAssetConfig,
  index: number,
) => {
  const from = normalizeRelativePath(
    asset.from,
    `deploy.worker.publicAssets[${index}].from`,
    'app root',
  );
  const to = normalizeRelativePath(
    asset.to,
    `deploy.worker.publicAssets[${index}].to`,
    'Cloudflare public output',
    { allowRoot: true },
  );

  return {
    from,
    to,
    index,
  };
};

const getCloudflarePublicAssets = (
  modernConfig: Parameters<CreatePreset>[0]['modernConfig'],
) =>
  (modernConfig.deploy?.worker?.publicAssets ?? []).map(
    normalizeCloudflarePublicAsset,
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

const copyCloudflarePublicAssets = async (
  appDirectory: string,
  publicDirectory: string,
  publicAssets: ReturnType<typeof getCloudflarePublicAssets>,
) => {
  for (const asset of publicAssets) {
    const sourcePath = path.join(appDirectory, asset.from);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.publicAssets[${asset.index}].from does not exist: ${asset.from}`,
      );
    }

    await fse.copy(sourcePath, path.join(publicDirectory, asset.to));
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

const COMPACT_CONFIG_PATH = '.modernjs/ultramodern.json';
const ULTRAMODERN_BUILD_MODULE = 'shared/ultramodern-build.ts';

type DeliveryUnitIdentity = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
};

type DeliveryUnitStamp = DeliveryUnitIdentity & {
  surfaces: {
    ui: DeliveryUnitIdentity & { surface: 'ui' };
    api: DeliveryUnitIdentity & { surface: 'api' };
  };
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const toDeliveryUnitIdentity = (
  value: unknown,
): DeliveryUnitIdentity | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const unitId = nonEmptyString(value.unitId);
  const buildMarker = nonEmptyString(value.buildMarker);
  const sourceRevision = nonEmptyString(value.sourceRevision);

  if (!unitId || !buildMarker || !sourceRevision) {
    return undefined;
  }

  return { unitId, buildMarker, sourceRevision };
};

const findWorkspaceRoot = async (
  appDirectory: string,
): Promise<string | undefined> => {
  let current = path.resolve(appDirectory);

  for (;;) {
    if (await fse.pathExists(path.join(current, COMPACT_CONFIG_PATH))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
};

/**
 * Resolve the delivery-unit record declared for this app by the workspace
 * compact config (`.modernjs/ultramodern.json`). This is the topology source
 * of truth the Cloudflare worker snapshot is verified against.
 */
const resolveTopologyDeliveryUnit = async (
  appDirectory: string,
): Promise<DeliveryUnitIdentity | undefined> => {
  const workspaceRoot = await findWorkspaceRoot(appDirectory);
  if (!workspaceRoot) {
    return undefined;
  }

  let compactConfig: unknown;
  try {
    compactConfig = await fse.readJSON(
      path.join(workspaceRoot, COMPACT_CONFIG_PATH),
    );
  } catch {
    return undefined;
  }

  if (!isRecord(compactConfig)) {
    return undefined;
  }

  const topology = isRecord(compactConfig.topology)
    ? compactConfig.topology
    : undefined;
  const apps = Array.isArray(topology?.apps) ? topology.apps : [];
  const resolvedAppDirectory = path.resolve(appDirectory);

  for (const app of apps) {
    if (!isRecord(app)) {
      continue;
    }

    const appPath = nonEmptyString(app.path);
    if (
      appPath &&
      path.resolve(workspaceRoot, appPath.replace(/^\.\/+/u, '')) ===
        resolvedAppDirectory
    ) {
      return toDeliveryUnitIdentity(app.deliveryUnit);
    }
  }

  // Single-app compact config: fall back to a top-level declaration.
  return toDeliveryUnitIdentity(compactConfig.deliveryUnit);
};

/**
 * Resolve the delivery-unit identity actually bundled into the worker by
 * parsing the generated `shared/ultramodern-build.ts` module. This is the
 * worker snapshot / UI+API surface source that gets stamped into the manifest.
 */
const resolveWorkerDeliveryUnitStamp = async (
  appDirectory: string,
): Promise<DeliveryUnitStamp | undefined> => {
  const buildModulePath = path.join(appDirectory, ULTRAMODERN_BUILD_MODULE);
  if (!(await fse.pathExists(buildModulePath))) {
    return undefined;
  }

  const source = await fse.readFile(buildModulePath, 'utf8');
  const buildMarker = source.match(/\bbuild:\s*['"]([^'"]+)['"]/u)?.[1];
  const unitId = source.match(/\bunitId:\s*['"]([^'"]+)['"]/u)?.[1];
  const sourceRevision = source.match(
    /\bsourceRevision:\s*['"]([^'"]+)['"]/u,
  )?.[1];

  if (!buildMarker || !unitId || !sourceRevision) {
    return undefined;
  }

  const identity: DeliveryUnitIdentity = {
    unitId,
    buildMarker,
    sourceRevision,
  };

  return {
    ...identity,
    surfaces: {
      ui: { ...identity, surface: 'ui' },
      api: { ...identity, surface: 'api' },
    },
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
  appContext: Parameters<CreatePreset>[0]['appContext'],
  deliveryUnitStamp: DeliveryUnitStamp | undefined,
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
  const serviceBindings = createWorkerManifestServiceBindings(
    createWorkerServiceBindings(modernConfig, undefined),
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
      type: CLOUDFLARE_RUNTIME_TYPE,
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
      format: CLOUDFLARE_WORKER_BUNDLE_FORMAT,
      importableFromModuleWorker: true,
      requestHandlerExport: 'requestHandler',
    },
    resources: {
      loadableStats: LOADABLE_STATS_FILE,
      routeManifest: ROUTE_MANIFEST_FILE,
    },
    security: createCloudflareWorkerSecurityPolicy(modernConfig),
    ...(deliveryUnitStamp ? { deliveryUnit: deliveryUnitStamp } : {}),
    i18n: createI18nWorkerManifest(routeSpec, appContext),
    bff:
      isEffectApi && primaryBffPrefix && effectApiWorkerExists
        ? {
            runtimeFramework: 'effect',
            prefix: primaryBffPrefix,
            worker: BFF_EFFECT_WORKER_ENTRY,
          }
        : undefined,
    ...(serviceBindings === undefined ? {} : { serviceBindings }),
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
  const outputPlan = createCloudflareOutputPlan(outputDirectory);
  const publicDirectory = outputPlan.paths.publicAssets;
  const workerEntryPath = outputPlan.paths.workerEntry;
  const workerManifestPath = outputPlan.paths.workerManifest;
  const routeSpecOutputPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);
  const wranglerConfigPath = outputPlan.paths.wranglerConfig;
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
      const workerBundleOutputDirectory = outputPlan.paths.workerBundle;
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
          outputPlan.paths.workerPackage,
          outputPlan.packages.worker,
        );
      }
      await copyCloudflareArtifacts(
        appDirectory,
        outputDirectory,
        cloudflareArtifacts,
      );
      await copyCloudflarePublicAssets(
        appDirectory,
        publicDirectory,
        getCloudflarePublicAssets(modernConfig),
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

      const deliveryUnitStamp =
        await resolveWorkerDeliveryUnitStamp(appDirectory);
      await fse.writeJSON(
        workerManifestPath,
        await createWorkerManifest(
          outputDirectory,
          modernConfig,
          appContext,
          deliveryUnitStamp,
        ),
        {
          spaces: 2,
        },
      );
      await fse.writeJSON(
        outputPlan.paths.outputPackage,
        outputPlan.packages.output,
      );
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
      const topologyDeliveryUnit =
        await resolveTopologyDeliveryUnit(appDirectory);
      await assertCloudflareOutput({
        outputDirectory,
        importWorker: false,
        ...(topologyDeliveryUnit ? { deliveryUnit: topologyDeliveryUnit } : {}),
      });
    },
  };
};
