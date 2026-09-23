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
const topologyRelativePath = 'topology/reference-topology.json';
const overlayRelativePath = 'topology/local-overlays/development.json';

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
  if ((parsed.artifactMode === undefined) !== (parsed.platform === undefined)) {
    throw new Error(
      '--artifact-mode and --platform must be provided together for strict release smoke',
    );
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

// Must stay in sync with packages/toolkit/ultramodern-create delivery-unit.ts
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

function createSmokeContractApp(config, app) {
  const packageScope =
    typeof config.workspace?.packageScope === 'string'
      ? config.workspace.packageScope
      : path.basename(process.cwd());

  return {
    id: app.id,
    kind: app.kind,
    ...(typeof app.domain === 'string' ? { domain: app.domain } : {}),
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
        ...app.deploy?.cloudflare,
        workerName:
          app.deploy?.cloudflare?.workerName ??
          `${toKebabCase(packageScope)}-${app.packageSuffix}`.slice(0, 63),
        publicUrlEnv:
          app.deploy?.cloudflare?.publicUrlEnv ??
          `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
        routes: app.deploy?.cloudflare?.routes ?? createCloudflareRoutes(app),
      },
    },
    ...(app.deliveryUnit &&
    typeof app.deliveryUnit === 'object' &&
    !Array.isArray(app.deliveryUnit)
      ? { deliveryUnit: { ...app.deliveryUnit } }
      : {}),
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

export function normalizeSmokeContract(contract, options = {}) {
  if (Array.isArray(contract?.apps)) {
    return {
      ...contract,
      sourcePath: contract.sourcePath ?? options.sourcePath,
    };
  }
  throw new BrowserSmokeError(
    'Browser smoke requires an explicit app contract.',
  );
}

export function readSmokeContract(projectDir) {
  const contractPath = path.join(projectDir, topologyRelativePath);
  const topology = readJsonFile(contractPath);
  const overlay = readJsonFile(path.join(projectDir, overlayRelativePath));
  if (
    !topology?.shell ||
    !Array.isArray(topology.verticals) ||
    (topology.shells !== undefined && !Array.isArray(topology.shells))
  )
    throw new BrowserSmokeError(
      'Reference topology requires shell, verticals and optional shells.',
    );
  const rootManifest = readJsonFile(path.join(projectDir, 'package.json'));
  const records = [
    topology.shell,
    ...topology.verticals,
    ...(topology.shells ?? []),
  ];
  const ids = new Set();
  const paths = new Set();
  const ports = new Set();
  const workspace = fs.realpathSync(projectDir);
  const apps = records.map((entry, index) => {
    const kind =
      index === 0 || index > topology.verticals.length ? 'shell' : 'vertical';
    if (
      entry?.kind !== kind ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id)
    )
      throw new BrowserSmokeError(
        'Reference topology app identity or kind is invalid.',
      );
    ids.add(entry.id);
    if (
      typeof entry.path !== 'string' ||
      !entry.path ||
      path.isAbsolute(entry.path) ||
      entry.path.split(/[\\/]/u).includes('..')
    )
      throw new BrowserSmokeError(
        `${entry.id} requires a safe explicit topology path.`,
      );
    const appRoot = fs.realpathSync(path.join(projectDir, entry.path));
    const relative = path.relative(workspace, appRoot);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new BrowserSmokeError(
        `${entry.id} topology path escapes the workspace.`,
      );
    if (paths.has(appRoot))
      throw new BrowserSmokeError(`${entry.id} topology path is duplicated.`);
    paths.add(appRoot);
    const manifest = readJsonFile(path.join(appRoot, 'package.json'));
    if (
      typeof manifest.name !== 'string' ||
      !manifest.name ||
      (entry.package !== undefined && entry.package !== manifest.name) ||
      typeof manifest.version !== 'string' ||
      !manifest.version
    )
      throw new BrowserSmokeError(
        `${entry.id} package identity must match its app manifest.`,
      );
    const port = overlay?.ports?.[entry.id];
    if (!Number.isInteger(port) || port < 1 || port > 65535 || ports.has(port))
      throw new BrowserSmokeError(
        `${entry.id} requires a unique development overlay port.`,
      );
    ports.add(port);
    const domain = kind === 'vertical' ? (entry.domain ?? entry.id) : undefined;
    const api =
      entry.api?.runtime === 'effect'
        ? {
            stem:
              entry.api.stem ??
              entry.api.basePath?.split('/').filter(Boolean).at(-1) ??
              domain,
            prefix: entry.api.bff?.prefix,
          }
        : undefined;
    if (
      api &&
      (typeof api.prefix !== 'string' ||
        !api.prefix.startsWith('/') ||
        typeof api.stem !== 'string' ||
        !api.stem)
    )
      throw new BrowserSmokeError(`${entry.id} Effect API route is invalid.`);
    return {
      ...entry,
      kind,
      package: manifest.name,
      version: manifest.version,
      packageSuffix: manifest.name.split('/').at(-1),
      domain,
      port,
      portEnv:
        entry.portEnv ??
        (kind === 'vertical'
          ? `VERTICAL_${toEnvSegment(domain)}_PORT`
          : entry.id === 'shell-super-app'
            ? 'SHELL_SUPER_APP_PORT'
            : `SHELL_${toEnvSegment(entry.id.replace(/^shell-/u, ''))}_PORT`),
      moduleFederation: entry.moduleFederation ?? {},
      api,
      deploy: { cloudflare: entry.cloudflare },
    };
  });
  const config = { workspace: { packageScope: rootManifest.name } };
  return {
    contract: {
      sourcePath: contractPath,
      workspace: config.workspace,
      apps: apps.map(app => createSmokeContractApp(config, app)),
    },
    contractPath,
  };
}
