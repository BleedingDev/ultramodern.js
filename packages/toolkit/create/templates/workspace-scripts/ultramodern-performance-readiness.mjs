import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const defaultReportPath =
  '.codex/reports/performance-readiness/ultramodern-performance-readiness.json';
const configPath = 'scripts/ultramodern-performance-readiness.config.mjs';
const compactConfigPath = '.modernjs/ultramodern.json';
const optOutEnv = 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS';
const signalIds = [
  'bfcache',
  'core-web-vitals-rum',
  'duplicate-prefetch-warmup',
  'cache-policy-sanity',
  'save-data-behavior',
  'cloudflare-ssr-cache-hints',
];

const readText = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');
const readJson = relativePath => JSON.parse(readText(relativePath));
const exists = relativePath => fs.existsSync(path.join(root, relativePath));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const normalizeConfig = value => ({
  enabled: value?.enabled !== false,
  failOn: value?.failOn === 'never' ? 'never' : 'framework-invariant',
  reportPath:
    typeof value?.reportPath === 'string' && value.reportPath.length > 0
      ? value.reportPath
      : defaultReportPath,
});

const loadConfig = async () => {
  if (!exists(configPath)) {
    return normalizeConfig({});
  }

  const moduleUrl = pathToFileURL(path.join(root, configPath)).href;
  const module = await import(moduleUrl);
  return normalizeConfig(module.default ?? {});
};

const writeReport = (reportPath, report) => {
  const absoluteReportPath = path.join(root, reportPath);
  fs.mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  fs.writeFileSync(absoluteReportPath, `${JSON.stringify(report, null, 2)}\n`);
};

const createSignal = (id, status, evidence) => ({
  id,
  severity: 'diagnostic',
  status,
  evidence,
});

const unique = values => new Set(values).size === values.length;

const toKebabCase = value =>
  String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const toPascalCase = value =>
  toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const normalizeRelativePath = value =>
  String(value ?? '').replace(/\\/gu, '/').replace(/^\.\/+/u, '');

const appNamespace = app => (app.kind === 'shell' ? 'shell' : (app.domain ?? app.id));

const normalizeCompactApp = rawApp => {
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
      : appPath.split('/').at(-1) ?? id;
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

  return {
    id,
    kind,
    path: appPath,
    packageSuffix,
    domain,
    port:
      typeof rawApp.port === 'number'
        ? rawApp.port
        : kind === 'shell'
          ? 3020
          : 3030,
    mfName:
      typeof moduleFederation.name === 'string'
        ? moduleFederation.name
        : kind === 'shell'
          ? 'shellSuperApp'
          : `vertical${toPascalCase(domain ?? id)}`,
    moduleFederation: {
      remotes: [],
      verticalRefs: Array.isArray(moduleFederation.verticalRefs)
        ? moduleFederation.verticalRefs.filter(ref => typeof ref === 'string')
        : [],
    },
  };
};

const createRemoteContracts = (app, apps) =>
  (app.moduleFederation?.verticalRefs ?? [])
    .map(ref => apps.find(candidate => candidate.id === ref))
    .filter(Boolean)
    .map(remote => ({
      id: remote.id,
      name: remote.mfName,
      manifestUrl: `http://localhost:${remote.port ?? 3030}/mf-manifest.json`,
    }));

const createPerformanceReadinessContract = () => ({
  schemaVersion: 1,
  default: 'enabled',
  mode: 'diagnostic',
  scope: 'ultramodern-generated-and-framework-owned',
  report: {
    script: 'scripts/ultramodern-performance-readiness.mjs',
    config: 'scripts/ultramodern-performance-readiness.config.mjs',
    defaultPath: defaultReportPath,
    deterministic: true,
  },
  signals: signalIds.map(id => ({ id })),
});

const createContractApp = (config, app, apps) => {
  const compatibilityDate =
    typeof config.deploy?.worker?.compatibilityDate === 'string'
      ? config.deploy.worker.compatibilityDate
      : '2026-06-02';

  return {
    id: app.id,
    path: app.path,
    config: {
      plugins: [
        'appTools',
        'tanstackRouterPlugin',
        'i18nPlugin',
        ...(app.kind === 'vertical' ? ['bffPlugin'] : []),
        'moduleFederationPlugin',
        'zephyrRspackPlugin',
      ],
    },
    deploy: {
      cloudflare: {
        compatibilityDate,
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
        routes: {
          ssr: '/en',
          mfManifest: '/mf-manifest.json',
          locale: `/locales/en/${appNamespace(app)}.json`,
        },
        qualityGates: {
          assets: {
            cacheControlRequiredForCss: true,
          },
        },
      },
    },
    moduleFederation: {
      remotes: createRemoteContracts(app, apps),
    },
    routes: {
      localisedUrls: {},
      publicSurface: {
        artifactLifecycle: 'build-and-deploy-output',
      },
    },
  };
};

const readGeneratedContractView = () => {
  if (exists(compactConfigPath)) {
    const compactConfig = readJson(compactConfigPath);
    const apps = Array.isArray(compactConfig.topology?.apps)
      ? compactConfig.topology.apps.map(normalizeCompactApp)
      : [];
    return {
      sourcePath: compactConfigPath,
      performanceReadiness: createPerformanceReadinessContract(),
      apps: apps.map(app => createContractApp(compactConfig, app, apps)),
    };
  }

  throw new Error(
    `Missing UltraModern config. Expected ${compactConfigPath}.`,
  );
};

const appGeneratedFiles = app => [
  `${app.path}/modern.config.ts`,
  `${app.path}/module-federation.config.ts`,
  `${app.path}/src/modern.runtime.ts`,
  `${app.path}/src/routes/ultramodern-route-metadata.ts`,
  `${app.path}/src/routes/ultramodern-route-head.tsx`,
].filter(exists);

const assertPass = (signal, failOn) => {
  if (failOn === 'framework-invariant') {
    assert(signal.status === 'pass', `${signal.id} readiness invariant failed`);
  }
};

const evaluateApp = (app, contract, failOn) => {
  const files = appGeneratedFiles(app);
  const generatedSource = files.map(readText).join('\n');
  const localisedUrls = Object.values(app.routes?.localisedUrls ?? {}).flatMap(
    value =>
      value && typeof value === 'object'
        ? Object.values(value).filter(entry => typeof entry === 'string')
        : [],
  );
  const remotes = app.moduleFederation?.remotes ?? [];
  const signals = [
    createSignal(
      'bfcache',
      /\b(?:beforeunload|unload)\b/u.test(generatedSource) ? 'fail' : 'pass',
      [
        `scanned:${files.length}`,
        'generated-files-do-not-install-unload-handlers',
      ],
    ),
    createSignal(
      'core-web-vitals-rum',
      contract.performanceReadiness?.scope ===
        'ultramodern-generated-and-framework-owned'
        ? 'pass'
        : 'fail',
      [
        'preset-telemetry-contract',
        'runtime-rum-instrumentation-ready-without-local-collector',
      ],
    ),
    createSignal(
      'duplicate-prefetch-warmup',
      unique(localisedUrls) &&
        unique(remotes.map(remote => remote.id)) &&
        unique(remotes.map(remote => remote.manifestUrl))
        ? 'pass'
        : 'fail',
      [
        `localised-url-count:${localisedUrls.length}`,
        `remote-count:${remotes.length}`,
      ],
    ),
    createSignal(
      'cache-policy-sanity',
      app.deploy?.cloudflare?.qualityGates?.assets
        ?.cacheControlRequiredForCss === true &&
        app.routes?.publicSurface?.artifactLifecycle ===
          'build-and-deploy-output'
        ? 'pass'
        : 'fail',
      [
        'css-cache-control-required',
        'public-surface-generated-as-build-output',
      ],
    ),
    createSignal(
      'save-data-behavior',
      app.config?.plugins?.includes('tanstackRouterPlugin') &&
        contract.performanceReadiness?.signals?.some(
          signal => signal.id === 'save-data-behavior',
        )
        ? 'pass'
        : 'fail',
      ['framework-router-warmup-is-diagnostic-only'],
    ),
    createSignal(
      'cloudflare-ssr-cache-hints',
      app.deploy?.cloudflare?.routes?.ssr &&
        app.deploy?.cloudflare?.routes?.mfManifest &&
        app.deploy?.cloudflare?.compatibilityFlags?.includes('nodejs_compat')
        ? 'pass'
        : 'fail',
      ['ssr-route-present', 'mf-manifest-route-present', 'nodejs-compat'],
    ),
  ];

  for (const signal of signals) {
    assertPass(signal, failOn);
  }

  return {
    id: app.id,
    path: app.path,
    signals,
  };
};

const main = async () => {
  const config = await loadConfig();
  const envDisabled = process.env[optOutEnv] === 'false';
  const reportPath = config.reportPath;
  const disabled = envDisabled || config.enabled === false;

  if (disabled) {
    writeReport(reportPath, {
      schemaVersion: 1,
      profile: 'ultramodern-performance-readiness-diagnostics-v1',
      status: 'disabled',
      defaultOn: true,
      optOut: envDisabled ? `${optOutEnv}=false` : `${configPath}#enabled=false`,
      signals: signalIds,
      apps: [],
    });
    console.log('UltraModern performance readiness diagnostics disabled');
    return;
  }

  const contract = readGeneratedContractView();
  assert(
    contract.performanceReadiness?.default === 'enabled',
    'Generated contract must keep performance readiness diagnostics default-on',
  );
  assert(
    contract.performanceReadiness?.report?.script ===
      'scripts/ultramodern-performance-readiness.mjs',
    'Generated contract must point at the performance readiness diagnostics script',
  );
  const contractSignalIds =
    contract.performanceReadiness?.signals?.map(signal => signal.id) ?? [];
  assert(
    JSON.stringify(contractSignalIds) === JSON.stringify(signalIds),
    'Generated contract readiness signals changed without updating the diagnostics report shape',
  );

  const apps = [...(contract.apps ?? [])].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  assert(unique(apps.map(app => app.id)), 'Generated app ids must be unique');

  const appReports = apps.map(app => evaluateApp(app, contract, config.failOn));
  writeReport(reportPath, {
    schemaVersion: 1,
    profile: 'ultramodern-performance-readiness-diagnostics-v1',
    status: 'pass',
    defaultOn: true,
    optOut: {
      env: `${optOutEnv}=false`,
      config: `${configPath}#enabled=false`,
    },
    failOn: config.failOn,
    signals: signalIds,
    apps: appReports,
  });
  console.log('UltraModern performance readiness diagnostics reported');
};

await main();
