import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cliKit from '../../lib/cli-kit.js';
import fsKit from '../../lib/fs-kit.js';

const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const { parseCliArgs, rejectInlineOptionValues } = cliKit;
const { readJsonFile } = fsKit;
const defaultArtifactDir = '.modern/production-readiness/browser-smoke/local';
const defaultReportPath =
  '.modern/production-readiness/browser-smoke/summary.json';
const compactContractRelativePath = '.modernjs/ultramodern.json';
const legacyContractRelativePath =
  '.modernjs/ultramodern-generated-contract.json';

export class BrowserSmokeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BrowserSmokeError';
    this.details = details;
  }
}

export function parseArgs(argv) {
  rejectInlineOptionValues(argv, [
    '--project-dir',
    '--artifact-dir',
    '--out',
    '--mode',
    '--artifact-mode',
    '--platform',
    '--public-url',
    '--shell-runtime',
    '--timeout-ms',
  ]);

  const parsed = parseCliArgs(argv, {
    defaults: {
      artifactDir: defaultArtifactDir,
      mode: 'local',
      artifactMode: undefined,
      out: defaultReportPath,
      publicUrlEntries: [],
      requirePublicUrls: false,
      shellRuntime: 'node',
      timeoutMs: '60000',
    },
    options: {
      'project-dir': {
        key: 'projectDir',
        requiredValue: false,
      },
      'artifact-dir': {
        key: 'artifactDir',
        requiredValue: false,
      },
      out: {
        requiredValue: false,
      },
      mode: {
        requiredValue: false,
      },
      'artifact-mode': {
        key: 'artifactMode',
        requiredValue: false,
      },
      platform: {
        requiredValue: false,
      },
      'public-url': {
        key: 'publicUrlEntries',
        multiple: true,
        requiredValue: false,
      },
      'require-public-urls': {
        key: 'requirePublicUrls',
        type: 'boolean',
      },
      'shell-runtime': {
        key: 'shellRuntime',
        requiredValue: false,
      },
      'timeout-ms': {
        key: 'timeoutMs',
        requiredValue: false,
      },
    },
  });

  const publicUrls = {};
  for (const entry of parsed.publicUrlEntries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error('--public-url must be appId=url');
    }
    publicUrls[entry.slice(0, separatorIndex)] = entry.slice(
      separatorIndex + 1,
    );
  }
  parsed.timeoutMs = Number.parseInt(parsed.timeoutMs, 10);
  const { publicUrlEntries, ...resolvedOptions } = parsed;

  if (!parsed.projectDir) {
    throw new Error('--project-dir is required');
  }
  if (!['local', 'public'].includes(parsed.mode)) {
    throw new Error('--mode must be local or public');
  }
  if (
    parsed.artifactMode !== undefined &&
    !['source', 'published'].includes(parsed.artifactMode)
  ) {
    throw new Error('--artifact-mode must be source or published');
  }
  if (
    parsed.platform !== undefined &&
    !['node', 'workerd'].includes(parsed.platform)
  ) {
    throw new Error('--platform must be node or workerd');
  }
  if (!['node', 'workerd'].includes(parsed.shellRuntime)) {
    throw new Error('--shell-runtime must be node or workerd');
  }
  if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return {
    ...resolvedOptions,
    artifactDir: path.resolve(repoRoot, parsed.artifactDir),
    out: path.resolve(repoRoot, parsed.out),
    publicUrls,
    projectDir: path.resolve(parsed.projectDir),
  };
}

export function appPort(app) {
  return app.config?.source?.siteUrl?.defaultLocalhostPort;
}

export function appPortEnv(app) {
  return app.config?.source?.siteUrl?.envFallbackOrder?.find(name =>
    String(name).endsWith('_PORT'),
  );
}

export function appPublicUrlEnv(app) {
  return app.deploy?.cloudflare?.publicUrlEnv;
}

export function expectedAppIdFromRootSelector(selector) {
  return selector?.match(/data-app-id="([^"]+)"/u)?.[1];
}

export function routesForApp(app) {
  const cloudflareRoutes = app.deploy?.cloudflare?.routes ?? {};
  const distributedSsrProofRoutes = Array.isArray(
    app.deploy?.cloudflare?.distributedSsrProofRoutes,
  )
    ? app.deploy.cloudflare.distributedSsrProofRoutes
    : [];
  return {
    distributedSsr:
      distributedSsrProofRoutes.at(-1) ?? cloudflareRoutes.ssr ?? '/en',
    effectReadiness:
      cloudflareRoutes.effectReadiness ?? cloudflareRoutes.apiReadiness,
    locale:
      cloudflareRoutes.locale ?? `/locales/en/${app.i18n?.namespace}.json`,
    mfManifest: cloudflareRoutes.mfManifest ?? '/mf-manifest.json',
    ssr: cloudflareRoutes.ssr ?? '/en',
  };
}

export function toKebabCase(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function toEnvSegment(value) {
  return toKebabCase(value).replace(/-/gu, '_').toUpperCase();
}

export function normalizeRelativePath(value) {
  return String(value ?? '')
    .replace(/\\/gu, '/')
    .replace(/^\.\/+/u, '');
}

export function appNamespace(app) {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}

export function normalizeCompactApp(rawApp) {
  const id = String(rawApp.id);
  const kind = rawApp.kind === 'vertical' ? 'vertical' : 'shell';
  const appPath =
    typeof rawApp.path === 'string'
      ? normalizeRelativePath(rawApp.path)
      : kind === 'shell'
        ? 'apps/shell-super-app'
        : `verticals/${toKebabCase(id)}`;
  const packageSuffix =
    typeof rawApp.packageSuffix === 'string'
      ? rawApp.packageSuffix
      : (appPath.split('/').at(-1) ?? id);
  const domain =
    typeof rawApp.domain === 'string'
      ? rawApp.domain
      : kind === 'vertical'
        ? packageSuffix
        : undefined;
  const moduleFederation =
    rawApp.moduleFederation && typeof rawApp.moduleFederation === 'object'
      ? rawApp.moduleFederation
      : {};
  const port = Number.isInteger(rawApp.port) ? rawApp.port : undefined;
  const portEnv =
    typeof rawApp.portEnv === 'string'
      ? rawApp.portEnv
      : `${toEnvSegment(id)}_PORT`;
  const api =
    rawApp.api && typeof rawApp.api === 'object'
      ? {
          stem:
            typeof rawApp.api.stem === 'string'
              ? rawApp.api.stem
              : (domain ?? id),
          prefix:
            typeof rawApp.api.prefix === 'string'
              ? rawApp.api.prefix
              : `/${domain ?? id}-api`,
        }
      : undefined;

  return {
    ...rawApp,
    id,
    kind,
    path: appPath,
    packageSuffix,
    domain,
    port,
    portEnv,
    moduleFederation,
    api,
  };
}

// Must stay in sync with packages/toolkit/create delivery-unit.ts
// createBuildMarker, which seeds the hash with the delivery-unit generation
// seed. Without this prefix the expected marker drifts from what generated apps
// actually emit (data-build-marker), failing the browser-smoke SSR marker check.
const DELIVERY_UNIT_GENERATION_SEED =
  'ultramodern-delivery-unit-build-marker:v1';

export function createBuildMarker(scope, app) {
  return crypto
    .createHash('sha256')
    .update(
      `${DELIVERY_UNIT_GENERATION_SEED}:${scope}:${app.packageSuffix}:${app.id}:0.1.0`,
    )
    .digest('hex')
    .slice(0, 16);
}

export function createCloudflareRoutes(app) {
  return {
    ssr: '/en',
    mfManifest: '/mf-manifest.json',
    locale: `/locales/en/${appNamespace(app)}.json`,
    ...(app.api
      ? {
          apiReadiness: `${app.api.prefix}/${app.api.stem}/readiness`,
          effectReadiness: `${app.api.prefix}/${app.api.stem}/readiness`,
        }
      : {}),
  };
}

export function createSmokeContractApp(config, app) {
  const packageScope =
    typeof config.workspace?.packageScope === 'string'
      ? config.workspace.packageScope
      : path.basename(process.cwd());

  return {
    id: app.id,
    kind: app.kind,
    api: app.api,
    package: app.package,
    path: app.path,
    config: {
      source: {
        siteUrl: {
          defaultLocalhostPort: app.port,
          envFallbackOrder: [
            'MODERN_PUBLIC_SITE_URL',
            `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
            app.portEnv,
          ],
        },
      },
    },
    deploy: {
      cloudflare: {
        ...(Array.isArray(app.deploy?.cloudflare?.jsonSmokeChecks)
          ? { jsonSmokeChecks: app.deploy.cloudflare.jsonSmokeChecks }
          : {}),
        ...(Array.isArray(app.deploy?.cloudflare?.distributedSsrProofRoutes)
          ? {
              distributedSsrProofRoutes:
                app.deploy.cloudflare.distributedSsrProofRoutes,
            }
          : {}),
        workerName: `${toKebabCase(packageScope)}-${app.packageSuffix}`.slice(
          0,
          63,
        ),
        publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
        routes: createCloudflareRoutes(app),
      },
    },
    i18n: {
      namespace: appNamespace(app),
    },
    marker: {
      appId: app.id,
      build: createBuildMarker(packageScope, app),
    },
    moduleFederation: {
      ...app.moduleFederation,
    },
    styling: {
      federation: {
        rootSelector: `[data-app-id="${app.id}"]`,
      },
    },
  };
}

export function synthesizeContractFromCompactConfig(
  config,
  { sourcePath } = {},
) {
  const apps = Array.isArray(config.topology?.apps)
    ? config.topology.apps.map(normalizeCompactApp)
    : [];

  return {
    sourcePath,
    apps: apps.map(app => createSmokeContractApp(config, app)),
  };
}

export function normalizeSmokeContract(contract, options = {}) {
  if (Array.isArray(contract?.apps)) {
    return {
      ...contract,
      sourcePath: contract.sourcePath ?? options.sourcePath,
    };
  }
  if (Array.isArray(contract?.topology?.apps)) {
    return synthesizeContractFromCompactConfig(contract, options);
  }
  return {
    ...contract,
    sourcePath: contract?.sourcePath ?? options.sourcePath,
  };
}

export function resolveContractPath(projectDir) {
  const compactPath = path.join(projectDir, compactContractRelativePath);
  if (fs.existsSync(compactPath)) {
    return compactPath;
  }

  const legacyPath = path.join(projectDir, legacyContractRelativePath);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return compactPath;
}

export function readSmokeContract(projectDir) {
  const contractPath = resolveContractPath(projectDir);
  return {
    contract: normalizeSmokeContract(readJsonFile(contractPath), {
      sourcePath: contractPath,
    }),
    contractPath,
  };
}
