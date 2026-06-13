import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const defaultReportPath =
  '.codex/reports/performance-readiness/ultramodern-performance-readiness.json';
const configPath = 'scripts/ultramodern-performance-readiness.config.mjs';
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

  const contract = readJson('.modernjs/ultramodern-generated-contract.json');
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
