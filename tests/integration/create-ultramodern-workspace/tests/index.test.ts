import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(__dirname, '../../../../');
const createBin = path.resolve(repoRoot, 'packages/toolkit/create/bin/run.js');
const createPackageDir = path.resolve(repoRoot, 'packages/toolkit/create');
const codeToolsPackageDir = path.resolve(
  repoRoot,
  'packages/toolkit/code-tools',
);
const testFrameworkVersion = '3.2.0-ultramodern.108';
const testTypescriptVersion = '6.0.3';
const frameworkVersionEnv = 'MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION';
const bleedingDevAliases = {
  '@modern-js/create': '@bleedingdev/modern-js-create',
  '@modern-js/code-tools': '@bleedingdev/modern-js-code-tools',
  '@modern-js/app-tools': '@bleedingdev/modern-js-app-tools',
  '@modern-js/plugin-bff': '@bleedingdev/modern-js-plugin-bff',
  '@modern-js/plugin-i18n': '@bleedingdev/modern-js-plugin-i18n',
  '@modern-js/plugin-tanstack': '@bleedingdev/modern-js-plugin-tanstack',
  '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
};

function expectedBleedingDevSpecifier(
  packageName: string,
  version = testFrameworkVersion,
) {
  const unscopedName = packageName.split('/').at(-1);
  return `npm:@bleedingdev/modern-js-${unscopedName}@${version}`;
}

function differentUltramodernVersion(version: string) {
  const match = /^(\d+\.\d+\.\d+-ultramodern\.)(\d+)$/u.exec(version);
  if (!match) {
    throw new Error(`Unexpected UltraModern test version ${version}`);
  }
  return `${match[1]}${Number(match[2]) + 1}`;
}

function expectBleedingDevModernDependency(
  packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
  section: 'dependencies' | 'devDependencies',
  packageName: string,
  version?: string,
) {
  expect(packageJson[section]?.[packageName]).toBe(
    expectedBleedingDevSpecifier(packageName, version),
  );
}

function runCreate(projectDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, projectDir, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      [frameworkVersionEnv]: testFrameworkVersion,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function runCreateInWorkspace(workspaceDir: string, args: string[]) {
  execFileSync(process.execPath, [createBin, ...args], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      [frameworkVersionEnv]: testFrameworkVersion,
      FORCE_COLOR: '0',
    },
    stdio: 'pipe',
  });
}

function generatedToolEnv(env: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    ULTRAMODERN_CREATE_BIN: createBin,
    ...env,
  };
}

function readText(root: string, relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8');
}

function readJson<T = any>(root: string, relativePath: string): T {
  return JSON.parse(readText(root, relativePath));
}

function runPerformanceReadiness(
  workspaceDir: string,
  env: Record<string, string> = {},
) {
  return execFileSync(
    process.execPath,
    ['scripts/ultramodern-performance-readiness.mts'],
    {
      cwd: workspaceDir,
      env: {
        ...generatedToolEnv(),
        ...env,
      },
      stdio: 'pipe',
    },
  ).toString();
}

function expectDedicatedAssetPrefixExpression(modernConfig: string) {
  const assetPrefixMatch = modernConfig.match(
    /const\s+assetPrefix\s*=\s*(?<expression>[\s\S]*?);/u,
  );
  expect(assetPrefixMatch?.groups?.expression).toBeDefined();
  const assetPrefixExpression = assetPrefixMatch?.groups?.expression ?? '';
  expect(assetPrefixExpression).toContain(
    'configuredModernAssetPrefix || configuredUltramodernAssetPrefix || defaultAssetPrefix',
  );
  expect(assetPrefixExpression).not.toMatch(
    /configuredSiteUrl|MODERN_PUBLIC_SITE_URL|configuredCloudflareUrl|inferredCloudflareUrl/u,
  );
}

function readPnpmConfig<T = any>(root: string, key: string): T | undefined {
  const env = { ...process.env };
  for (const envKey of Object.keys(env)) {
    if (/^(?:npm|pnpm)_config_/i.test(envKey)) {
      delete env[envKey];
    }
  }
  const output = execFileSync('pnpm', ['config', 'get', key, '--json'], {
    cwd: root,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : undefined;
}

function writeText(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function linkModernPackage(
  projectDir: string,
  name: string,
  packageDir: string,
) {
  const scopeDir = path.join(projectDir, 'node_modules/@modern-js');
  const packageLink = path.join(scopeDir, name);
  fs.mkdirSync(scopeDir, { recursive: true });
  if (!fs.existsSync(packageLink)) {
    fs.symlinkSync(packageDir, packageLink, 'dir');
  }
}

function linkWorkspaceToolPackages(projectDir: string) {
  linkModernPackage(projectDir, 'create', createPackageDir);
  linkModernPackage(projectDir, 'code-tools', codeToolsPackageDir);
}

function expectPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(true);
}

function expectNoPath(root: string, relativePath: string) {
  expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
}

function expectPnpm11OrNewerPackageManager(packageManager: unknown): string {
  expect(typeof packageManager).toBe('string');
  const match = /^pnpm@(\d+)\.(\d+)\.(\d+)$/u.exec(String(packageManager));
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeGreaterThanOrEqual(11);
  return `${match?.[1]}.${match?.[2]}.${match?.[3]}`;
}

function expectPnpm11Policy(workspaceDir: string) {
  expect(readPnpmConfig(workspaceDir, 'packages')).toEqual([
    'apps/*',
    'verticals/*',
    'packages/*',
  ]);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAge')).toBe(1440);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAgeStrict')).toBe(true);
  expect(
    readPnpmConfig(workspaceDir, 'minimumReleaseAgeIgnoreMissingTime'),
  ).toBe(false);
  expect(readPnpmConfig(workspaceDir, 'minimumReleaseAgeExclude')).toEqual([
    '@bleedingdev/modern-js-*',
    '@tanstack/react-router',
    '@tanstack/router-core',
    'typescript',
    '@typescript/native-preview',
    '@typescript/native-preview-*',
    '@types/react',
    '@rsbuild/core',
    '@rsbuild/plugin-react',
    '@rsbuild/plugin-type-check',
    '@rspack/binding',
    '@rspack/binding-*',
    '@rspack/core',
    '@rspack/plugin-react-refresh',
    'ts-checker-rspack-plugin',
  ]);
  expect(readPnpmConfig(workspaceDir, 'peerDependencyRules')).toEqual({
    allowedVersions: {
      react: '>=19.0.0',
      '@module-federation/dts-plugin>typescript': testTypescriptVersion,
      '@module-federation/enhanced>typescript': testTypescriptVersion,
      '@module-federation/modern-js-v3>typescript': testTypescriptVersion,
      '@module-federation/rspack>typescript': testTypescriptVersion,
      'i18next>typescript': testTypescriptVersion,
    },
  });
  expect(readPnpmConfig(workspaceDir, 'overrides')).toEqual({
    '@tanstack/react-router': '1.170.16',
    '@tanstack/router-core': '1.171.13',
    'node-fetch': '^3.3.2',
  });
  expect(readPnpmConfig(workspaceDir, 'trustPolicy')).toBe('no-downgrade');
  expect(readPnpmConfig(workspaceDir, 'trustPolicyIgnoreAfter')).toBe(1440);
  expect(readPnpmConfig(workspaceDir, 'blockExoticSubdeps')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'engineStrict')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'pmOnFail')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'verifyDepsBeforeRun')).toBe('error');
  expect(readPnpmConfig(workspaceDir, 'strictDepBuilds')).toBe(true);
  expect(readPnpmConfig(workspaceDir, 'allowBuilds')).toEqual({
    '@swc/core': true,
    'core-js': true,
    esbuild: true,
    lefthook: true,
    'msgpackr-extract': true,
    sharp: true,
    workerd: true,
  });
  expect(readPnpmConfig(workspaceDir, 'onlyBuiltDependencies')).toBeUndefined();
}

function expectNoDirectEffectDependency(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}) {
  expect(packageJson.dependencies?.effect).toBeUndefined();
  expect(packageJson.devDependencies?.effect).toBeUndefined();
}

type CompactApp = {
  id: string;
  kind: 'shell' | 'vertical';
  path: string;
  package?: string;
  packageSuffix: string;
  domain?: string;
  port: number;
  portEnv: string;
  mfName: string;
  exposes: string[];
  verticalRefs: string[];
  moduleFederationSsr: boolean;
  routes?: Record<string, any>;
  api?: {
    stem: string;
    prefix: string;
    consumedBy: string[];
  };
};

const toKebabCase = (value: string) =>
  String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');

const toPascalCase = (value: string) =>
  toKebabCase(value)
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const toCamelCase = (value: string) => {
  const pascal = toPascalCase(value);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
};

const toEnvSegment = (value: string) =>
  toKebabCase(value).replace(/-/gu, '_').toUpperCase();

const normalizeRelativePath = (value: unknown) =>
  String(value ?? '')
    .replace(/\\/gu, '/')
    .replace(/^\.\/+/u, '');

const packageNameFor = (scope: string, suffix: string) => `@${scope}/${suffix}`;
const appNamespace = (app: CompactApp) =>
  app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
const tailwindPrefixDigitWords = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
] as const;
const tailwindPrefixFor = (app: CompactApp) =>
  app.kind === 'shell'
    ? 'shell'
    : String(app.domain ?? app.id)
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, '')
        .replace(/[0-9]/gu, digit => tailwindPrefixDigitWords[Number(digit)]);
const expectedChunkLoadingGlobal = (mfName: string) =>
  `__ULTRAMODERN_${mfName
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase()}_LOADED_CHUNKS__`;
const expectedWorkerName = (scope: string, packageSuffix: string) =>
  `${toKebabCase(scope)}-${packageSuffix}`.slice(0, 63);
const buildMarkerFor = (scope: string, app: CompactApp) =>
  crypto
    .createHash('sha256')
    .update(`${scope}:${app.packageSuffix}:${app.id}:0.1.0`)
    .digest('hex')
    .slice(0, 16);

function normalizeCompactApp(rawApp: Record<string, any>): CompactApp {
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
          consumedBy: Array.isArray(rawApp.api.consumedBy)
            ? rawApp.api.consumedBy.filter(
                (consumer: unknown): consumer is string =>
                  typeof consumer === 'string',
              )
            : ['shell-super-app', id],
        }
      : undefined;

  return {
    id,
    kind,
    path: appPath,
    package: typeof rawApp.package === 'string' ? rawApp.package : undefined,
    packageSuffix,
    domain,
    port:
      typeof rawApp.port === 'number'
        ? rawApp.port
        : kind === 'shell'
          ? 3020
          : 3030,
    portEnv:
      typeof rawApp.portEnv === 'string'
        ? rawApp.portEnv
        : kind === 'shell'
          ? 'SHELL_SUPER_APP_PORT'
          : `VERTICAL_${toEnvSegment(domain ?? id)}_PORT`,
    mfName:
      typeof moduleFederation.name === 'string'
        ? moduleFederation.name
        : kind === 'shell'
          ? 'shellSuperApp'
          : `vertical${toPascalCase(domain ?? id)}`,
    exposes: Array.isArray(moduleFederation.exposes)
      ? moduleFederation.exposes.filter(
          (expose: unknown): expose is string => typeof expose === 'string',
        )
      : [],
    verticalRefs: Array.isArray(moduleFederation.verticalRefs)
      ? moduleFederation.verticalRefs.filter(
          (ref: unknown): ref is string => typeof ref === 'string',
        )
      : [],
    moduleFederationSsr: moduleFederation.ssr !== false,
    routes:
      rawApp.routes && typeof rawApp.routes === 'object'
        ? rawApp.routes
        : undefined,
    api,
  };
}

function compactAppsFromConfig(config: Record<string, any>) {
  return Array.isArray(config.topology?.apps)
    ? config.topology.apps.map((app: Record<string, any>) =>
        normalizeCompactApp(app),
      )
    : [];
}

function remoteDependencyAliasFor(app: CompactApp) {
  return toCamelCase(app.domain ?? app.id.replace(/^remote-/u, ''));
}

function remoteContractsFor(app: CompactApp, apps: CompactApp[]) {
  return app.verticalRefs
    .map(ref => apps.find(candidate => candidate.id === ref))
    .filter((remote): remote is CompactApp => Boolean(remote))
    .map(remote => ({
      id: remote.id,
      alias: remoteDependencyAliasFor(remote),
      name: remote.mfName,
      manifestEnv: `VERTICAL_${toEnvSegment(remote.domain ?? remote.id)}_MF_MANIFEST`,
      manifestUrl: `http://localhost:${remote.port}/mf-manifest.json`,
    }));
}

function createRouteOwnedEntries(app: CompactApp) {
  const namespace = appNamespace(app);
  return [
    {
      canonicalPath: '/',
      descriptionKey: `${namespace}.seo.description`,
      id: app.kind === 'shell' ? 'shell-home' : `${app.id}-home`,
      indexable: false,
      localisedPaths: {
        cs: '/',
        en: '/',
      },
      mfBoundaryId: app.mfName,
      namespace,
      ownerAppId: app.id,
      public: false,
      publicSurface: 'private-app-screen',
      titleKey: app.kind === 'shell' ? 'shell.title' : `${namespace}.title`,
    },
  ];
}

function createPublicRoutes(app: CompactApp) {
  return createRouteOwnedEntries(app)
    .filter(route => route.public && route.indexable)
    .map(route => ({
      canonicalPath: route.canonicalPath,
      descriptionKey: route.descriptionKey,
      id: route.id,
      localisedPaths: route.localisedPaths,
      namespace: route.namespace,
      ownerAppId: route.ownerAppId,
      titleKey: route.titleKey,
    }));
}

function createLocalisedUrls(app: CompactApp) {
  return Object.fromEntries(
    createRouteOwnedEntries(app).flatMap(route => {
      if (route.canonicalPath === '/') {
        return [];
      }
      return Array.from(
        new Set([route.canonicalPath, ...Object.values(route.localisedPaths)]),
      ).map(pathname => [pathname, route.localisedPaths]);
    }),
  );
}

function createPublicSurface(app: CompactApp) {
  const publicRoutes = createPublicRoutes(app);
  const basePublicSurface = {
    artifactLifecycle: 'build-and-deploy-output',
    authoring: 'colocated-route-meta',
    cloudflareOutputRoot: '.output/public',
    concreteUrlPaths: [],
    contentExpansion: {
      authoring: 'route-owned-esm-provider',
      defaultProviderFile: 'route.sitemap.mjs',
      draftPolicy: 'omit-draft-by-default',
      entryExport: 'default-or-entries',
      indexablePolicy: 'omit-indexable-false',
      lifecycle: 'executed-during-public-surface-generation',
      paramsSource: 'params-or-localeParams',
    },
    contentSources: [],
    files:
      publicRoutes.length > 0
        ? ['robots.txt', 'sitemap.xml', 'site.webmanifest']
        : ['robots.txt'],
    generatedManifest: './src/routes/ultramodern-route-metadata',
    generator: 'scripts/generate-public-surface-assets.mts',
    languages: ['en', 'cs'],
    metadataExport: './src/routes/ultramodern-route-metadata',
    omittedByDefault: ['api-catalog.json', 'llms.txt', 'security.txt'],
    outputRoot: 'dist/public',
    privateRoutePolicy: 'omit-from-generated-public-surface',
    publicRoutes,
    routeEntries: [],
    source: 'route-owned-public-routes',
  };

  return app.routes?.publicSurface &&
    typeof app.routes.publicSurface === 'object'
    ? {
        ...basePublicSurface,
        ...app.routes.publicSurface,
      }
    : basePublicSurface;
}

function createPublicHead() {
  return {
    alternates: {
      hreflang: ['en', 'cs'],
      xDefault: 'en',
    },
    authoring: 'colocated-route-meta',
    canonical: {
      publicIndexableOnly: true,
      source: 'localized canonical route URL',
    },
    description: {
      required: true,
      source: 'route.descriptionKey',
    },
    generator: './src/routes/ultramodern-route-head',
    openGraph: {
      publicIndexableOnly: true,
      required: ['og:title', 'og:description', 'og:url', 'og:type'],
    },
    privateRouteRobots: 'noindex, nofollow',
    renderer: '@modern-js/runtime/head Helmet',
    ssr: true,
    structuredData: {
      helperModule: './src/routes/ultramodern-jsonld',
      helperTypes: [
        'WebPage',
        'WebApplication',
        'SoftwareApplication',
        'BreadcrumbList',
        'FAQPage',
        'Organization',
      ],
      inference: false,
      optional: true,
      publicIndexableOnly: true,
      sanitizesHtmlOpenBracket: true,
      source: 'route.jsonLd',
    },
    title: {
      required: true,
      source: 'route.titleKey',
    },
    twitter: {
      publicIndexableOnly: true,
      required: ['twitter:card', 'twitter:title', 'twitter:description'],
    },
  };
}

function createCloudflareSecurity() {
  return {
    contentSecurityPolicy: {
      directives: {
        'base-uri': ["'self'"],
        'connect-src': ["'self'", 'https:', 'http:', 'wss:', 'ws:'],
        'default-src': ["'self'"],
        'font-src': ["'self'", 'data:', 'https:', 'http:'],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        'manifest-src': ["'self'", 'https:', 'http:'],
        'object-src': ["'none'"],
        'script-src': [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https:',
          'http:',
          'blob:',
        ],
        'style-src': ["'self'", "'unsafe-inline'", 'https:', 'http:'],
        'worker-src': ["'self'", 'blob:'],
      },
      mode: 'report-only',
      reason:
        'Report-only by default so Cloudflare Module Federation SSR can prove remote script, style, and connect compatibility before enforcement.',
    },
    enabled: true,
    headers: {
      contentTypeOptions: 'nosniff',
      permissionsPolicy:
        'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      referrerPolicy: 'strict-origin-when-cross-origin',
    },
    noindex: {
      localhost: true,
      previewHostnames: [],
      workersDev: true,
    },
  };
}

function createQualityGates() {
  return {
    assets: {
      cacheControlRequiredForCss: true,
      cssPreloadRequired: true,
      cssResponseRequired: true,
      sourcemapsPubliclyReferenced: false,
    },
    budgets: {
      cssAssetMaxBytes: 750_000,
      localeJsonMaxBytes: 100_000,
      mfManifestMaxBytes: 500_000,
      sitemapXmlMaxBytes: 500_000,
      ssrHtmlMaxBytes: 250_000,
    },
    csp: {
      decision:
        'Report-only remains the generated final mode until public smoke proof records MF SSR script/style/connect compatibility for the deployed surface.',
      finalMode: 'report-only-dogfood',
    },
    indexing: {
      previewNoindex: true,
      productionPublicRoutesIndexable: true,
    },
    publicRoutes: {
      requireRobotsSitemapConsistency: true,
      requireSitemapWhenPresent: true,
      requireWebManifestWhenPresent: true,
    },
    statusCodes: {
      notFoundRoute: '/__ultramodern-smoke-missing/nope',
      unknownRouteStatus: 404,
    },
  };
}

function createCloudflareRoutes(app: CompactApp) {
  return {
    locale: `/locales/en/${appNamespace(app)}.json`,
    mfManifest: '/mf-manifest.json',
    ssr: '/en',
    ...(app.api
      ? {
          apiReadiness: `${app.api.prefix}/${app.api.stem}/readiness`,
        }
      : {}),
  };
}

function createCloudflareDeploy(scope: string, app: CompactApp) {
  return {
    assetsBinding: 'ASSETS',
    compatibilityDate: '2026-06-02',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    evidence: {
      proofScript: 'scripts/proof-cloudflare-version.mts',
      reportDefault:
        '.codex/reports/cloudflare-version-proof/public-url-proof.json',
    },
    publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
    qualityGates: createQualityGates(),
    routes: createCloudflareRoutes(app),
    security: createCloudflareSecurity(),
    target: 'cloudflare',
    workerName: expectedWorkerName(scope, app.packageSuffix),
  };
}

function createAppConfigContract(app: CompactApp) {
  return {
    dev: {
      assetPrefix: '/',
    },
    html: {
      outputStructure: 'flat',
    },
    output: {
      assetPrefix: {
        default: app.kind === 'shell' ? '/' : 'app-public-origin',
        envFallbackOrder: ['MODERN_ASSET_PREFIX', 'ULTRAMODERN_ASSET_PREFIX'],
      },
      disableTsChecker: false,
      distPath: {
        html: './',
      },
      polyfill: 'off',
      splitRouteChunks: true,
    },
    performance: {
      readinessDiagnostics: {
        default: 'enabled',
        failOn: 'framework-invariant',
        optOut: {
          config: 'scripts/ultramodern-performance-readiness.config.mjs',
          env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
        },
        report:
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
      },
    },
    plugins: [
      'appTools',
      'tanstackRouterPlugin',
      'i18nPlugin',
      ...(app.api ? ['bffPlugin'] : []),
      'moduleFederationPlugin',
      'zephyrRspackPlugin',
    ],
    preset: 'presetUltramodern',
    rspack: {
      output: {
        chunkLoadingGlobal: expectedChunkLoadingGlobal(app.mfName),
        uniqueName: app.mfName,
      },
    },
    source: {
      mainEntryName: 'index',
      siteUrl: {
        defaultLocalhostPort: app.port,
        envFallbackOrder: [
          'MODERN_PUBLIC_SITE_URL',
          `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
          'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
          app.portEnv,
        ],
      },
      siteUrlGlobal: 'ULTRAMODERN_SITE_URL',
    },
    ...(app.api
      ? {
          bff: {
            openapi: '/openapi.json',
            prefix: app.api.prefix,
            runtimeFramework: 'effect',
          },
        }
      : {}),
  };
}

function cssDedupe(scope: string) {
  return {
    duplicateBaseStylesAllowed: false,
    runtimeLoad: 'once-per-content-hash',
    sharedLayers: ['ultramodern-shared-tokens'],
    sharedPackage: packageNameFor(scope, 'shared-design-tokens'),
    strategy: 'shared-token-package-plus-css-content-hash',
  };
}

function createStylingContract(scope: string, app: CompactApp) {
  const sharedTokenPackage = packageNameFor(scope, 'shared-design-tokens');
  const ownedLayers =
    app.kind === 'shell'
      ? ['ultramodern-shell-base', 'ultramodern-shell-overlay']
      : [`ultramodern-vertical-${app.domain ?? app.id}`];

  return {
    federation: {
      assets: {
        contentHash: true,
        emittedBy: 'modern-rspack-css-extraction',
        owned: ['src/routes/index.css'],
        shared: [`${sharedTokenPackage}/tokens.css`],
      },
      dedupe: cssDedupe(scope),
      entrypoints: {
        css: ['src/routes/index.css'],
        layoutImport: 'src/routes/layout.tsx',
        ...(app.kind === 'shell'
          ? {}
          : { federationEntry: 'src/federation-entry.tsx' }),
      },
      layers: {
        owned: ownedLayers,
        shared: ['ultramodern-shared-tokens'],
      },
      owner: {
        id: app.id,
        package: app.package ?? packageNameFor(scope, app.packageSuffix),
      },
      role: app.kind === 'shell' ? 'shell-base-overlay' : 'vertical-css',
      rootSelector: `[data-app-id="${app.id}"]`,
      ssr: {
        cloudflare: true,
        firstPaintRequired: true,
        verticalCss:
          app.kind === 'shell'
            ? 'host-preloads-shell-and-shared-css'
            : 'federated-manifest-owned-css',
      },
      classPrefix: `${tailwindPrefixFor(app)}:`,
    },
    postcssPlugins: ['@tailwindcss/postcss'],
    tailwind: true,
  };
}

function createApiContract(app: CompactApp) {
  if (!app.api) {
    return undefined;
  }
  const stem = app.api.stem;
  return {
    client: './api/client',
    contract: './api',
    domainOperations: {
      workspaceCreate: {
        client: `create${toPascalCase(stem)}`,
        method: 'POST',
        owner: app.id,
        path: `/${stem}`,
        resource: toCamelCase(stem),
      },
      workspaceDetail: {
        client: `get${toPascalCase(stem)}`,
        method: 'GET',
        owner: app.id,
        path: `/${stem}/:id`,
        resource: 'workspace-item',
      },
      workspaceFeed: {
        client: `list${toPascalCase(stem)}`,
        method: 'GET',
        owner: app.id,
        path: `/${stem}`,
        resource: 'workspace-items',
      },
    },
    group: toCamelCase(stem),
    import: '@modern-js/plugin-bff/effect-edge',
    openapi: '/openapi.json',
    operations: {
      readiness: {
        method: 'GET',
        path: `/${stem}/readiness`,
        source: 'generated-client',
      },
    },
    prefix: app.api.prefix,
    readiness: {
      checks: ['moduleFederation', 'ssr', 'translations', 'api'],
      endpoint: `/${stem}/readiness`,
      marker: {
        api: 'ultramodernApiMarker',
        skew: 'none',
        ui: 'ultramodernUiMarker',
      },
    },
    requestContext: {
      propagatedHeaders: [
        'accept-language',
        'authorization',
        'traceparent',
        'x-correlation-id',
        'x-tenant-id',
        'x-ultramodern-env',
        'x-vertical-version-id',
      ],
      source: 'shell-to-vertical-api-client',
    },
    runtime: 'effect',
    strictEffectApproach: true,
    workerEntry: 'worker/__modern_bff_effect.js',
  };
}

function createAppContract(scope: string, app: CompactApp, apps: CompactApp[]) {
  return {
    api: createApiContract(app),
    config: createAppConfigContract(app),
    deploy: {
      cloudflare: createCloudflareDeploy(scope, app),
      target: 'cloudflare',
      worker: {
        compatibilityDate: '2026-06-02',
        name: expectedWorkerName(scope, app.packageSuffix),
        security: createCloudflareSecurity(),
        ssr: true,
      },
    },
    i18n: {
      backend: {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      languages: ['en', 'cs'],
      localisedUrls: createLocalisedUrls(app),
      namespace: appNamespace(app),
      namespaces: [appNamespace(app), 'translation'],
      resourceOwnership: {
        ownerAppId: app.id,
        source: 'route-owned',
      },
    },
    id: app.id,
    kind: app.kind,
    marker: {
      appId: app.id,
      apiSurface: app.api ? 'api' : undefined,
      build: buildMarkerFor(scope, app),
      deployProfile: 'cloudflare-ssr-mf-effect-v1',
      packageName: app.package ?? packageNameFor(scope, app.packageSuffix),
      uiSurface: 'ui',
      version: '0.1.0',
    },
    moduleFederation: {
      browserSafeExposesOnly: true,
      dts: {
        compilerInstance: 'tsgo',
        displayErrorInTerminal: true,
        tsConfigPath: './tsconfig.mf-types.json',
      },
      exposes: app.exposes,
      name: app.mfName,
      ...(app.verticalRefs.length
        ? {
            remotes: remoteContractsFor(app, apps),
            verticalRefs: app.verticalRefs,
          }
        : {}),
    },
    package: app.package ?? packageNameFor(scope, app.packageSuffix),
    path: app.path,
    routes: {
      generatedManifest: true,
      generatedRouteMap: true,
      localisedUrls: createLocalisedUrls(app),
      metadataAuthoring: 'colocated-route-meta',
      metadataExport: './src/routes/ultramodern-route-metadata',
      owned: createRouteOwnedEntries(app),
      privateByDefault: true,
      publicHead: createPublicHead(),
      publicRoutes: createPublicRoutes(app),
      publicSurface: createPublicSurface(app),
      publicnessDefault: 'private-app-screen',
      source: 'route-owned',
    },
    ssr: app.moduleFederationSsr
      ? {
          mode: 'string',
          moduleFederationAppSSR: true,
        }
      : undefined,
    styling: createStylingContract(scope, app),
  };
}

function readGeneratedContract(workspaceDir: string) {
  const config = readJson<Record<string, any>>(
    workspaceDir,
    '.modernjs/ultramodern.json',
  );
  const scope = config.workspace?.packageScope ?? path.basename(workspaceDir);
  const apps = compactAppsFromConfig(config);
  return {
    apps: apps.map(app => createAppContract(scope, app, apps)),
    cssFederation: {
      sharedDesignTokens: {
        assets: {
          exports: ['./tokens.css'],
        },
        classPrefix: '--um-',
        dedupe: cssDedupe(scope),
        entrypoints: {
          css: ['packages/shared-design-tokens/src/tokens.css'],
        },
        layers: {
          owned: ['ultramodern-shared-tokens'],
        },
        owner: {
          id: 'shared-design-tokens',
          package: packageNameFor(scope, 'shared-design-tokens'),
        },
        role: 'shared-design-tokens',
        rootSelector: ':root',
        ssr: {
          firstPaintRequired: true,
        },
      },
    },
    node: {
      engineRange: '>=26',
      version: config.workspace?.node?.version ?? '26.3.0',
    },
    performanceReadiness: {
      default: 'enabled',
      mode: 'diagnostic',
      optOut: {
        env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
      },
      report: {
        config: 'scripts/ultramodern-performance-readiness.config.mjs',
        defaultPath:
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        deterministic: true,
        script: 'scripts/ultramodern-performance-readiness.mts',
      },
      scope: 'ultramodern-generated-and-framework-owned',
      signals: [
        'bfcache',
        'core-web-vitals-rum',
        'duplicate-prefetch-warmup',
        'cache-policy-sanity',
        'save-data-behavior',
        'cloudflare-ssr-cache-hints',
      ].map(id => ({ id })),
    },
    profile: config.profile ?? 'cloudflare-ssr-mf-effect-v1',
    schemaVersion: 1,
  };
}

function getGeneratedAppContract(workspaceDir: string, appId: string) {
  const contractEntry = readGeneratedContract(workspaceDir).apps.find(
    app => app.id === appId,
  );
  expect(contractEntry).toBeDefined();
  return contractEntry!;
}

function expectPrivatePublicSurface(
  workspaceDir: string,
  appPath: string,
  routes: Record<string, any>,
) {
  expect(Object.keys(routes.publicSurface).sort()).toEqual(
    [
      'artifactLifecycle',
      'authoring',
      'cloudflareOutputRoot',
      'concreteUrlPaths',
      'contentExpansion',
      'contentSources',
      'files',
      'generatedManifest',
      'generator',
      'languages',
      'metadataExport',
      'omittedByDefault',
      'outputRoot',
      'privateRoutePolicy',
      'publicRoutes',
      'routeEntries',
      'source',
    ].sort(),
  );
  expect(routes.publicSurface).toMatchObject({
    authoring: 'colocated-route-meta',
    artifactLifecycle: 'build-and-deploy-output',
    generatedManifest: './src/routes/ultramodern-route-metadata',
    source: 'route-owned-public-routes',
    metadataExport: './src/routes/ultramodern-route-metadata',
    generator: 'scripts/generate-public-surface-assets.mts',
    outputRoot: 'dist/public',
    cloudflareOutputRoot: '.output/public',
    privateRoutePolicy: 'omit-from-generated-public-surface',
    files: ['robots.txt'],
    omittedByDefault: ['api-catalog.json', 'llms.txt', 'security.txt'],
    languages: ['en', 'cs'],
    contentExpansion: {
      authoring: 'route-owned-esm-provider',
      defaultProviderFile: 'route.sitemap.mjs',
      entryExport: 'default-or-entries',
      paramsSource: 'params-or-localeParams',
      draftPolicy: 'omit-draft-by-default',
      indexablePolicy: 'omit-indexable-false',
      lifecycle: 'executed-during-public-surface-generation',
    },
    contentSources: [],
    publicRoutes: [],
    routeEntries: [],
    concreteUrlPaths: [],
  });
  expect(Object.keys(routes.publicSurface.contentExpansion).sort()).toEqual(
    [
      'authoring',
      'defaultProviderFile',
      'draftPolicy',
      'entryExport',
      'indexablePolicy',
      'lifecycle',
      'paramsSource',
    ].sort(),
  );
  expect(routes.publicSurface.staticRoot).toBeUndefined();
  expectNoPath(workspaceDir, `${appPath}/config/public/robots.txt`);
  expectNoPath(workspaceDir, `${appPath}/config/public/sitemap.xml`);
  expectNoPath(workspaceDir, `${appPath}/config/public/site.webmanifest`);
  expectNoPath(workspaceDir, `${appPath}/config/public/llms.txt`);
  expectNoPath(
    workspaceDir,
    `${appPath}/config/public/.well-known/security.txt`,
  );
  expectNoPath(workspaceDir, `${appPath}/config/public/api-catalog.json`);
}

function readGeneratedJsonConst<T>(source: string, constName: string): T {
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = source.match(
    new RegExp(
      `(?:export\\s+)?const\\s+${escapedName}\\s*=\\s*([\\s\\S]*?)\\s+as const;`,
      'u',
    ),
  );
  if (!match?.[1]) {
    throw new Error(`Expected generated const ${constName}`);
  }
  return Function(`"use strict"; return (${match[1]});`)() as T;
}

function expectRouteMetadataCompatibility(
  workspaceDir: string,
  appPath: string,
  expected: {
    localisedUrls: Record<string, any>;
    namespace: string;
    publicRoutes: Array<Record<string, any>>;
    routes: Array<Record<string, any>>;
  },
) {
  const manifest = readText(
    workspaceDir,
    `${appPath}/src/routes/ultramodern-route-metadata.ts`,
  );
  expect(manifest).toContain('// @generated by @modern-js/create.');
  expect(manifest).toContain(
    '// Author route metadata in colocated src/routes/**/route.meta.ts files.',
  );
  expect(manifest).toContain(
    '// This compatibility manifest is regenerated from route-owned metadata.',
  );
  expect(manifest).toContain(
    `export const ultramodernRouteNamespace = '${expected.namespace}' as const;`,
  );
  expect(readGeneratedJsonConst(manifest, 'ultramodernRouteMetadata')).toEqual(
    expected.routes,
  );
  expect(readGeneratedJsonConst(manifest, 'ultramodernLocalisedUrls')).toEqual(
    expected.localisedUrls,
  );
  expect(readGeneratedJsonConst(manifest, 'ultramodernPublicRoutes')).toEqual(
    expected.publicRoutes,
  );
  expect(manifest).toContain("authoring: 'colocated-route-meta'");
  expect(manifest).toContain('generatedManifest: true');
  expect(manifest).toContain('localisedUrls: ultramodernLocalisedUrls');
  expect(manifest).toContain('publicRoutes: ultramodernPublicRoutes');
  expect(manifest).toContain('routes: ultramodernRouteMetadata');
  expect(manifest).toContain("source: 'route-owned'");

  const rootRouteMeta = readText(
    workspaceDir,
    `${appPath}/src/routes/[lang]/route.meta.ts`,
  );
  expect(readGeneratedJsonConst(rootRouteMeta, 'routeMeta')).toEqual(
    expected.routes[0],
  );
  expect(rootRouteMeta).toContain('export default routeMeta;');
  expect(rootRouteMeta).toContain('export { routeMeta };');
}

function expectAppConfigContract(
  contractEntry: {
    config: Record<string, any>;
    deploy?: Record<string, any>;
    moduleFederation: Record<string, any>;
    ssr?: Record<string, any>;
  },
  expected: {
    apiPrefix?: string;
    hasEffect?: boolean;
    publicUrlEnv: string;
    portEnv: string;
    port: number;
  },
) {
  const { publicUrlEnv, portEnv, port } = expected;
  expect(contractEntry.config).toMatchObject({
    preset: 'presetUltramodern',
    output: {
      disableTsChecker: false,
      distPath: {
        html: './',
      },
      polyfill: 'off',
      splitRouteChunks: true,
    },
    rspack: {
      output: {
        uniqueName: contractEntry.moduleFederation.name,
        chunkLoadingGlobal: `__ULTRAMODERN_${contractEntry.moduleFederation.name
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .toUpperCase()}_LOADED_CHUNKS__`,
      },
    },
    html: {
      outputStructure: 'flat',
    },
    performance: {
      readinessDiagnostics: {
        default: 'enabled',
        failOn: 'framework-invariant',
        optOut: {
          env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
          config: 'scripts/ultramodern-performance-readiness.config.mjs',
        },
        report:
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
      },
    },
    source: {
      mainEntryName: 'index',
      siteUrlGlobal: 'ULTRAMODERN_SITE_URL',
    },
  });
  expect(contractEntry.config.dev).toEqual({ assetPrefix: '/' });
  expect(contractEntry.config.output.assetPrefix).toEqual({
    envFallbackOrder: ['MODERN_ASSET_PREFIX', 'ULTRAMODERN_ASSET_PREFIX'],
    default: '/',
  });
  expect(contractEntry.config.source.siteUrl).toEqual({
    envFallbackOrder: [
      'MODERN_PUBLIC_SITE_URL',
      publicUrlEnv,
      'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
      portEnv,
    ],
    defaultLocalhostPort: port,
  });
  expect(contractEntry.config.plugins).toEqual(
    expected.hasEffect
      ? [
          'appTools',
          'tanstackRouterPlugin',
          'i18nPlugin',
          'bffPlugin',
          'moduleFederationPlugin',
          'zephyrRspackPlugin',
        ]
      : [
          'appTools',
          'tanstackRouterPlugin',
          'i18nPlugin',
          'moduleFederationPlugin',
          'zephyrRspackPlugin',
        ],
  );
  if (expected.hasEffect) {
    expect(contractEntry.config.bff).toMatchObject({
      runtimeFramework: 'effect',
      prefix: expected.apiPrefix,
      openapi: '/openapi.json',
    });
  } else {
    expect(contractEntry.config.bff).toBeUndefined();
  }
  expect(contractEntry.ssr).toMatchObject({
    mode: 'string',
    moduleFederationAppSSR: true,
  });
  expect(contractEntry.bundling).toBeUndefined();
}

function expectTailwindContract(contractEntry: {
  styling: Record<string, any>;
}) {
  expect(contractEntry.styling).toMatchObject({
    tailwind: true,
    postcssPlugins: ['@tailwindcss/postcss'],
  });
}

function expectCssFederationContract(
  generatedContract: { cssFederation: Record<string, any> },
  contractEntry: { id: string; styling: Record<string, any> },
  expected: {
    classPrefix: string;
    ownedLayers: string[];
    role: string;
    rootSelector: string;
    remote?: boolean;
  },
) {
  expect(generatedContract.cssFederation.sharedDesignTokens).toMatchObject({
    owner: {
      id: 'shared-design-tokens',
    },
    role: 'shared-design-tokens',
    rootSelector: ':root',
    classPrefix: '--um-',
    layers: {
      owned: ['ultramodern-shared-tokens'],
    },
    entrypoints: {
      css: ['packages/shared-design-tokens/src/tokens.css'],
    },
    assets: {
      exports: ['./tokens.css'],
    },
    dedupe: {
      duplicateBaseStylesAllowed: false,
      runtimeLoad: 'once-per-content-hash',
    },
    ssr: {
      firstPaintRequired: true,
    },
  });
  expect(contractEntry.styling.federation).toMatchObject({
    owner: {
      id: contractEntry.id,
    },
    role: expected.role,
    rootSelector: expected.rootSelector,
    classPrefix: expected.classPrefix,
    layers: {
      shared: ['ultramodern-shared-tokens'],
      owned: expected.ownedLayers,
    },
    entrypoints: {
      css: ['src/routes/index.css'],
    },
    assets: {
      owned: ['src/routes/index.css'],
      emittedBy: 'modern-rspack-css-extraction',
      contentHash: true,
    },
    dedupe: {
      duplicateBaseStylesAllowed: false,
      runtimeLoad: 'once-per-content-hash',
    },
    ssr: {
      cloudflare: true,
      firstPaintRequired: true,
    },
  });
  expect(contractEntry.styling.federation.assets.shared).toEqual([
    expect.stringMatching(/\/shared-design-tokens\/tokens\.css$/),
  ]);
  if (expected.remote) {
    expect(contractEntry.styling.federation.entrypoints.remoteEntry).toBe(
      'src/remote-entry.tsx',
    );
    expect(contractEntry.styling.federation.ssr.remoteCss).toBe(
      'remote-manifest-owned-css',
    );
  }
}

function envWithoutGeneratedPublicUrls(publicUrlEnvNames: string[]) {
  const env = { ...process.env };
  for (const publicUrlEnvName of publicUrlEnvNames) {
    delete env[publicUrlEnvName];
  }
  return env;
}

function normalizeUrlWithTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

function proofSecurityHeaders(
  app: ReturnType<typeof getGeneratedAppContract>,
  options: {
    contentType?: string;
    noindex?: boolean;
    cacheControl?: string;
    cors?: boolean;
    html?: boolean;
    status?: number;
  } = {},
) {
  const headers = app.deploy.cloudflare.security.headers;
  return {
    'access-control-allow-origin': options.cors ? '*' : undefined,
    'cache-control': options.cacheControl ?? 'public, max-age=60',
    'content-security-policy-report-only': options.html
      ? "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"
      : undefined,
    'content-type': options.contentType ?? 'text/plain; charset=utf-8',
    'permissions-policy': headers.permissionsPolicy,
    'referrer-policy': headers.referrerPolicy,
    'x-content-type-options': headers.contentTypeOptions,
    'x-robots-tag': options.noindex ? 'noindex, nofollow' : undefined,
  };
}

function proofResponse(
  app: ReturnType<typeof getGeneratedAppContract>,
  body: string,
  options: Parameters<typeof proofSecurityHeaders>[1] = {},
) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(
    proofSecurityHeaders(app, options),
  )) {
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(body, {
    headers,
    status: options.status ?? 200,
  });
}

function proofHtml(
  app: ReturnType<typeof getGeneratedAppContract>,
  publicUrl: string,
  route: string,
  options: {
    canonical?: boolean;
    indexable?: boolean;
  } = {},
) {
  const appId =
    app.styling.federation.rootSelector.match(/data-app-id="([^"]+)"/u)?.[1] ??
    app.id;
  const canonicalUrl = new URL(route, normalizeUrlWithTrailingSlash(publicUrl));
  const alternates = app.routes.publicHead?.alternates?.hreflang ?? [];
  return `<!doctype html>
<html>
  <head>
    <title>${app.id}</title>
    <meta name="description" content="${app.id} generated proof">
    <meta name="robots" content="${options.indexable ? 'index, follow' : 'noindex, nofollow'}">
    ${
      options.canonical
        ? `<link rel="canonical" href="${canonicalUrl}">
    ${alternates
      .map((language: string) => {
        const localePath =
          app.routes.publicSurface.routeEntries?.[0]?.localeUrlPaths?.[
            language
          ] ?? route;
        return `<link rel="alternate" hreflang="${language}" href="${new URL(
          localePath,
          normalizeUrlWithTrailingSlash(publicUrl),
        )}">`;
      })
      .join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${canonicalUrl}">
    <meta property="og:title" content="${app.id}">
    <meta property="og:description" content="${app.id}">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${app.id}">
    <meta name="twitter:description" content="${app.id}">
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>`
        : ''
    }
  </head>
  <body>
    <main data-app-id="${appId}">
      <span data-build-marker="${app.marker.build}"></span>
    </main>
  </body>
</html>`;
}

async function importGeneratedCloudflareProofHelper() {
  const helperUrl = pathToFileURL(
    path.join(
      repoRoot,
      'packages/toolkit/create/templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
    ),
  );
  return import(`${helperUrl.href}?proof-test=${Date.now()}-${Math.random()}`);
}

async function withGeneratedProofFetch<T>(
  app: ReturnType<typeof getGeneratedAppContract>,
  publicUrl: string,
  routes: Map<string, Response>,
  callback: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const isPreview = new URL(publicUrl).hostname.endsWith('.workers.dev');
  globalThis.fetch = (async input => {
    const url = new URL(String(input));
    const response = routes.get(url.pathname);
    if (!response) {
      return new Response('missing fake route', {
        status: 500,
        headers: proofSecurityHeaders(app, {
          contentType: 'text/plain',
          noindex: isPreview,
        }),
      });
    }
    return response.clone();
  }) as typeof fetch;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createGeneratedProofRoutes(
  app: ReturnType<typeof getGeneratedAppContract>,
  publicUrl: string,
  options: {
    publicSurface?: boolean;
  } = {},
) {
  const isPreview = new URL(publicUrl).hostname.endsWith('.workers.dev');
  const routes = app.deploy.cloudflare.routes ?? {};
  const ssrRoute = routes.ssr ?? '/en';
  const manifestRoute = routes.mfManifest ?? '/mf-manifest.json';
  const localeRoute = routes.locale ?? `/locales/en/${app.i18n.namespace}.json`;
  const notFoundRoute =
    app.deploy.cloudflare.qualityGates.statusCodes.notFoundRoute ??
    '/__ultramodern-smoke-missing/nope';
  const cssRoute = '/assets/generated-proof.css';
  const fakeRoutes = new Map<string, Response>();
  const publicRoute =
    app.routes.publicSurface.routeEntries?.[0]?.localeUrlPaths?.en ?? ssrRoute;

  fakeRoutes.set(
    ssrRoute,
    proofResponse(app, proofHtml(app, publicUrl, ssrRoute), {
      contentType: 'text/html; charset=utf-8',
      html: true,
      noindex: isPreview,
    }),
  );
  fakeRoutes
    .get(ssrRoute)!
    .headers.set('link', `<${cssRoute}>; rel=preload; as=style`);
  fakeRoutes.set(
    notFoundRoute,
    proofResponse(app, '<!doctype html><title>Not found</title>', {
      contentType: 'text/html; charset=utf-8',
      html: true,
      noindex: isPreview,
      status: app.deploy.cloudflare.qualityGates.statusCodes.unknownRouteStatus,
    }),
  );
  fakeRoutes.set(
    '/robots.txt',
    proofResponse(
      app,
      options.publicSurface
        ? `User-agent: *\nAllow: /\nSitemap: ${new URL(
            '/sitemap.xml',
            normalizeUrlWithTrailingSlash(publicUrl),
          )}\n`
        : 'User-agent: *\nDisallow: /\n',
      {
        contentType: 'text/plain; charset=utf-8',
        noindex: isPreview,
      },
    ),
  );
  fakeRoutes.set(
    cssRoute,
    proofResponse(app, '[data-app-id] { color: currentColor; }', {
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'text/css; charset=utf-8',
      noindex: isPreview,
    }),
  );
  fakeRoutes.set(
    manifestRoute,
    proofResponse(
      app,
      JSON.stringify({
        metaData: { publicPath: normalizeUrlWithTrailingSlash(publicUrl) },
        remoteEntry: 'remoteEntry.js',
      }),
      {
        contentType: 'application/json; charset=utf-8',
        cors: true,
        noindex: isPreview,
      },
    ),
  );
  fakeRoutes.set(
    localeRoute,
    proofResponse(app, JSON.stringify({ [app.i18n.namespace]: {} }), {
      contentType: 'application/json; charset=utf-8',
      cors: true,
      noindex: isPreview,
    }),
  );

  if (options.publicSurface) {
    fakeRoutes.set(
      publicRoute,
      proofResponse(
        app,
        proofHtml(app, publicUrl, publicRoute, {
          canonical: true,
          indexable: !isPreview,
        }),
        {
          contentType: 'text/html; charset=utf-8',
          html: true,
          noindex: isPreview,
        },
      ),
    );
    fakeRoutes.set(
      '/sitemap.xml',
      proofResponse(
        app,
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset>${app.routes.publicSurface.concreteUrlPaths
          .map(
            (urlPath: string) =>
              `<url><loc>${new URL(
                urlPath,
                normalizeUrlWithTrailingSlash(publicUrl),
              )}</loc></url>`,
          )
          .join('')}</urlset>`,
        {
          contentType: 'application/xml; charset=utf-8',
          noindex: isPreview,
        },
      ),
    );
    fakeRoutes.set(
      '/site.webmanifest',
      proofResponse(app, JSON.stringify({ name: app.id, start_url: '/' }), {
        contentType: 'application/manifest+json; charset=utf-8',
        noindex: isPreview,
      }),
    );
  }

  if (routes.apiReadiness) {
    fakeRoutes.set(
      routes.apiReadiness,
      proofResponse(
        app,
        JSON.stringify({ marker: { build: app.marker.build } }),
        {
          contentType: 'application/json; charset=utf-8',
          noindex: isPreview,
        },
      ),
    );
  }

  return fakeRoutes;
}

function withPublicProofSurface(
  app: ReturnType<typeof getGeneratedAppContract>,
) {
  const publicApp = structuredClone(app);
  publicApp.routes.publicSurface.publicRoutes = [
    {
      canonicalPath: '/proof-public',
      id: 'proof-public',
      ownerAppId: app.id,
    },
  ];
  publicApp.routes.publicSurface.routeEntries = [
    {
      localeUrlPaths: {
        en: '/en/proof-public',
        cs: '/cs/proof-public',
      },
    },
  ];
  publicApp.routes.publicSurface.concreteUrlPaths = [
    '/en/proof-public',
    '/cs/proof-public',
  ];
  publicApp.routes.publicSurface.files = [
    'robots.txt',
    'sitemap.xml',
    'site.webmanifest',
  ];
  return publicApp;
}

async function expectGeneratedCloudflareProofBehavior(
  workspaceDir: string,
  apps: Array<ReturnType<typeof getGeneratedAppContract>>,
) {
  const { validateApp } = await importGeneratedCloudflareProofHelper();

  for (const app of apps) {
    const privateUrl = `https://${app.id}.example.workers.dev`;
    const privateEvidence = await withGeneratedProofFetch(
      app,
      privateUrl,
      createGeneratedProofRoutes(app, privateUrl),
      () => validateApp(app, privateUrl),
    );
    expect(
      privateEvidence.assertions.every(
        (assertion: { status: string }) => assertion.status === 'pass',
      ),
    ).toBe(true);
    expect(
      privateEvidence.assertions.map(
        (assertion: { type: string }) => assertion.type,
      ),
    ).toEqual(
      expect.arrayContaining([
        'public-surface-private-robots',
        'security-noindex',
        'ssr-head-private-canonical',
      ]),
    );
    expect(
      privateEvidence.assertions.some(
        (assertion: { type: string }) =>
          assertion.type === 'public-surface-sitemap',
      ),
    ).toBe(false);

    const publicApp = withPublicProofSurface(app);
    const productionUrl = `https://${app.id}.example.com`;
    const productionEvidence = await withGeneratedProofFetch(
      publicApp,
      productionUrl,
      createGeneratedProofRoutes(publicApp, productionUrl, {
        publicSurface: true,
      }),
      () => validateApp(publicApp, productionUrl),
    );
    expect(
      productionEvidence.assertions.find(
        (assertion: { type: string }) => assertion.type === 'indexing-policy',
      ),
    ).toMatchObject({
      htmlRobotsIndexable: true,
      mode: 'production',
      status: 'pass',
      xRobotsTag: null,
    });

    const previewUrl = `https://${app.id}.example.workers.dev`;
    const previewEvidence = await withGeneratedProofFetch(
      publicApp,
      previewUrl,
      createGeneratedProofRoutes(publicApp, previewUrl, {
        publicSurface: true,
      }),
      () => validateApp(publicApp, previewUrl),
    );
    expect(
      previewEvidence.assertions.find(
        (assertion: { type: string }) => assertion.type === 'indexing-policy',
      ),
    ).toMatchObject({
      mode: 'preview',
      status: 'pass',
      xRobotsTag: 'noindex, nofollow',
    });
  }
}

async function expectGeneratedCloudflareProofContract(
  workspaceDir: string,
  appIds: string[],
) {
  const realWorkspaceDir = fs.realpathSync(workspaceDir);
  const rootPackage = readJson(workspaceDir, 'package.json');
  expect(rootPackage.scripts['cloudflare:proof']).toBe(
    'node ./scripts/proof-cloudflare-version.mts --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
  );

  const generatedContract = readGeneratedContract(workspaceDir);
  const apps = appIds.map(appId =>
    getGeneratedAppContract(workspaceDir, appId),
  );
  const publicUrlEnvNames = apps.map(app => app.deploy.cloudflare.publicUrlEnv);
  const proofScript = readText(
    workspaceDir,
    'scripts/proof-cloudflare-version.mts',
  );
  const proofHelperScript = readText(
    repoRoot,
    'packages/toolkit/create/templates/workspace-scripts/ultramodern-cloudflare-proof.mjs',
  );
  expect(proofScript).toContain('ULTRAMODERN_CREATE_BIN');
  expect(proofScript).toContain("'cloudflare-proof'");

  const helpOutput = execFileSync(
    process.execPath,
    ['scripts/proof-cloudflare-version.mts', '--help'],
    {
      cwd: workspaceDir,
      env: generatedToolEnv(envWithoutGeneratedPublicUrls(publicUrlEnvNames)),
      stdio: 'pipe',
    },
  ).toString();
  expect(helpOutput).toContain(
    'node scripts/proof-cloudflare-version.mts [--app workspace] [--out evidence.json] [--require-public-urls]',
  );
  expect(helpOutput).toContain(
    'ULTRAMODERN_PUBLIC_URL_WORKSPACE=https://workspace.example.workers.dev',
  );

  const assertionTypes = [
    ...`${proofScript}\n${proofHelperScript}`.matchAll(/type: '([^']+)'/gu),
  ].map(match => match[1]);
  expect(assertionTypes).toEqual(
    expect.arrayContaining([
      'api-marker',
      'byte-budget',
      'cache-control',
      'content-type',
      'css-asset',
      'css-preload-assets',
      'css-preload-link-header',
      'css-root-marker',
      'i18n-cors',
      'i18n-marker',
      'indexing-policy',
      'mf-manifest',
      'mf-manifest-cors',
      'mf-manifest-public-path',
      'public-surface-private-robots',
      'public-surface-robots',
      'public-surface-sitemap',
      'public-surface-webmanifest',
      'robots-sitemap-consistency',
      'security-csp',
      'security-header',
      'security-noindex',
      'sitemap-route',
      'sourcemap-policy',
      'ssr',
      'ssr-head',
      'ssr-head-private-canonical',
      'ssr-head-route',
      'status-code',
      'ui-marker',
    ]),
  );

  await expectGeneratedCloudflareProofBehavior(workspaceDir, apps);

  for (const app of apps) {
    expect(app.deploy.cloudflare.publicUrlEnv).toBe(
      `ULTRAMODERN_PUBLIC_URL_${app.id.replace(/-/g, '_').toUpperCase()}`,
    );
    expect(app.deploy.cloudflare.qualityGates).toMatchObject({
      assets: {
        cssPreloadRequired: true,
        cssResponseRequired: true,
        cacheControlRequiredForCss: true,
        sourcemapsPubliclyReferenced: false,
      },
      indexing: {
        previewNoindex: true,
        productionPublicRoutesIndexable: true,
      },
      publicRoutes: {
        requireRobotsSitemapConsistency: true,
        requireSitemapWhenPresent: true,
        requireWebManifestWhenPresent: true,
      },
      statusCodes: {
        notFoundRoute: '/__ultramodern-smoke-missing/nope',
        unknownRouteStatus: 404,
      },
    });
  }

  const skippedReportPath =
    '.codex/reports/cloudflare-version-proof/skipped-proof.json';
  const skippedOutput = execFileSync(
    process.execPath,
    ['scripts/proof-cloudflare-version.mts', '--out', skippedReportPath],
    {
      cwd: workspaceDir,
      env: generatedToolEnv(envWithoutGeneratedPublicUrls(publicUrlEnvNames)),
      stdio: 'pipe',
    },
  ).toString();
  expect(skippedOutput.trim()).toBe(
    `[cloudflare-version-proof] skipped: ${skippedReportPath}`,
  );
  const skippedReport = readJson(workspaceDir, skippedReportPath);
  expect(skippedReport).toMatchObject({
    schemaVersion: 1,
    status: 'skipped',
    contractPath: path.join(realWorkspaceDir, '.modernjs/ultramodern.json'),
    results: [],
    skipped: apps.map(app => ({
      appId: app.id,
      publicUrlEnv: app.deploy.cloudflare.publicUrlEnv,
      reason: 'public URL environment variable is not set',
      status: 'skipped',
    })),
  });
  expect(Number.isNaN(Date.parse(skippedReport.generatedAt))).toBe(false);

  const appScopedReportPath =
    '.codex/reports/cloudflare-version-proof/app-scoped-skipped-proof.json';
  execFileSync(
    process.execPath,
    [
      'scripts/proof-cloudflare-version.mts',
      '--app',
      apps[0].id,
      '--out',
      appScopedReportPath,
    ],
    {
      cwd: workspaceDir,
      env: generatedToolEnv(envWithoutGeneratedPublicUrls(publicUrlEnvNames)),
      stdio: 'pipe',
    },
  );
  const appScopedReport = readJson(workspaceDir, appScopedReportPath);
  expect(appScopedReport.skipped).toEqual([
    {
      appId: apps[0].id,
      publicUrlEnv: apps[0].deploy.cloudflare.publicUrlEnv,
      reason: 'public URL environment variable is not set',
      status: 'skipped',
    },
  ]);

  const requiredReportPath =
    '.codex/reports/cloudflare-version-proof/required-proof.json';
  expect(() =>
    execFileSync(
      process.execPath,
      [
        'scripts/proof-cloudflare-version.mts',
        '--app',
        apps[0].id,
        '--out',
        requiredReportPath,
        '--require-public-urls',
      ],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(envWithoutGeneratedPublicUrls(publicUrlEnvNames)),
        stdio: 'pipe',
      },
    ),
  ).toThrow(
    new RegExp(
      `\\[cloudflare-version-proof\\] ${apps[0].id} requires ${apps[0].deploy.cloudflare.publicUrlEnv}`,
      'u',
    ),
  );
  expectNoPath(workspaceDir, requiredReportPath);

  expect(generatedContract.apps.map(app => app.id)).toEqual(
    expect.arrayContaining(appIds),
  );
}

describe('create-ultramodern-workspace', () => {
  let tempRoot = '';

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-create-ultramodern-workspace-'),
    );
  });

  afterAll(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scaffolds a shell-only UltraModern SuperApp workspace', async () => {
    const workspaceDir = path.join(tempRoot, 'ultra-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);

    for (const relativePath of [
      'AGENTS.md',
      'package.json',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'tsconfig.base.json',
      'README.md',
      'oxlint.config.ts',
      'oxfmt.config.ts',
      '.agents/agent-reference-repos.json',
      '.codex/skills-lock.json',
      '.codex/rstackjs-agent-skills-LICENSE',
      '.codex/skills/rsbuild-best-practices/SKILL.md',
      '.codex/skills/rspack-best-practices/SKILL.md',
      '.codex/skills/rspack-tracing/SKILL.md',
      '.codex/skills/rspack-tracing/references/tracing-guide.md',
      '.codex/skills/rspack-tracing/scripts/analyze_trace.js',
      '.codex/skills/rsdoctor-analysis/SKILL.md',
      '.codex/skills/rsdoctor-analysis/references/rsdoctor-data-types.md',
      '.codex/skills/rslib-best-practices/SKILL.md',
      '.codex/skills/rslib-modern-package/SKILL.md',
      '.codex/skills/rstest-best-practices/SKILL.md',
      'scripts/assert-mf-types.mts',
      'scripts/validate-ultramodern-workspace.mts',
      'scripts/proof-cloudflare-version.mts',
      'scripts/ultramodern-performance-readiness.config.mjs',
      'scripts/ultramodern-performance-readiness.mts',
      'scripts/ultramodern-typecheck.mts',
      'scripts/bootstrap-agent-skills.mts',
      '.modernjs/ultramodern.json',
      'topology/reference-topology.json',
      'topology/ownership.json',
      'topology/local-overlays/development.json',
      'apps/shell-super-app/package.json',
      'apps/shell-super-app/tsconfig.json',
      'apps/shell-super-app/tsconfig.mf-types.json',
      'apps/shell-super-app/modern.config.ts',
      'apps/shell-super-app/module-federation.config.ts',
      'apps/shell-super-app/src/ultramodern-build.ts',
      'apps/shell-super-app/src/api/vertical-clients.ts',
      'apps/shell-super-app/postcss.config.mjs',
      'apps/shell-super-app/tailwind.config.ts',
      'apps/shell-super-app/locales/en/translation.json',
      'apps/shell-super-app/locales/en/shell.json',
      'apps/shell-super-app/locales/cs/translation.json',
      'apps/shell-super-app/locales/cs/shell.json',
      'apps/shell-super-app/src/routes/index.css',
      'apps/shell-super-app/src/routes/ultramodern-jsonld.ts',
      'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
      'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
      'apps/shell-super-app/src/routes/[lang]/route.meta.ts',
      'packages/shared-contracts/src/index.ts',
      'packages/shared-contracts/tsconfig.json',
      'packages/shared-design-tokens/src/index.ts',
      'packages/shared-design-tokens/src/tokens.css',
      'packages/shared-design-tokens/tsconfig.json',
    ]) {
      expectPath(workspaceDir, relativePath);
    }
    expectNoPath(
      workspaceDir,
      '.modernjs/ultramodern-workspace-template-manifest.json',
    );
    expectNoPath(workspaceDir, '.modernjs/ultramodern-package-source.json');
    expectNoPath(workspaceDir, '.modernjs/ultramodern-generated-contract.json');
    expectNoPath(workspaceDir, 'packages/shared-effect-api');
    expectNoPath(workspaceDir, 'verticals/workspace');
    expectNoPath(workspaceDir, 'verticals/records');
    expectNoPath(workspaceDir, 'verticals/actions');
    expectNoPath(workspaceDir, 'services/service-recommendations-effect');
    expectNoPath(workspaceDir, 'apps/remotes/remote-commerce');
    expectNoPath(workspaceDir, 'apps/remotes/remote-identity');
    expectNoPath(workspaceDir, 'apps/remotes/remote-design-system');

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.name).toBe('ultra-workspace');
    const pnpmVersion = expectPnpm11OrNewerPackageManager(
      rootPackage.packageManager,
    );
    expect(rootPackage.engines.node).toBe('>=26');
    expect(rootPackage.engines.pnpm).toBe('>=11');
    expectPath(workspaceDir, '.mise.toml');
    expect(readText(workspaceDir, '.mise.toml')).toContain('node = "26.3.0"');
    expect(readText(workspaceDir, '.mise.toml')).toContain(
      `pnpm = "${pnpmVersion}"`,
    );
    const workflowText = readText(
      workspaceDir,
      '.github/workflows/ultramodern-workspace-gates.yml',
    );
    expect(workflowText).toMatch(/node-version:\s*['"]26\.3\.0['"]/u);
    expect(workflowText).toContain('name: API Boundaries');
    expect(workflowText).toContain('command: pnpm api:check');
    expect(workflowText).not.toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24');
    expect(rootPackage.workspaces).toEqual([
      'apps/*',
      'verticals/*',
      'packages/*',
    ]);
    expectPnpm11Policy(workspaceDir);
    expect(rootPackage.modernjs.preset).toBe('presetUltramodern');
    expect(rootPackage.modernjs.packageSource).toEqual({
      strategy: 'install',
      config: './.modernjs/ultramodern.json',
    });
    expect(rootPackage.scripts['contract:check']).toBe(
      'node ./scripts/validate-ultramodern-workspace.mts',
    );
    expect(rootPackage.scripts['mf:types']).toBe(
      'node ./scripts/assert-mf-types.mts',
    );
    expect(rootPackage.scripts.typecheck).toBe(
      'node ./scripts/ultramodern-typecheck.mts --build tsconfig.json',
    );
    expect(rootPackage.scripts['performance:readiness']).toBe(
      'node ./scripts/ultramodern-performance-readiness.mts',
    );
    expectPath(workspaceDir, 'scripts/generate-public-surface-assets.mts');
    expect(rootPackage.scripts.build).toBe(
      'ULTRAMODERN_ZEPHYR=false pnpm --filter "./apps/shell-super-app" run build && pnpm mf:types && pnpm performance:readiness',
    );
    expect(rootPackage.scripts['cloudflare:build']).toBe(
      'pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm mf:types',
    );
    expect(rootPackage.scripts['cloudflare:deploy']).toBe(
      'pnpm --filter "./apps/shell-super-app" run cloudflare:deploy',
    );
    expect(rootPackage.scripts['cloudflare:proof']).toBe(
      'node ./scripts/proof-cloudflare-version.mts --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
    );
    expect(readJson(workspaceDir, 'tsconfig.json')).toMatchObject({
      files: [],
      references: [
        { path: 'packages/shared-contracts' },
        { path: 'packages/shared-design-tokens' },
        { path: 'apps/shell-super-app' },
      ],
    });
    expect(
      readJson(workspaceDir, 'apps/shell-super-app/tsconfig.json'),
    ).toMatchObject({
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        composite: true,
        incremental: true,
        tsBuildInfoFile:
          '../../node_modules/.cache/tsgo/apps__shell-super-app.tsbuildinfo',
      },
      references: [
        { path: '../../packages/shared-contracts' },
        { path: '../../packages/shared-design-tokens' },
      ],
    });
    expect(
      readJson(workspaceDir, 'apps/shell-super-app/tsconfig.mf-types.json'),
    ).toEqual({
      extends: './tsconfig.json',
      include: ['src/modern-app-env.d.ts'],
    });
    expect(
      readJson(workspaceDir, 'packages/shared-contracts/tsconfig.json'),
    ).toMatchObject({
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        composite: true,
        incremental: true,
        tsBuildInfoFile:
          '../../node_modules/.cache/tsgo/packages__shared-contracts.tsbuildinfo',
      },
      include: ['src'],
    });
    await expectGeneratedCloudflareProofContract(workspaceDir, [
      'shell-super-app',
    ]);
    expect(rootPackage.scripts.format).toBe("oxfmt . '!repos/**'");
    expect(rootPackage.scripts['format:check']).toBe(
      "oxfmt --check . '!repos/**'",
    );
    expect(rootPackage.scripts.lint).toBe('oxlint apps verticals packages');
    expect(rootPackage.scripts['lint:fix']).toBe(
      'oxlint apps verticals packages --fix',
    );
    expect(rootPackage.scripts['skills:install']).toBe(
      'node ./scripts/bootstrap-agent-skills.mts',
    );
    expect(rootPackage.scripts['skills:check']).toBe(
      'node ./scripts/bootstrap-agent-skills.mts --check',
    );
    expect(rootPackage.scripts.postinstall).toBe(
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mts --postinstall",
    );
    expect(
      rootPackage.scripts.check.endsWith('&& pnpm performance:readiness'),
    ).toBe(true);
    expect(rootPackage.scripts['agents:refs:install']).toBe(
      'node ./scripts/setup-agent-reference-repos.mts',
    );
    const agentSkillsBootstrap = fs.readFileSync(
      path.join(workspaceDir, 'scripts/bootstrap-agent-skills.mts'),
      'utf8',
    );
    expect(agentSkillsBootstrap).not.toContain("run('brew'");
    expect(agentSkillsBootstrap).not.toContain('runShell(');
    const agentReferenceRepoSetup = fs.readFileSync(
      path.join(workspaceDir, 'scripts/setup-agent-reference-repos.mts'),
      'utf8',
    );
    expect(agentReferenceRepoSetup).toContain(
      "['commit', '--no-verify', '-m', message]",
    );
    expect(agentReferenceRepoSetup).toContain(
      "commitInstallerChanges('Initialize UltraModern workspace')",
    );
    expect(agentReferenceRepoSetup).toContain(
      "commitInstallerChanges('Record agent reference repo manifest')",
    );
    expect(
      Object.keys(rootPackage.scripts).every(
        scriptName => !scriptName.startsWith('zephyr:'),
      ),
    ).toBe(true);
    expect(rootPackage.devDependencies).toMatchObject({
      '@effect/tsgo': '0.14.6',
      '@modern-js/code-tools': expectedBleedingDevSpecifier(
        '@modern-js/code-tools',
      ),
      '@modern-js/create': expectedBleedingDevSpecifier('@modern-js/create'),
      '@typescript/native-preview': '7.0.0-dev.20260628.1',
      lefthook: '^2.1.9',
      oxlint: '1.71.0',
      oxfmt: '0.56.0',
      ultracite: '7.8.3',
      wrangler: '4.102.0',
      'zephyr-agent': '1.1.1',
    });
    const typecheckScript = readText(
      workspaceDir,
      'scripts/ultramodern-typecheck.mts',
    );
    expect(typecheckScript).toContain('ULTRAMODERN_CREATE_BIN');
    expect(typecheckScript).toContain("'typecheck'");
    expect(rootPackage.devDependencies.typescript).toBeUndefined();

    expectPath(workspaceDir, 'AGENTS.md');
    expectPath(workspaceDir, '.codex/hooks.json');
    expectPath(workspaceDir, 'lefthook.yml');

    const skillsLock = readJson(workspaceDir, '.codex/skills-lock.json');
    expect(skillsLock.source.repository).toBe(
      'https://github.com/rstackjs/agent-skills',
    );
    expect(skillsLock.source.commit).toBe(
      '61c948b42512e223bad44b83af4080eba48b2677',
    );
    expect(skillsLock.installDir).toBe('.codex/skills');
    expect(
      skillsLock.baseline.map((skill: { name: string }) => skill.name),
    ).toEqual([
      'rsbuild-best-practices',
      'rspack-best-practices',
      'rspack-tracing',
      'rsdoctor-analysis',
      'rslib-best-practices',
      'rslib-modern-package',
      'rstest-best-practices',
      'mf',
    ]);
    expectPath(workspaceDir, '.codex/skills/rslib-modern-package/SKILL.md');
    const privateSource = skillsLock.sources.find(
      (source: { repository: string }) =>
        source.repository === 'https://github.com/TechsioCZ/skills',
    );
    const moduleFederationSource = skillsLock.sources.find(
      (source: { repository: string }) =>
        source.repository ===
        'https://github.com/module-federation/agent-skills',
    );
    expect(moduleFederationSource).toMatchObject({
      install: 'clone',
      commit: '07bb5b6c43ad457609e00c081b72d4c42508ec76',
    });
    expect(
      moduleFederationSource.baseline.map(
        (skill: { name: string }) => skill.name,
      ),
    ).toEqual(['mf']);
    expect(privateSource.install).toBe('clone-if-authorized');
    expect(
      privateSource.baseline.map((skill: { name: string }) => skill.name),
    ).toEqual(['plan-graph', 'dag', 'subagent-graph', 'helm', 'debugger-mode']);

    const appPackagePaths = ['apps/shell-super-app/package.json'];
    const generatedContract = readGeneratedContract(workspaceDir);
    expect(generatedContract.apps.map(app => app.id)).toEqual([
      'shell-super-app',
    ]);
    expect(generatedContract.performanceReadiness).toMatchObject({
      default: 'enabled',
      mode: 'diagnostic',
      scope: 'ultramodern-generated-and-framework-owned',
      report: {
        script: 'scripts/ultramodern-performance-readiness.mts',
        config: 'scripts/ultramodern-performance-readiness.config.mjs',
        defaultPath:
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        deterministic: true,
      },
      optOut: {
        env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
      },
    });
    expect(
      generatedContract.performanceReadiness.signals.map(
        (signal: { id: string }) => signal.id,
      ),
    ).toEqual([
      'bfcache',
      'core-web-vitals-rum',
      'duplicate-prefetch-warmup',
      'cache-policy-sanity',
      'save-data-behavior',
      'cloudflare-ssr-cache-hints',
    ]);

    for (const packagePath of appPackagePaths) {
      const packageJson = readJson(workspaceDir, packagePath);
      expectNoDirectEffectDependency(packageJson);
      expectBleedingDevModernDependency(
        packageJson,
        'dependencies',
        '@modern-js/plugin-tanstack',
      );
      expectBleedingDevModernDependency(
        packageJson,
        'dependencies',
        '@modern-js/plugin-i18n',
      );
      expectBleedingDevModernDependency(
        packageJson,
        'dependencies',
        '@modern-js/runtime',
      );
      expect(packageJson.dependencies.i18next).toBe('26.3.1');
      expect(packageJson.dependencies['react-i18next']).toBeUndefined();
      expect(packageJson.dependencies['node-fetch']).toBe('^3.3.2');
      expectBleedingDevModernDependency(
        packageJson,
        'devDependencies',
        '@modern-js/app-tools',
      );
      expect(packageJson.devDependencies['@effect/tsgo']).toBe('0.14.6');
      expect(packageJson.devDependencies['@typescript/native-preview']).toBe(
        '7.0.0-dev.20260628.1',
      );
      expect(packageJson.devDependencies.typescript).toBe(
        testTypescriptVersion,
      );
      expect(packageJson.devDependencies['zephyr-rspack-plugin']).toBe('1.1.1');
      expect(packageJson.devDependencies.wrangler).toBe('4.102.0');
      expect(
        packageJson.devDependencies['zephyr-modernjs-plugin'],
      ).toBeUndefined();
      expect(packageJson.devDependencies.tailwindcss).toBe('^4.3.1');
      expect(packageJson.devDependencies['@tailwindcss/postcss']).toBe(
        '^4.3.1',
      );
      expect(packageJson.devDependencies.postcss).toBe('^8.5.15');
      expect(packageJson.scripts.dev).toBe('modern dev');
      expect(packageJson.scripts.build).toBe(
        'ULTRAMODERN_ZEPHYR=false modern build && node ../../scripts/generate-public-surface-assets.mts --app shell-super-app --target dist',
      );
      expect(packageJson.scripts['cloudflare:build']).toBe(
        'ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern build && node ../../scripts/generate-public-surface-assets.mts --app shell-super-app --target dist && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy && node ../../scripts/generate-public-surface-assets.mts --app shell-super-app --target cloudflare',
      );
      expect(packageJson.scripts['cloudflare:deploy']).toBe(
        'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
      );
      expect(packageJson.scripts['cloudflare:preview']).toBe(
        'pnpm run cloudflare:build && wrangler dev --config .output/wrangler.json',
      );
      expect(packageJson.scripts['cloudflare:proof']).toBe(
        'node ../../scripts/proof-cloudflare-version.mts --app shell-super-app',
      );
      expect(packageJson.scripts.serve).toBe('modern serve');
      expect(
        Object.keys(packageJson.scripts).every(
          scriptName => !scriptName.startsWith('zephyr:'),
        ),
      ).toBe(true);
      expect(packageJson['zephyr:dependencies']).toEqual({});
      expect(packageJson.scripts.typecheck).toBe(
        'node ../../scripts/ultramodern-typecheck.mts --project tsconfig.json',
      );
      expect(packageJson.dependencies['@tanstack/react-router']).toBe(
        '1.170.16',
      );
      expect(packageJson.dependencies['@module-federation/modern-js-v3']).toBe(
        '2.6.0',
      );
      expectBleedingDevModernDependency(
        packageJson,
        'dependencies',
        '@modern-js/plugin-bff',
      );
      expect(packageJson.exports).toMatchObject({
        './api/clients': './src/api/vertical-clients.ts',
      });
      expect(packageJson.modernjs.preset).toBe('presetUltramodern');
    }

    for (const appDirectory of ['apps/shell-super-app']) {
      const contractEntry = generatedContract.apps.find(
        app => app.path === appDirectory,
      );
      expect(contractEntry).toBeDefined();
      expectTailwindContract(contractEntry!);
    }

    const shellContract = getGeneratedAppContract(
      workspaceDir,
      'shell-super-app',
    );
    expectAppConfigContract(shellContract, {
      publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
      portEnv: 'SHELL_SUPER_APP_PORT',
      port: 3020,
    });
    expectCssFederationContract(generatedContract, shellContract, {
      classPrefix: 'shell:',
      ownedLayers: ['ultramodern-shell-base', 'ultramodern-shell-overlay'],
      role: 'shell-base-overlay',
      rootSelector: '[data-app-id="shell-super-app"]',
    });
    expect(shellContract.moduleFederation).toMatchObject({
      name: 'shellSuperApp',
      dts: {
        displayErrorInTerminal: true,
        compilerInstance: 'tsgo',
        tsConfigPath: './tsconfig.mf-types.json',
      },
    });
    expect(shellContract.moduleFederation.remoteRefs ?? []).toEqual([]);
    expect(shellContract.moduleFederation.remotes ?? []).toEqual([]);
    const shellModuleFederationConfig = readText(
      workspaceDir,
      'apps/shell-super-app/module-federation.config.ts',
    );
    const shellModernConfig = readText(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    expect(shellModuleFederationConfig).toContain(
      "tsConfigPath: './tsconfig.mf-types.json'",
    );
    expect(shellModernConfig).toContain('security: {');
    expect(shellModernConfig).toContain("compatibilityDate: '2026-06-02'");
    expect(shellModernConfig).toContain("mode: 'report-only'");
    expect(shellModernConfig).toContain("'script-src'");
    expect(shellModernConfig).toContain("'connect-src'");
    expect(shellModernConfig).toContain('const assetPrefix =');
    expectDedicatedAssetPrefixExpression(shellModernConfig);
    expect(shellModernConfig).toContain("assetPrefix: '/',");
    expect(shellModernConfig).toContain('assetPrefix,');
    expect(shellModernConfig).toMatch(
      /const siteUrl =\s*configuredSiteUrl \|\|\s*configuredCloudflareUrl \|\|/,
    );
    expect(shellModuleFederationConfig).toMatch(
      /bridge:\s*\{\s*enableBridgeRouter:\s*false,\s*\}/u,
    );
    expect(shellModuleFederationConfig).not.toContain(
      'enableBridgeRouter: true',
    );
    expect(shellModuleFederationConfig).not.toContain('bridgeRouterAlias');
    expect(shellContract.i18n).toMatchObject({
      backend: {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      namespace: 'shell',
      namespaces: ['shell', 'translation'],
      localisedUrls: {},
      resourceOwnership: {
        ownerAppId: 'shell-super-app',
        source: 'route-owned',
      },
    });
    expect(shellContract.routes).toMatchObject({
      source: 'route-owned',
      metadataAuthoring: 'colocated-route-meta',
      generatedManifest: true,
      metadataExport: './src/routes/ultramodern-route-metadata',
      generatedRouteMap: true,
      privateByDefault: true,
      publicnessDefault: 'private-app-screen',
      publicRoutes: [],
      publicHead: {
        generator: './src/routes/ultramodern-route-head',
        renderer: '@modern-js/runtime/head Helmet',
        ssr: true,
        title: {
          source: 'route.titleKey',
        },
        description: {
          source: 'route.descriptionKey',
        },
        canonical: {
          publicIndexableOnly: true,
        },
        structuredData: {
          publicIndexableOnly: true,
          optional: true,
          source: 'route.jsonLd',
          inference: false,
          helperModule: './src/routes/ultramodern-jsonld',
          sanitizesHtmlOpenBracket: true,
        },
        privateRouteRobots: 'noindex, nofollow',
      },
    });
    expect(shellContract.routes.owned).toEqual([
      expect.objectContaining({
        descriptionKey: 'shell.seo.description',
        id: 'shell-home',
        public: false,
        indexable: false,
        publicSurface: 'private-app-screen',
      }),
    ]);
    expectRouteMetadataCompatibility(workspaceDir, 'apps/shell-super-app', {
      localisedUrls: shellContract.i18n.localisedUrls,
      namespace: shellContract.i18n.namespace,
      publicRoutes: shellContract.routes.publicRoutes,
      routes: shellContract.routes.owned,
    });
    expectPrivatePublicSurface(
      workspaceDir,
      'apps/shell-super-app',
      shellContract.routes,
    );
    const shellRouteHead = readText(
      workspaceDir,
      'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
    );
    expect(shellRouteHead).toContain("from '@modern-js/runtime/head'");
    expect(shellRouteHead).toContain('<title>{title}</title>');
    expect(shellRouteHead).toContain('name="description"');
    expect(shellRouteHead).toContain('name="robots"');
    expect(shellRouteHead).toContain('rel="canonical"');
    expect(shellRouteHead).toContain('property="og:title"');
    expect(shellRouteHead).toContain('name="twitter:card"');
    expect(shellRouteHead).toContain('application/ld+json');
    expect(shellRouteHead).toContain('route?.jsonLd');
    expect(shellRouteHead).not.toContain("'@type': 'WebPage'");
    const shellJsonLdHelpers = readText(
      workspaceDir,
      'apps/shell-super-app/src/routes/ultramodern-jsonld.ts',
    );
    expect(shellJsonLdHelpers).toContain('export const defineRouteJsonLd');
    expect(shellJsonLdHelpers).toContain('export const webPageJsonLd');
    expect(shellJsonLdHelpers).toContain('export const webApplicationJsonLd');
    expect(shellJsonLdHelpers).toContain(
      'export const softwareApplicationJsonLd',
    );
    expect(shellJsonLdHelpers).toContain('export const breadcrumbListJsonLd');
    expect(shellJsonLdHelpers).toContain('export const faqPageJsonLd');
    expect(shellJsonLdHelpers).toContain('export const organizationJsonLd');
    const sharedContracts = readText(
      workspaceDir,
      'packages/shared-contracts/src/index.ts',
    );
    expect(sharedContracts).toContain(
      'export interface UltramodernPublicSitemapEntry',
    );
    expect(sharedContracts).toContain('localeParams?:');
    expect(shellContract.deploy).toMatchObject({
      target: 'cloudflare',
      cloudflare: {
        workerName: 'ultra-workspace-shell-super-app',
        publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
        compatibilityDate: '2026-06-02',
        assetsBinding: 'ASSETS',
        security: {
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
            },
          },
          noindex: {
            workersDev: true,
            localhost: true,
          },
        },
        qualityGates: {
          publicRoutes: {
            requireSitemapWhenPresent: true,
            requireRobotsSitemapConsistency: true,
            requireWebManifestWhenPresent: true,
          },
          statusCodes: {
            notFoundRoute: '/__ultramodern-smoke-missing/nope',
            unknownRouteStatus: 404,
          },
          indexing: {
            previewNoindex: true,
            productionPublicRoutesIndexable: true,
          },
          assets: {
            cssPreloadRequired: true,
            cssResponseRequired: true,
            cacheControlRequiredForCss: true,
            sourcemapsPubliclyReferenced: false,
          },
          budgets: {
            ssrHtmlMaxBytes: 250_000,
            mfManifestMaxBytes: 500_000,
            localeJsonMaxBytes: 100_000,
            sitemapXmlMaxBytes: 500_000,
            cssAssetMaxBytes: 750_000,
          },
          csp: {
            finalMode: 'report-only-dogfood',
          },
        },
        routes: {
          ssr: '/en',
          mfManifest: '/mf-manifest.json',
          locale: '/locales/en/shell.json',
        },
      },
      worker: {
        compatibilityDate: '2026-06-02',
        name: 'ultra-workspace-shell-super-app',
        security: {
          enabled: true,
          contentSecurityPolicy: {
            mode: 'report-only',
          },
        },
        ssr: true,
      },
    });
    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.description).toBe(
      'Generated UltraModern SuperApp shell that can grow by adding full-stack verticals.',
    );
    expect(topology.preset).toBe('presetUltramodern');
    expect(topology.shell.verticalRefs).toEqual([]);
    expect(topology.shell.moduleFederation.remotes).toEqual([]);
    expect(topology.shell.cloudflare).toMatchObject({
      workerName: 'ultra-workspace-shell-super-app',
      publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
      assetsBinding: 'ASSETS',
    });
    expect(topology.verticals).toEqual([]);
    expect(topology.sharedPackages).toHaveLength(2);
    expect(
      topology.sharedPackages.map((entry: { id: string }) => entry.id).sort(),
    ).toEqual(['shared-contracts', 'shared-design-tokens']);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find(
        (owner: { id: string }) => owner.id === 'shell-super-app',
      ).ownership.team,
    ).toBe('super-app-platform');
    expect(
      ownership.owners.some(
        (owner: { id: string; path: string }) =>
          owner.id === 'service-recommendations-effect' ||
          owner.path === 'services/service-recommendations-effect',
      ),
    ).toBe(false);

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    expect(ultramodernConfig.profile).toBe('cloudflare-ssr-mf-effect-v1');
    expect(ultramodernConfig.generator.package).toBe('@modern-js/create');
    expect(ultramodernConfig.packageSource).toMatchObject({
      strategy: 'install',
      modernPackageVersion: testFrameworkVersion,
      aliasScope: 'bleedingdev',
      aliasPackageNamePrefix: 'modern-js-',
    });
    expect(ultramodernConfig.agentSkills).toMatchObject({
      target: 'codex',
      mode: 'repo-owned-default-on',
      selfContainedVendoring: true,
    });

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );

    const shellPackagePath = 'apps/shell-super-app/package.json';
    const originalShellPackage = readText(workspaceDir, shellPackagePath);
    const mutatedShellPackage = JSON.parse(originalShellPackage);
    mutatedShellPackage.dependencies['@modern-js/runtime'] =
      expectedBleedingDevSpecifier(
        '@modern-js/runtime',
        differentUltramodernVersion(testFrameworkVersion),
      );
    writeText(
      workspaceDir,
      shellPackagePath,
      `${JSON.stringify(mutatedShellPackage, null, 2)}\n`,
    );
    try {
      execFileSync(
        process.execPath,
        ['scripts/validate-ultramodern-workspace.mts'],
        {
          cwd: workspaceDir,
          env: generatedToolEnv(),
          stdio: 'pipe',
        },
      );
      throw new Error(
        'Expected workspace validator to reject a mixed Modern package cohort',
      );
    } catch (error) {
      const execError = error as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      const stdout =
        typeof execError.stdout === 'string'
          ? execError.stdout
          : execError.stdout?.toString() || '';
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : execError.stderr?.toString() || '';
      expect(`${stdout}\n${stderr}`).toMatch(
        /apps\/shell-super-app\/package\.json dependencies\.@modern-js\/runtime must match package source metadata/u,
      );
    } finally {
      writeText(workspaceDir, shellPackagePath, originalShellPackage);
    }

    const readinessOutput = runPerformanceReadiness(workspaceDir);
    expect(readinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics reported',
    );
    const readinessReportPath =
      '.codex/reports/performance-readiness/ultramodern-performance-readiness.json';
    const readinessReport = readJson(workspaceDir, readinessReportPath);
    expect(readinessReport).toMatchObject({
      schemaVersion: 1,
      profile: 'ultramodern-performance-readiness-diagnostics-v1',
      status: 'pass',
      defaultOn: true,
      failOn: 'framework-invariant',
      signals: [
        'bfcache',
        'core-web-vitals-rum',
        'duplicate-prefetch-warmup',
        'cache-policy-sanity',
        'save-data-behavior',
        'cloudflare-ssr-cache-hints',
      ],
    });
    expect(readinessReport.apps).toEqual([
      {
        id: 'shell-super-app',
        path: 'apps/shell-super-app',
        signals: readinessReport.signals.map((id: string) =>
          expect.objectContaining({
            id,
            severity: 'diagnostic',
            status: 'pass',
          }),
        ),
      },
    ]);
    const firstReadinessReportText = readText(
      workspaceDir,
      readinessReportPath,
    );
    runPerformanceReadiness(workspaceDir);
    expect(readText(workspaceDir, readinessReportPath)).toBe(
      firstReadinessReportText,
    );
    const readinessConfigPath =
      'scripts/ultramodern-performance-readiness.config.mjs';
    const readinessConfig = readText(workspaceDir, readinessConfigPath);
    expect(readinessConfig).toContain(
      'UltramodernPerformanceReadinessDiagnosticsConfig',
    );
    writeText(
      workspaceDir,
      readinessConfigPath,
      readinessConfig.replace('enabled: true', 'enabled: false'),
    );
    const disabledReadinessOutput = runPerformanceReadiness(workspaceDir);
    expect(disabledReadinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics disabled',
    );
    expect(readJson(workspaceDir, readinessReportPath)).toMatchObject({
      schemaVersion: 1,
      profile: 'ultramodern-performance-readiness-diagnostics-v1',
      status: 'disabled',
      defaultOn: true,
      optOut: `${readinessConfigPath}#enabled=false`,
      apps: [],
    });
    writeText(workspaceDir, readinessConfigPath, readinessConfig);
    const envDisabledReadinessOutput = runPerformanceReadiness(workspaceDir, {
      ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS: 'false',
    });
    expect(envDisabledReadinessOutput.trim()).toBe(
      'UltraModern performance readiness diagnostics disabled',
    );
    expect(readJson(workspaceDir, readinessReportPath)).toMatchObject({
      status: 'disabled',
      optOut: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
    });

    const shellHeaderPath =
      'apps/shell-super-app/src/routes/vertical-components.tsx';
    const shellHeaderSource = readText(workspaceDir, shellHeaderPath);
    expect(shellHeaderSource).toContain('data-modern-boundary-id');
    writeText(
      workspaceDir,
      shellHeaderPath,
      shellHeaderSource.replace(
        'data-modern-boundary-id=',
        'data-mf-boundary=',
      ),
    );
    linkWorkspaceToolPackages(workspaceDir);
    try {
      execFileSync(
        process.execPath,
        ['scripts/check-ultramodern-i18n-boundaries.mts'],
        {
          cwd: workspaceDir,
          stdio: 'pipe',
        },
      );
      throw new Error(
        'Expected i18n boundary checker to reject legacy data-mf-* attributes',
      );
    } catch (error) {
      const execError = error as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      const stdout =
        typeof execError.stdout === 'string'
          ? execError.stdout
          : execError.stdout?.toString() || '';
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : execError.stderr?.toString() || '';
      expect(`${stdout}\n${stderr}`).toMatch(
        /legacy data-mf-\* boundary attributes/u,
      );
    }
    writeText(workspaceDir, shellHeaderPath, shellHeaderSource);

    const fakeBinDir = path.join(tempRoot, 'fake-pnpm-bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakePnpmPath = path.join(fakeBinDir, 'pnpm');
    const generatedPnpmVersion = String(
      readJson(workspaceDir, 'package.json').packageManager,
    ).replace(/^pnpm@/u, '');
    fs.writeFileSync(
      fakePnpmPath,
      `#!/usr/bin/env node
if (process.argv.includes('--pm-on-fail=ignore') && process.argv.includes('--version')) {
  console.log('${generatedPnpmVersion}');
  process.exit(0);
}
console.error('pmOnFail rejected active pnpm before version discovery');
process.exit(1);
`,
      'utf-8',
    );
    fs.chmodSync(fakePnpmPath, 0o755);
    const patchVersionValidationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    ).toString();
    expect(patchVersionValidationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );

    const mfTypesHelp = execFileSync(
      process.execPath,
      ['scripts/assert-mf-types.mts', '--help'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(mfTypesHelp).toMatch(/Usage:/u);

    const publicSurfaceHelp = execFileSync(
      process.execPath,
      ['scripts/generate-public-surface-assets.mts', '--help'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(publicSurfaceHelp).toContain('Usage:');
    expect(publicSurfaceHelp).toContain('--target dist|cloudflare');
    expect(publicSurfaceHelp).toContain('--require-public-origin');
    expect(publicSurfaceHelp).toContain(
      'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://example.com',
    );
    expect(publicSurfaceHelp).toContain('routes.publicSurface.contentSources');
    expect(publicSurfaceHelp).toContain('route.sitemap.mjs');
    expect(publicSurfaceHelp).toContain('entries() function');
    expect(publicSurfaceHelp).toContain('UltramodernPublicSitemapEntry[]');
  });

  test('adds a full-stack MicroVertical to an existing workspace', async () => {
    const workspaceDir = path.join(tempRoot, 'ultra-add-remote-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'catalog',
      '--vertical',
      '--lang',
      'en',
    ]);

    for (const relativePath of [
      'verticals/catalog/package.json',
      'verticals/catalog/tsconfig.mf-types.json',
      'verticals/catalog/modern.config.ts',
      'verticals/catalog/module-federation.config.ts',
      'verticals/catalog/api/index.ts',
      'verticals/catalog/shared/api.ts',
      'verticals/catalog/src/api/catalog-client.ts',
      'verticals/catalog/locales/en/translation.json',
      'verticals/catalog/locales/cs/translation.json',
      'verticals/catalog/src/routes/[lang]/page.tsx',
      'verticals/catalog/src/routes/[lang]/route.meta.ts',
      'verticals/catalog/src/routes/index.css',
      'verticals/catalog/src/routes/ultramodern-jsonld.ts',
      'verticals/catalog/src/routes/ultramodern-route-head.tsx',
      'verticals/catalog/src/federation-entry.tsx',
      'verticals/catalog/src/components/catalog-widget.tsx',
      'verticals/catalog/postcss.config.mjs',
      'verticals/catalog/tailwind.config.ts',
    ]) {
      expectPath(workspaceDir, relativePath);
    }

    const remotePackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    expectNoDirectEffectDependency(remotePackage);
    expect(remotePackage.scripts).toMatchObject({
      dev: 'modern dev',
      build:
        'ULTRAMODERN_ZEPHYR=false modern build && node ../../scripts/generate-public-surface-assets.mts --app catalog --target dist && node ../../scripts/assert-mf-types.mts',
      serve: 'modern serve',
    });
    expect(remotePackage.dependencies['@tanstack/react-router']).toBe(
      '1.170.16',
    );
    expect(remotePackage.dependencies['@module-federation/modern-js-v3']).toBe(
      '2.6.0',
    );
    expectBleedingDevModernDependency(
      remotePackage,
      'dependencies',
      '@modern-js/plugin-i18n',
    );
    expectBleedingDevModernDependency(
      remotePackage,
      'dependencies',
      '@modern-js/plugin-tanstack',
    );
    expectBleedingDevModernDependency(
      remotePackage,
      'dependencies',
      '@modern-js/runtime',
    );
    expectBleedingDevModernDependency(
      remotePackage,
      'devDependencies',
      '@modern-js/app-tools',
    );
    expect(remotePackage.dependencies.i18next).toBe('26.3.1');
    expect(remotePackage.dependencies['react-i18next']).toBeUndefined();
    expect(remotePackage.dependencies['node-fetch']).toBe('^3.3.2');
    expect(remotePackage.devDependencies['zephyr-rspack-plugin']).toBe('1.1.1');
    expect(
      remotePackage.devDependencies['zephyr-modernjs-plugin'],
    ).toBeUndefined();
    expect(remotePackage.devDependencies.tailwindcss).toBe('^4.3.1');
    expect(remotePackage['zephyr:dependencies']).toEqual({});
    expectBleedingDevModernDependency(
      remotePackage,
      'dependencies',
      '@modern-js/plugin-bff',
    );
    expect(remotePackage.exports).toMatchObject({
      './api/client': './src/api/catalog-client.ts',
      './api': './shared/api.ts',
    });
    expectNoPath(workspaceDir, 'services/service-catalog-effect');

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage['zephyr:dependencies']).toMatchObject({
      catalog: '@ultra-add-remote-workspace/catalog@workspace:*',
    });

    const shellContract = getGeneratedAppContract(
      workspaceDir,
      'shell-super-app',
    );
    const generatedContract = readGeneratedContract(workspaceDir);
    const baseTsConfig = readJson(workspaceDir, 'tsconfig.base.json');
    const rootTsConfig = readJson(workspaceDir, 'tsconfig.json');
    const shellTsConfig = readJson(
      workspaceDir,
      'apps/shell-super-app/tsconfig.json',
    );
    const catalogTsConfig = readJson(
      workspaceDir,
      'verticals/catalog/tsconfig.json',
    );
    const catalogMfTypesTsConfig = readJson(
      workspaceDir,
      'verticals/catalog/tsconfig.mf-types.json',
    );
    expect(baseTsConfig.compilerOptions.allowImportingTsExtensions).toBe(true);
    expect(rootTsConfig.references).toEqual([
      { path: 'packages/shared-contracts' },
      { path: 'packages/shared-design-tokens' },
      { path: 'apps/shell-super-app' },
      { path: 'verticals/catalog' },
    ]);
    expect(shellTsConfig.references).toEqual([
      { path: '../../packages/shared-contracts' },
      { path: '../../packages/shared-design-tokens' },
      { path: '../../verticals/catalog' },
    ]);
    expect(catalogTsConfig).toMatchObject({
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        composite: true,
        declaration: true,
        declarationMap: false,
        emitDeclarationOnly: true,
        incremental: true,
        noEmit: false,
        outDir:
          '../../node_modules/.cache/tsgo/declarations/verticals__catalog',
        tsBuildInfoFile:
          '../../node_modules/.cache/tsgo/verticals__catalog.tsbuildinfo',
      },
      include: [
        'src',
        'locales/**/*.json',
        'modern.config.ts',
        'module-federation.config.ts',
        'package.json',
        'shared',
        'api',
      ],
      references: [
        { path: '../../packages/shared-contracts' },
        { path: '../../packages/shared-design-tokens' },
      ],
    });
    expect(catalogMfTypesTsConfig).toEqual({
      extends: './tsconfig.json',
      include: [
        'src/federation-entry.tsx',
        'src/components/catalog-widget.tsx',
        'src/modern-app-env.d.ts',
      ],
    });
    expect(shellContract.moduleFederation.remotes).toContainEqual(
      expect.objectContaining({
        id: 'catalog',
        alias: 'catalog',
        name: 'verticalCatalog',
        manifestEnv: 'VERTICAL_CATALOG_MF_MANIFEST',
        manifestUrl: 'http://localhost:4101/mf-manifest.json',
      }),
    );
    const catalogContract = getGeneratedAppContract(workspaceDir, 'catalog');
    const catalogModuleFederationConfig = readText(
      workspaceDir,
      'verticals/catalog/module-federation.config.ts',
    );
    const catalogModernConfig = readText(
      workspaceDir,
      'verticals/catalog/modern.config.ts',
    );
    const catalogApiEntry = readText(
      workspaceDir,
      'verticals/catalog/api/index.ts',
    );
    const catalogApi = readText(
      workspaceDir,
      'verticals/catalog/shared/api.ts',
    );
    expect(catalogModuleFederationConfig).toContain(
      "tsConfigPath: './tsconfig.mf-types.json'",
    );
    expect(catalogModernConfig).toContain("entry: './api/index'");
    expect(catalogModernConfig).toContain('const assetPrefix =');
    expectDedicatedAssetPrefixExpression(catalogModernConfig);
    expect(catalogModernConfig).toContain("assetPrefix: '/',");
    expect(catalogModernConfig).toContain('assetPrefix,');
    expect(catalogModernConfig).toMatch(
      /const siteUrl =\s*configuredSiteUrl \|\|\s*configuredCloudflareUrl \|\|/,
    );
    expect(catalogApi).toContain(
      'limit: Schema.optional(Schema.FiniteFromString)',
    );
    expect(catalogApi).not.toContain('Schema.NumberFromString');
    expect(catalogApiEntry).toContain("from '../shared/ultramodern-build.ts'");
    expect(catalogApiEntry).not.toContain('../../src/ultramodern-build');
    expect(catalogApiEntry).toContain("from '../shared/api.ts'");
    expect(catalogModuleFederationConfig).toMatch(
      /bridge:\s*\{\s*enableBridgeRouter:\s*false,\s*\}/u,
    );
    expect(catalogModuleFederationConfig).not.toContain(
      'enableBridgeRouter: true',
    );
    expect(catalogModuleFederationConfig).not.toContain('bridgeRouterAlias');
    expectCssFederationContract(generatedContract, catalogContract, {
      classPrefix: 'catalog:',
      ownedLayers: ['ultramodern-vertical-catalog'],
      role: 'vertical-css',
      rootSelector: '[data-app-id="catalog"]',
    });
    expect(catalogContract.routes).toMatchObject({
      metadataAuthoring: 'colocated-route-meta',
      generatedManifest: true,
      privateByDefault: true,
      publicnessDefault: 'private-app-screen',
      publicRoutes: [],
      publicHead: {
        generator: './src/routes/ultramodern-route-head',
        ssr: true,
        structuredData: {
          optional: true,
          source: 'route.jsonLd',
          inference: false,
        },
      },
    });
    expect(catalogContract.routes.owned).toEqual([
      expect.objectContaining({
        descriptionKey: 'catalog.seo.description',
        id: 'catalog-home',
        public: false,
        indexable: false,
        publicSurface: 'private-app-screen',
      }),
    ]);
    expectRouteMetadataCompatibility(workspaceDir, 'verticals/catalog', {
      localisedUrls: catalogContract.i18n.localisedUrls,
      namespace: catalogContract.i18n.namespace,
      publicRoutes: catalogContract.routes.publicRoutes,
      routes: catalogContract.routes.owned,
    });
    expectPrivatePublicSurface(
      workspaceDir,
      'apps/shell-super-app',
      shellContract.routes,
    );
    expectPrivatePublicSurface(
      workspaceDir,
      'verticals/catalog',
      catalogContract.routes,
    );
    await expectGeneratedCloudflareProofContract(workspaceDir, [
      'shell-super-app',
      'catalog',
    ]);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    expect(topology.shell.verticalRefs).toEqual(['catalog']);
    expect(
      topology.verticals.find(
        (vertical: { id: string }) => vertical.id === 'catalog',
      ),
    ).toMatchObject({
      api: {
        runtime: 'effect',
        bff: {
          prefix: '/catalog-api',
          openapi: '/openapi.json',
          strictEffectApproach: true,
        },
        contract: {
          export: './api',
          path: 'verticals/catalog/shared/api.ts',
        },
        client: {
          export: './api/client',
          path: 'verticals/catalog/src/api/catalog-client.ts',
        },
        serverEntry: 'verticals/catalog/api/index.ts',
      },
      moduleFederation: {
        manifestUrl: 'http://localhost:4101/mf-manifest.json',
      },
    });
    expect(
      topology.verticals.find(
        (vertical: { id: string }) => vertical.id === 'catalog',
      ).api.effect,
    ).toBeUndefined();
    expect(
      (topology.effectServices ?? []).some(
        (service: { id: string }) => service.id === 'service-catalog-effect',
      ),
    ).toBe(false);

    const ownership = readJson(workspaceDir, 'topology/ownership.json');
    expect(
      ownership.owners.find((owner: { id: string }) => owner.id === 'catalog')
        .ownership.team,
    ).toBe('super-app-platform');

    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    expect(overlay.ports.catalog).toBe(4101);
    expect(overlay.manifests.catalog).toBe(
      'http://localhost:4101/mf-manifest.json',
    );
    expect(overlay.apis.catalog).toBe('http://localhost:4101/catalog-api');
    expect(overlay.services?.['service-catalog-effect']).toBeUndefined();
  });

  test('keeps numbered vertical Tailwind prefixes unique', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-numbered-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    runCreateInWorkspace(workspaceDir, [
      'erp-vertical-011',
      '--vertical',
      '--lang',
      'en',
    ]);
    runCreateInWorkspace(workspaceDir, [
      'erp-vertical-012',
      '--vertical',
      '--lang',
      'en',
    ]);

    const generatedContract = readGeneratedContract(workspaceDir);
    expectCssFederationContract(
      generatedContract,
      getGeneratedAppContract(workspaceDir, 'erp-vertical-011'),
      {
        classPrefix: 'erpverticalzerooneone:',
        ownedLayers: ['ultramodern-vertical-erp-vertical-011'],
        role: 'vertical-css',
        rootSelector: '[data-app-id="erp-vertical-011"]',
      },
    );
    expectCssFederationContract(
      generatedContract,
      getGeneratedAppContract(workspaceDir, 'erp-vertical-012'),
      {
        classPrefix: 'erpverticalzeroonetwo:',
        ownedLayers: ['ultramodern-vertical-erp-vertical-012'],
        role: 'vertical-css',
        rootSelector: '[data-app-id="erp-vertical-012"]',
      },
    );
    expect(
      readText(workspaceDir, 'verticals/erp-vertical-011/src/routes/index.css'),
    ).toContain('prefix(erpverticalzerooneone)');
    expect(
      readText(workspaceDir, 'verticals/erp-vertical-012/src/routes/index.css'),
    ).toContain('prefix(erpverticalzeroonetwo)');

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage['zephyr:dependencies']).toMatchObject({
      erpVertical011: '@ultra-numbered-workspace/erp-vertical-011@workspace:*',
      erpVertical012: '@ultra-numbered-workspace/erp-vertical-012@workspace:*',
    });
    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );
  });

  test('rejects the removed legacy microvertical flag', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-legacy-flag-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);
    expect(() =>
      runCreateInWorkspace(workspaceDir, [
        'catalog-api',
        '--microvertical',
        'service',
        '--lang',
        'en',
      ]),
    ).toThrow(/Unexpected positional argument: --microvertical/u);
    expectNoPath(workspaceDir, 'services/service-catalog-api-effect');
  });

  test('scaffolds install-backed Modern package source metadata', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-install-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, [
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.0',
      '--ultramodern-package-registry',
      'https://registry.example.test/',
      '--lang',
      'en',
    ]);

    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.modernjs.packageSource).toEqual({
      strategy: 'install',
      config: './.modernjs/ultramodern.json',
    });
    expect(rootPackage.devDependencies['@modern-js/create']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(rootPackage.devDependencies['@modern-js/code-tools']).toBe(
      '3.2.0-ultramodern.0',
    );

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    expect(ultramodernConfig.packageSource.strategy).toBe('install');
    expect(ultramodernConfig.packageSource.modernPackageVersion).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(ultramodernConfig.packageSource.registry).toBe(
      'https://registry.example.test/',
    );

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-tanstack']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/runtime']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-bff']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(
      shellPackage.dependencies['@ultra-install-workspace/shared-effect-api'],
    ).toBeUndefined();
    expect(shellPackage.devDependencies['@modern-js/app-tools']).toBe(
      '3.2.0-ultramodern.0',
    );
    expect(
      shellPackage.dependencies['@ultra-install-workspace/shared-contracts'],
    ).toBe('workspace:*');
    expect(
      shellPackage.dependencies[
        '@ultra-install-workspace/shared-design-tokens'
      ],
    ).toBe('workspace:*');

    expectNoPath(
      workspaceDir,
      'services/service-recommendations-effect/package.json',
    );

    expectNoPath(workspaceDir, 'packages/shared-effect-api');

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );
  });

  test('generates public surface assets from route-owned content sources', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-public-content-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, ['--lang', 'en']);

    const generatedContract = readGeneratedContract(workspaceDir);
    const shellContract = generatedContract.apps.find(
      app => app.id === 'shell-super-app',
    )!;
    shellContract.routes.publicSurface.publicRoutes = [
      {
        canonicalPath: '/talks/:slug',
        descriptionKey: 'shell.talks.detail.meta.description',
        id: 'talk-detail',
        localisedPaths: {
          en: '/talks/:slug',
          cs: '/prednasky/:slug',
        },
        namespace: 'shell',
        ownerAppId: 'shell-super-app',
        titleKey: 'shell.talks.detail.title',
      },
      {
        canonicalPath: '/sessions/:slug',
        descriptionKey: 'shell.sessions.detail.meta.description',
        id: 'session-detail',
        localisedPaths: {
          en: '/sessions/:slug',
          cs: '/sezeni/:slug',
        },
        namespace: 'shell',
        ownerAppId: 'shell-super-app',
        titleKey: 'shell.sessions.detail.title',
      },
      {
        canonicalPath: '/optional/:slug?',
        descriptionKey: 'shell.optional.detail.meta.description',
        id: 'optional-detail',
        localisedPaths: {
          en: '/optional/:slug?',
          cs: '/volitelne/:slug?',
        },
        namespace: 'shell',
        ownerAppId: 'shell-super-app',
        titleKey: 'shell.optional.detail.title',
      },
    ];
    shellContract.routes.publicSurface.contentSources = [
      {
        entryExport: 'default-or-entries',
        module: 'src/routes/[lang]/talks/[slug]/route.sitemap.mjs',
        routeId: 'talk-detail',
      },
    ];
    shellContract.routes.publicSurface.files = [
      'robots.txt',
      'sitemap.xml',
      'site.webmanifest',
    ];
    shellContract.routes.publicSurface.routeEntries = [];
    shellContract.routes.publicSurface.concreteUrlPaths = [];
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const shellConfig = ultramodernConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'shell-super-app',
    );
    expect(shellConfig).toBeDefined();
    shellConfig!.routes = {
      publicSurface: shellContract.routes.publicSurface,
    };
    writeText(
      workspaceDir,
      '.modernjs/ultramodern.json',
      `${JSON.stringify(ultramodernConfig, null, 2)}\n`,
    );
    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/talks/[slug]/route.sitemap.mjs',
      `/** @type {import('@ultra-public-content-workspace/shared-contracts').UltramodernPublicSitemapEntry[]} */
export const entries = [
  {
    params: { slug: 'building-public-web' },
    localeParams: { cs: { slug: 'verejny-web' } },
    lastModified: '2026-06-10',
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    params: { slug: 'draft-talk' },
    draft: true,
  },
  {
    params: { slug: 'noindex-talk' },
    indexable: false,
  },
];
`,
    );
    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/sessions/[slug]/route.sitemap.mjs',
      `export default function loadSessionEntries(context) {
  if (context.appId !== 'shell-super-app') {
    throw new Error('Unexpected appId ' + context.appId);
  }
  if (context.routeId !== 'session-detail') {
    throw new Error('Unexpected routeId ' + context.routeId);
  }
  if (!Array.isArray(context.languages) || context.languages.join(',') !== 'en,cs') {
    throw new Error('Unexpected languages ' + context.languages);
  }
  return [
    {
      params: { slug: 'provider-loader' },
      localeParams: { cs: { slug: 'nacist-poskytovatele' } },
      lastModified: '2026-06-11',
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
`,
    );
    writeText(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/optional/[slug$]/route.sitemap.mjs',
      `export const entries = [
  {
    params: { slug: 'route-owned-optional' },
    localeParams: { cs: { slug: 'volitelny-segment' } },
  },
];
`,
    );

    execFileSync(
      process.execPath,
      [
        'scripts/generate-public-surface-assets.mts',
        '--app',
        'shell-super-app',
        '--target',
        'dist',
        '--require-public-origin',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP: 'https://example.com',
        },
        stdio: 'pipe',
      },
    );

    const sitemap = readText(
      workspaceDir,
      'apps/shell-super-app/dist/public/sitemap.xml',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/talks/building-public-web</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/prednasky/verejny-web</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/sessions/provider-loader</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/sezeni/nacist-poskytovatele</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/en/optional/route-owned-optional</loc>',
    );
    expect(sitemap).toContain(
      '<loc>https://example.com/cs/volitelne/volitelny-segment</loc>',
    );
    expect(sitemap).toContain('hreflang="x-default"');
    expect(sitemap).toContain('<lastmod>2026-06-10</lastmod>');
    expect(sitemap).toContain('<lastmod>2026-06-11</lastmod>');
    expect(sitemap).toContain('<changefreq>monthly</changefreq>');
    expect(sitemap).toContain('<changefreq>weekly</changefreq>');
    expect(sitemap).toContain('<priority>0.7</priority>');
    expect(sitemap).toContain('<priority>1</priority>');
    expect(sitemap).not.toContain('draft-talk');
    expect(sitemap).not.toContain('noindex-talk');

    const robots = readText(
      workspaceDir,
      'apps/shell-super-app/dist/public/robots.txt',
    );
    expect(robots).toContain('Allow: /en/talks/building-public-web$');
    expect(robots).toContain('Allow: /cs/prednasky/verejny-web$');
    expect(robots).toContain('Allow: /en/sessions/provider-loader$');
    expect(robots).toContain('Allow: /cs/sezeni/nacist-poskytovatele$');
    expect(robots).toContain('Allow: /en/optional/route-owned-optional$');
    expect(robots).toContain('Allow: /cs/volitelne/volitelny-segment$');
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');

    const webManifest = readJson(
      workspaceDir,
      'apps/shell-super-app/dist/public/site.webmanifest',
    );
    expect(webManifest.scope).toBe('/');
    expect(webManifest.start_url).toMatch(/^\/(cs|en)\//u);

    // Site-wide MODERN_PUBLIC_SITE_URL must win over per-app ULTRAMODERN_PUBLIC_URL_*
    // for SEO output (sitemap/robots origins), regardless of per-app env being set.
    execFileSync(
      process.execPath,
      [
        'scripts/generate-public-surface-assets.mts',
        '--app',
        'shell-super-app',
        '--target',
        'cloudflare',
      ],
      {
        cwd: workspaceDir,
        env: {
          ...generatedToolEnv(),
          MODERN_PUBLIC_SITE_URL: 'https://global.example/path-is-ignored',
          ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP:
            'https://per-app.example.workers.dev',
        },
        stdio: 'pipe',
      },
    );
    const cloudflareSitemap = readText(
      workspaceDir,
      'apps/shell-super-app/.output/public/sitemap.xml',
    );
    expect(cloudflareSitemap).toContain(
      '<loc>https://global.example/en/sessions/provider-loader</loc>',
    );
    const cloudflareRobots = readText(
      workspaceDir,
      'apps/shell-super-app/.output/public/robots.txt',
    );
    expect(cloudflareRobots).toContain(
      'Sitemap: https://global.example/sitemap.xml',
    );
  });

  test('scaffolds npm alias package source metadata for external forks', () => {
    const workspaceDir = path.join(tempRoot, 'ultra-alias-workspace');
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    runCreate(workspaceDir, [
      '--ultramodern-package-source',
      'install',
      '--ultramodern-package-version',
      '3.2.0-ultramodern.0',
      '--ultramodern-package-scope',
      'bleedingdev',
      '--ultramodern-package-name-prefix',
      'modern-js-',
      '--lang',
      'en',
    ]);

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    expect(ultramodernConfig.packageSource).toMatchObject({
      aliasScope: 'bleedingdev',
      aliasPackageNamePrefix: 'modern-js-',
      modernPackageVersion: '3.2.0-ultramodern.0',
      strategy: 'install',
    });

    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-tanstack']).toBe(
      'npm:@bleedingdev/modern-js-plugin-tanstack@3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/plugin-i18n']).toBe(
      'npm:@bleedingdev/modern-js-plugin-i18n@3.2.0-ultramodern.0',
    );
    expect(shellPackage.dependencies['@modern-js/runtime']).toBe(
      'npm:@bleedingdev/modern-js-runtime@3.2.0-ultramodern.0',
    );
    expect(shellPackage.devDependencies['@modern-js/app-tools']).toBe(
      'npm:@bleedingdev/modern-js-app-tools@3.2.0-ultramodern.0',
    );
    const rootPackage = readJson(workspaceDir, 'package.json');
    expect(rootPackage.devDependencies['@modern-js/create']).toBe(
      'npm:@bleedingdev/modern-js-create@3.2.0-ultramodern.0',
    );
    expect(rootPackage.devDependencies['@modern-js/code-tools']).toBe(
      'npm:@bleedingdev/modern-js-code-tools@3.2.0-ultramodern.0',
    );

    const validationOutput = execFileSync(
      process.execPath,
      ['scripts/validate-ultramodern-workspace.mts'],
      {
        cwd: workspaceDir,
        env: generatedToolEnv(),
        stdio: 'pipe',
      },
    ).toString();
    expect(validationOutput.trim()).toBe(
      'UltraModern workspace scaffold validated',
    );
  });
});
