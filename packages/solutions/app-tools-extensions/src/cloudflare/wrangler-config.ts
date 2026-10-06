import path from 'node:path';
import type {
  CloudflareWorkerD1DatabaseConfig,
  CloudflareWorkerServiceBindingConfig,
  CloudflareWorkerVpcServiceConfig,
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

// Workers only add Node.js built-ins at later dates, and the bundler
// externalizes the set probed at DEFAULT_COMPATIBILITY_DATE; an earlier date
// could leave an externalized built-in unresolvable at deploy time.
const assertSupportedCompatibilityDate = (
  compatibilityDate: JsonValue | undefined,
  label: string,
) => {
  if (typeof compatibilityDate !== 'string') {
    throw new Error(`${label} must be a YYYY-MM-DD string.`);
  }
  if (!COMPATIBILITY_DATE_PATTERN.test(compatibilityDate)) {
    throw new Error(
      `${label} must use YYYY-MM-DD, received ${JSON.stringify(
        compatibilityDate,
      )}.`,
    );
  }
  if (compatibilityDate < DEFAULT_COMPATIBILITY_DATE) {
    throw new Error(
      `${label} must be ${DEFAULT_COMPATIBILITY_DATE} or later, the date the Cloudflare worker Node.js built-in contract is verified against; received ${JSON.stringify(
        compatibilityDate,
      )}.`,
    );
  }
  return compatibilityDate;
};

const getCompatibilityDate = (
  modernConfig: CloudflareModernConfig,
  wranglerCompatibilityDate: JsonValue | undefined,
) => {
  if (wranglerCompatibilityDate !== undefined) {
    // A raw Wrangler override is the effective date, so it is validated too.
    return assertSupportedCompatibilityDate(
      wranglerCompatibilityDate,
      'deploy.worker.wrangler.compatibility_date',
    );
  }
  return assertSupportedCompatibilityDate(
    modernConfig.deploy?.worker?.compatibilityDate?.trim() ||
      DEFAULT_COMPATIBILITY_DATE,
    'deploy.worker.compatibilityDate',
  );
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
  label = 'deploy.worker.wrangler.compatibility_flags',
) => {
  if (configuredFlags === undefined) {
    return [...REQUIRED_COMPATIBILITY_FLAGS];
  }

  if (
    !Array.isArray(configuredFlags) ||
    configuredFlags.some(flag => typeof flag !== 'string')
  ) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return [...new Set([...configuredFlags, ...REQUIRED_COMPATIBILITY_FLAGS])];
};

// `wrangler deploy --env <name>` uses an environment's own compatibility_date
// and compatibility_flags instead of the top-level values, so each override
// is held to the same verified date floor and required flags.
const createWranglerEnvironments = (
  wranglerEnv: JsonValue | undefined,
): Record<string, Record<string, JsonValue>> | undefined => {
  if (wranglerEnv === undefined) {
    return undefined;
  }
  if (!isJsonRecord(wranglerEnv)) {
    throw new Error('deploy.worker.wrangler.env must be an object.');
  }
  return Object.fromEntries(
    Object.entries(wranglerEnv).map(([name, environment]) => {
      const label = `deploy.worker.wrangler.env.${name}`;
      if (!isJsonRecord(environment)) {
        throw new Error(`${label} must be an object.`);
      }
      return [
        name,
        {
          ...environment,
          ...(environment.compatibility_date === undefined
            ? {}
            : {
                compatibility_date: assertSupportedCompatibilityDate(
                  environment.compatibility_date,
                  `${label}.compatibility_date`,
                ),
              }),
          ...(environment.compatibility_flags === undefined
            ? {}
            : {
                compatibility_flags: createWranglerCompatibilityFlags(
                  environment.compatibility_flags,
                  `${label}.compatibility_flags`,
                ),
              }),
        },
      ];
    }),
  );
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

const normalizeVpcService = (
  vpcService: CloudflareWorkerVpcServiceConfig,
  index: number,
) => {
  const binding = assertNonEmptyString(
    vpcService.binding,
    `deploy.worker.vpcServices[${index}].binding`,
  );
  const serviceId = assertNonEmptyString(
    vpcService.serviceId,
    `deploy.worker.vpcServices[${index}].serviceId`,
  );
  const prefix =
    vpcService.prefix === undefined
      ? undefined
      : assertNonEmptyString(
          vpcService.prefix,
          `deploy.worker.vpcServices[${index}].prefix`,
        );

  return { binding, serviceId, ...(prefix === undefined ? {} : { prefix }) };
};

// The worker dispatcher percent-decodes a request path (up to four rounds, as
// `resolvePrefixPathname` does), matches a prefix on path-segment boundaries
// and takes the first matching binding, so overlapping prefixes, including
// encoded aliases of one another, route ambiguously.
const decodeRoutePrefix = (prefix: string) => {
  let decoded = prefix;
  for (let round = 0; round < 4; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return decoded;
    }
    if (next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
};

const normalizeRoutePrefix = (prefix: string) => {
  const decoded = decodeRoutePrefix(prefix);
  return decoded === '/' ? decoded : decoded.replace(/\/+$/u, '');
};

// The dispatcher matches `new URL(request.url).pathname`, so a prefix is
// routable only if URL parsing keeps it unchanged: no query or fragment, no
// `.`/`..` segments, nothing URL parsing would re-encode, and no percent-encoding
// (the dispatcher decodes request paths before matching).
const isCanonicalRoutePrefix = (prefix: string) =>
  prefix.startsWith('/') &&
  !prefix.includes('\\') &&
  decodeRoutePrefix(prefix) === prefix &&
  new URL(prefix, 'https://route.invalid').pathname === prefix;

/**
 * Names the generated Worker may already expose on `env`, collected
 * conservatively so no Wrangler binding shape is missed: every `binding` field
 * at any depth (assets, D1, KV, Hyperdrive, queue producers, …), the `name` of
 * every array entry (Durable Objects, `send_email`, `ratelimits`, `unsafe` and
 * `logfwdr` bindings, …), and `vars` keys. A non-binding array `name` can only
 * make a VPC name collide, never let a real collision through. Service and VPC
 * bindings are checked separately; per-environment overrides live under `env`.
 */
const collectWorkerBindingNames = (config: Record<string, JsonValue>) => {
  const names = new Set<string>();
  const visit = (value: JsonValue, inArray: boolean) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, true);
      }
      return;
    }
    if (!isJsonRecord(value)) {
      return;
    }
    for (const field of inArray ? ['binding', 'name'] : ['binding']) {
      const name = value[field];
      if (typeof name === 'string') {
        names.add(name.trim());
      }
    }
    for (const child of Object.values(value)) {
      visit(child, false);
    }
  };
  for (const [key, value] of Object.entries(config)) {
    if (key === 'env' || key === 'services' || key === 'vpc_services') {
      continue;
    }
    if (key === 'vars' && isJsonRecord(value)) {
      for (const name of Object.keys(value)) {
        names.add(name);
      }
      continue;
    }
    visit(value, false);
  }
  return names;
};

const prefixesOverlap = (left: string, right: string) => {
  const [first, second] = [
    normalizeRoutePrefix(left),
    normalizeRoutePrefix(right),
  ];
  return (
    first === '/' ||
    second === '/' ||
    first === second ||
    first.startsWith(`${second}/`) ||
    second.startsWith(`${first}/`)
  );
};

/**
 * The prefix the worker's Effect BFF dispatcher owns. It runs before any
 * service binding, so it takes part in route-overlap checks.
 */
export const getWorkerEffectBffPrefix = (
  modernConfig: CloudflareModernConfig,
) => {
  const bffPrefix = modernConfig.bff?.prefix;
  const primaryBffPrefix = Array.isArray(bffPrefix) ? bffPrefix[0] : bffPrefix;
  const isEffectApi =
    Boolean(modernConfig.bff) && modernConfig.bff?.runtimeFramework !== 'hono';
  return isEffectApi && primaryBffPrefix ? primaryBffPrefix : undefined;
};

const effectiveServiceBindings = (
  serviceBindings: ReturnType<typeof createWorkerServiceBindings>,
) => {
  const bindings: unknown[] = Array.isArray(serviceBindings)
    ? serviceBindings
    : [];
  return bindings.flatMap(service =>
    isJsonRecord(service) && typeof service.binding === 'string'
      ? [
          {
            binding: service.binding.trim(),
            prefix:
              typeof service.prefix === 'string' ? service.prefix : undefined,
          },
        ]
      : [],
  );
};

export const createWorkerVpcServiceBindings = (
  modernConfig: CloudflareModernConfig,
  configuredWranglerVpcServices: JsonValue | undefined,
  serviceBindings: ReturnType<typeof createWorkerServiceBindings>,
  workerBindingNames: ReadonlySet<string>,
) => {
  const vpcServices = modernConfig.deploy?.worker?.vpcServices;

  if (vpcServices === undefined) {
    return undefined;
  }

  if (configuredWranglerVpcServices !== undefined) {
    throw new Error(
      'Use deploy.worker.vpcServices or deploy.worker.wrangler.vpc_services, not both.',
    );
  }

  if (!Array.isArray(vpcServices)) {
    throw new Error('deploy.worker.vpcServices must be an array.');
  }

  const services = effectiveServiceBindings(serviceBindings);
  const serviceBindingNames = new Set(services.map(({ binding }) => binding));
  const effectBffPrefix = getWorkerEffectBffPrefix(modernConfig);
  const routes = [
    ...(effectBffPrefix === undefined
      ? []
      : [{ owner: 'the Effect BFF', prefix: effectBffPrefix }]),
    ...services.flatMap(({ binding, prefix }) =>
      prefix === undefined ? [] : [{ owner: `binding "${binding}"`, prefix }],
    ),
  ];
  const vpcBindingNames = new Set<string>();

  return vpcServices.map((vpcService, index) => {
    const normalized = normalizeVpcService(vpcService, index);
    if (serviceBindingNames.has(normalized.binding)) {
      throw new Error(
        `deploy.worker.vpcServices[${index}].binding "${normalized.binding}" is already declared by deploy.worker.services.`,
      );
    }
    if (workerBindingNames.has(normalized.binding)) {
      throw new Error(
        `deploy.worker.vpcServices[${index}].binding "${normalized.binding}" is already a binding of this Worker.`,
      );
    }
    if (vpcBindingNames.has(normalized.binding)) {
      throw new Error(
        `deploy.worker.vpcServices[${index}].binding "${normalized.binding}" is declared more than once.`,
      );
    }
    vpcBindingNames.add(normalized.binding);
    if (normalized.prefix !== undefined) {
      const { prefix } = normalized;
      if (!isCanonicalRoutePrefix(prefix)) {
        throw new Error(
          `deploy.worker.vpcServices[${index}].prefix "${prefix}" must be a decoded URL path that starts with "/" (no query, fragment, "." or ".." segments).`,
        );
      }
      const shadow = routes.find(route =>
        prefixesOverlap(route.prefix, prefix),
      );
      if (shadow !== undefined) {
        throw new Error(
          `deploy.worker.vpcServices[${index}].prefix "${prefix}" overlaps the prefix "${shadow.prefix}" of ${shadow.owner}; the worker dispatcher would route one of them ambiguously.`,
        );
      }
      routes.push({ owner: `binding "${normalized.binding}"`, prefix });
    }
    return normalized;
  });
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
  vpcServiceBindings: ReturnType<typeof createWorkerVpcServiceBindings>,
) => {
  const vpcManifestBindings = (vpcServiceBindings ?? []).flatMap(
    ({ binding, prefix, serviceId }) =>
      prefix === undefined
        ? []
        : [
            {
              binding,
              interface: 'fetch',
              prefix,
              vpcServiceId: serviceId,
            },
          ],
  );

  if (!Array.isArray(serviceBindings)) {
    return vpcManifestBindings.length > 0 ? vpcManifestBindings : undefined;
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

  const allBindings = [...manifestBindings, ...vpcManifestBindings];

  return allBindings.length > 0 ? allBindings : undefined;
};

export const createWranglerConfig = (
  appDirectory: string,
  modernConfig: CloudflareModernConfig,
) => {
  const wrangler = getConfiguredWrangler(modernConfig);
  const environments = createWranglerEnvironments(wrangler.env);
  const d1Databases = createWranglerD1Databases(
    modernConfig,
    wrangler.d1_databases,
  );
  const serviceBindings = createWorkerServiceBindings(
    modernConfig,
    wrangler.services,
  );
  const wranglerServices = createWranglerServices(serviceBindings);
  const workerConfig = {
    $schema: 'node_modules/wrangler/config-schema.json',
    name: getConfiguredWorkerName(appDirectory, modernConfig),
    ...wrangler,
    compatibility_date: getCompatibilityDate(
      modernConfig,
      wrangler.compatibility_date,
    ),
    main: WORKER_ENTRY,
    compatibility_flags: createWranglerCompatibilityFlags(
      wrangler.compatibility_flags,
    ),
    assets: createWranglerAssetsConfig(wrangler.assets),
    ...(environments === undefined ? {} : { env: environments }),
    ...(d1Databases === undefined ? {} : { d1_databases: d1Databases }),
    ...(wranglerServices === undefined ? {} : { services: wranglerServices }),
  };
  const vpcServiceBindings = createWorkerVpcServiceBindings(
    modernConfig,
    wrangler.vpc_services,
    serviceBindings,
    collectWorkerBindingNames(workerConfig),
  );

  if (vpcServiceBindings === undefined) {
    return workerConfig;
  }
  const vpcServicesConfig = vpcServiceBindings.map(
    ({ binding, serviceId }) => ({
      binding,
      service_id: serviceId,
    }),
  );

  return {
    ...workerConfig,
    // Wrangler bindings are not inherited by named environments, so every
    // configured environment receives the typed VPC bindings as well.
    ...(environments === undefined
      ? {}
      : {
          env: Object.fromEntries(
            Object.entries(environments).map(([name, environment]) => {
              if (environment.vpc_services !== undefined) {
                throw new Error(
                  `Use deploy.worker.vpcServices or deploy.worker.wrangler.env.${name}.vpc_services, not both.`,
                );
              }
              // A named environment declares its own (non-inherited) bindings.
              const environmentBindingNames = new Set([
                ...collectWorkerBindingNames(environment),
                ...effectiveServiceBindings(environment.services).map(
                  ({ binding }) => binding,
                ),
              ]);
              const collision = vpcServiceBindings.find(({ binding }) =>
                environmentBindingNames.has(binding),
              );
              if (collision !== undefined) {
                throw new Error(
                  `deploy.worker.vpcServices binding "${collision.binding}" is already a binding of deploy.worker.wrangler.env.${name}.`,
                );
              }
              return [
                name,
                { ...environment, vpc_services: vpcServicesConfig },
              ];
            }),
          ),
        }),
    vpc_services: vpcServicesConfig,
  };
};
