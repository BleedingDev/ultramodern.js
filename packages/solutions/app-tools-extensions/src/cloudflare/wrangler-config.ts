import path from 'node:path';
import type {
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerServiceBindingConfig,
  JsonValue,
} from '../config';
import {
  ASSETS_BINDING,
  COMPATIBILITY_DATE_PATTERN,
  DEFAULT_COMPATIBILITY_DATE,
  PUBLIC_ASSETS_DIRECTORY,
  REQUIRED_COMPATIBILITY_FLAGS,
  WORKER_ENTRY,
} from './constants';
import type { CloudflareModernConfig } from './types';
import { isJsonRecord, normalizeRelativePath } from './utils';

const getCompatibilityDate = (modernConfig: CloudflareModernConfig) => {
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
  modernConfig: CloudflareModernConfig,
) => {
  const configuredName = modernConfig.deploy?.worker?.name?.trim();
  return configuredName || getWorkerName(appDirectory);
};

const getConfiguredWrangler = (modernConfig: CloudflareModernConfig) => {
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
  modernConfig: CloudflareModernConfig,
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
  if (service.fragments !== undefined && !Array.isArray(service.fragments)) {
    throw new Error(
      `deploy.worker.services[${index}].fragments must be an array.`,
    );
  }
  const fragments =
    service.fragments === undefined
      ? undefined
      : service.fragments.map((fragment, fragmentIndex) => ({
          remote: assertNonEmptyString(
            fragment.remote,
            `deploy.worker.services[${index}].fragments[${fragmentIndex}].remote`,
          ),
          expose: assertNonEmptyString(
            fragment.expose,
            `deploy.worker.services[${index}].fragments[${fragmentIndex}].expose`,
          ),
          boundaryId: assertNonEmptyString(
            fragment.boundaryId,
            `deploy.worker.services[${index}].fragments[${fragmentIndex}].boundaryId`,
          ),
          path: assertNonEmptyString(
            fragment.path,
            `deploy.worker.services[${index}].fragments[${fragmentIndex}].path`,
          ),
        }));

  return {
    binding,
    service: serviceName,
    ...(prefix === undefined ? {} : { prefix }),
    ...(fragments === undefined ? {} : { fragments }),
  };
};

export const createWorkerServiceBindings = (
  modernConfig: CloudflareModernConfig,
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
    const { prefix, fragments, ...wranglerService } = service as {
      binding: string;
      service: string;
      prefix?: string;
      fragments?: unknown;
    };

    return wranglerService;
  });
};

export const createWorkerManifestServiceBindings = (
  serviceBindings: ReturnType<typeof createWorkerServiceBindings>,
) => {
  if (!Array.isArray(serviceBindings)) {
    return undefined;
  }

  const bindings: unknown[] = serviceBindings;
  const manifestBindings = bindings
    .filter(
      (
        service,
      ): service is {
        binding: string;
        service: string;
        prefix?: string;
        fragments?: Array<{
          remote: string;
          expose: string;
          boundaryId: string;
          path: string;
        }>;
      } =>
        isJsonRecord(service) &&
        typeof service.binding === 'string' &&
        typeof service.service === 'string' &&
        (typeof service.prefix === 'string' ||
          (Array.isArray(service.fragments) && service.fragments.length > 0)),
    )
    .map(service => ({
      binding: service.binding,
      service: service.service,
      interface: 'fetch',
      ...(service.prefix === undefined ? {} : { prefix: service.prefix }),
      ...(service.fragments === undefined
        ? {}
        : { fragments: service.fragments }),
    }));

  return manifestBindings.length > 0 ? manifestBindings : undefined;
};

export const createWranglerConfig = (
  appDirectory: string,
  modernConfig: CloudflareModernConfig,
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
