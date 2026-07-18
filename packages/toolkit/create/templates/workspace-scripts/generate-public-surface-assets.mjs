#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const compactConfigPath = path.join(workspaceRoot, '.modernjs/ultramodern.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function toKebabCase(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function toEnvSegment(value) {
  return toKebabCase(value).replace(/-/gu, '_').toUpperCase();
}

function normalizeRelativePath(value) {
  return String(value ?? '').replace(/\\/gu, '/').replace(/^\.\/+/u, '');
}

function appNamespace(app) {
  return app.kind === 'shell' ? 'shell' : (app.domain ?? app.id);
}

function defaultPortEnv(app) {
  return app.kind === 'shell'
    ? 'SHELL_SUPER_APP_PORT'
    : `VERTICAL_${toEnvSegment(app.domain ?? app.id)}_PORT`;
}

function defaultPort(app) {
  return app.kind === 'shell' ? 3020 : 3030;
}

function normalizeCompactApp(rawApp) {
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
        : defaultPort({ id, kind, domain }),
    portEnv:
      typeof rawApp.portEnv === 'string'
        ? rawApp.portEnv
        : defaultPortEnv({ id, kind, domain }),
    mfName:
      typeof moduleFederation.name === 'string'
        ? moduleFederation.name
        : kind === 'shell'
          ? 'shellSuperApp'
          : `vertical${toKebabCase(domain ?? id)
              .split('-')
              .filter(Boolean)
              .map(part => part.charAt(0).toUpperCase() + part.slice(1))
              .join('')}`,
    exposes: Array.isArray(moduleFederation.exposes)
      ? moduleFederation.exposes.filter(expose => typeof expose === 'string')
      : [],
    verticalRefs: Array.isArray(moduleFederation.verticalRefs)
      ? moduleFederation.verticalRefs.filter(ref => typeof ref === 'string')
      : [],
    marker: {
      appId: id,
    },
    routes:
      rawApp.routes && typeof rawApp.routes === 'object'
        ? rawApp.routes
        : undefined,
    api:
      rawApp.api && typeof rawApp.api === 'object'
        ? {
            stem:
              typeof rawApp.api.stem === 'string'
                ? rawApp.api.stem
                : domain ?? id,
            prefix:
              typeof rawApp.api.prefix === 'string'
                ? rawApp.api.prefix
                : `/${domain ?? id}-api`,
          }
        : undefined,
  };
}

function createRouteOwnedEntries(app) {
  const namespace = appNamespace(app);
  const base = {
    descriptionKey: `${namespace}.seo.description`,
    mfBoundaryId: app.mfName,
    namespace,
    ownerAppId: app.id,
    public: false,
    indexable: false,
    publicSurface: 'private-app-screen',
  };

  return [
    {
      ...base,
      canonicalPath: '/',
      id: app.kind === 'shell' ? 'shell-home' : `${app.id}-home`,
      localisedPaths: {
        cs: '/',
        en: '/',
      },
      titleKey: app.kind === 'shell' ? 'shell.title' : `${namespace}.title`,
    },
  ];
}

function createPublicRoutes(app) {
  return createRouteOwnedEntries(app)
    .filter(route => route.public && route.indexable)
    .map(route => ({
      canonicalPath: route.canonicalPath,
      id: route.id,
      localisedPaths: route.localisedPaths,
      namespace: route.namespace,
      ownerAppId: route.ownerAppId,
      descriptionKey: route.descriptionKey,
      titleKey: route.titleKey,
    }));
}

function createPublicSurface(app) {
  const publicRoutes = createPublicRoutes(app);
  const basePublicSurface = {
    authoring: 'colocated-route-meta',
    artifactLifecycle: 'build-and-deploy-output',
    generatedManifest: './src/routes/ultramodern-route-metadata',
    source: 'route-owned-public-routes',
    metadataExport: './src/routes/ultramodern-route-metadata',
    generator: 'scripts/generate-public-surface-assets.mts',
    outputRoot: 'dist/public',
    cloudflareBuildOutputRoot: 'dist-cloudflare/public',
    privateRoutePolicy: 'omit-from-generated-public-surface',
    files:
      publicRoutes.length > 0
        ? ['robots.txt', 'sitemap.xml', 'site.webmanifest']
        : ['robots.txt'],
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
    publicRoutes,
    routeEntries: [],
    concreteUrlPaths: [],
  };

  return app.routes?.publicSurface &&
    typeof app.routes.publicSurface === 'object'
    ? {
        ...basePublicSurface,
        ...app.routes.publicSurface,
      }
    : basePublicSurface;
}

function createCloudflareDeploy(config, app) {
  const packageScope =
    typeof config.workspace?.packageScope === 'string'
      ? config.workspace.packageScope
      : path.basename(workspaceRoot);
  const compatibilityDate =
    typeof config.deploy?.worker?.compatibilityDate === 'string'
      ? config.deploy.worker.compatibilityDate
      : '2026-06-02';
  return {
    workerName: `${toKebabCase(packageScope)}-${app.packageSuffix}`.slice(0, 63),
    publicUrlEnv: `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(app.id)}`,
    compatibilityDate,
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  };
}

function synthesizeContractFromCompactConfig(config) {
  const apps = Array.isArray(config.topology?.apps)
    ? config.topology.apps.map(normalizeCompactApp)
    : [];

  return {
    sourcePath: compactConfigPath,
    apps: apps.map(app => ({
      ...app,
      deploy: {
        cloudflare: createCloudflareDeploy(config, app),
      },
      routes: {
        publicSurface: createPublicSurface(app),
      },
    })),
  };
}

function readGeneratedContractView() {
  if (fs.existsSync(compactConfigPath)) {
    return synthesizeContractFromCompactConfig(readJson(compactConfigPath));
  }
  throw new Error(
    `Missing UltraModern config. Expected ${path.relative(
      workspaceRoot,
      compactConfigPath,
    )}.`,
  );
}

function parseArgs(argv) {
  const parsed = {
    appId: undefined,
    target: 'dist',
    requirePublicOrigin: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app') {
      parsed.appId = argv[index + 1];
      index += 1;
    } else if (arg === '--target') {
      parsed.target = argv[index + 1];
      index += 1;
    } else if (arg === '--require-public-origin') {
      parsed.requirePublicOrigin = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.appId && !parsed.help) {
    throw new Error('Missing required --app argument');
  }
  if (!['dist', 'cloudflare-dist'].includes(parsed.target)) {
    throw new Error(`Unsupported public surface target: ${parsed.target}`);
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/generate-public-surface-assets.mts --app shell-super-app [--target dist|cloudflare-dist] [--require-public-origin]

Set each app's production URL using the contract env key, for example:
  ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://example.com

Dynamic public routes can opt into sitemap expansion by adding a route-owned
route.sitemap.mjs provider beside route metadata, or by adding an
explicit provider to routes.publicSurface.contentSources. Providers should export
an entries array, entries() function, or default entries/loader returning
UltramodernPublicSitemapEntry[].
`);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const url = new URL(value);
  return url.origin;
}

function resolveOrigin(app, requirePublicOrigin) {
  const cloudflare = app.deploy?.cloudflare ?? {};
  const publicUrlEnv = cloudflare.publicUrlEnv;
  const fromAppEnv =
    typeof publicUrlEnv === 'string' ? normalizeOrigin(process.env[publicUrlEnv]) : undefined;
  const fromGlobalEnv = normalizeOrigin(process.env.MODERN_PUBLIC_SITE_URL);
  const workersDevSubdomain = process.env.ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN;
  const fromWorkersDev =
    typeof workersDevSubdomain === 'string' && workersDevSubdomain.trim() !== ''
      ? normalizeOrigin(`https://${cloudflare.workerName}.${workersDevSubdomain}.workers.dev`)
      : undefined;

  // SEO output (sitemap <loc>, robots Sitemap:) uses the site-wide origin
  // first; the per-app deployment URL is only a fallback.
  const configuredOrigin = fromGlobalEnv ?? fromAppEnv ?? fromWorkersDev;
  if (configuredOrigin) {
    return configuredOrigin;
  }
  if (requirePublicOrigin) {
    throw new Error(
      `${app.id} has public routes but no production public URL. Set ${publicUrlEnv ?? 'ULTRAMODERN_PUBLIC_URL_<APP>'} or MODERN_PUBLIC_SITE_URL.`,
    );
  }
  return undefined;
}

function ensureOutputDir(app, target) {
  const relativeDir =
    target === 'cloudflare-dist'
      ? app.routes?.publicSurface?.cloudflareBuildOutputRoot
      : app.routes?.publicSurface?.outputRoot;
  if (typeof relativeDir !== 'string') {
    throw new Error(`${app.id} public surface contract is missing outputRoot for ${target}`);
  }
  const outputDir = path.resolve(workspaceRoot, app.path, relativeDir);
  const appRoot = path.resolve(workspaceRoot, app.path);
  if (!outputDir.startsWith(appRoot + path.sep)) {
    throw new Error(`${app.id} public surface output escaped the app directory`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function resolveAppRelativePath(app, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.trim() === '' ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(app.id + ' public content source has an unsafe module path');
  }
  const appRoot = path.resolve(workspaceRoot, app.path);
  const resolved = path.resolve(appRoot, relativePath);
  if (resolved !== appRoot && !resolved.startsWith(appRoot + path.sep)) {
    throw new Error(app.id + ' public content source escaped the app directory');
  }
  return resolved;
}

function normalizePublicPath(pathname) {
  if (typeof pathname !== 'string') {
    throw new Error('Public route path must be a string');
  }
  const normalised = pathname
    .trim()
    .replaceAll(/\/+/gu, '/')
    .replace(/\/+$/u, '');
  return normalised.length > 0 && normalised.startsWith('/')
    ? normalised
    : '/' + normalised;
}

function createLocalisedPublicPath(pathname, language) {
  const publicPath = normalizePublicPath(pathname);
  return publicPath === '/' ? '/' + language : '/' + language + publicPath;
}

function splitPublicPathSegments(pathname) {
  return normalizePublicPath(pathname).split('/').filter(Boolean);
}

function routePathParamName(segment) {
  if (segment.startsWith(':')) {
    return segment.slice(1).replace(/[?*+]$/u, '');
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return segment.slice(1, -1).replace(/^\.\.\./u, '').replace(/\$$/u, '');
  }
  return undefined;
}

function routeSegmentToDirectory(segment) {
  const paramName = routePathParamName(segment);
  if (paramName && segment.startsWith(':')) {
    return segment.endsWith('?') ? '[' + paramName + '$]' : '[' + paramName + ']';
  }
  return segment;
}

function assertParamValue(routeId, language, paramName, value) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error(routeId + ' ' + language + ' sitemap param ' + paramName + ' must be a string, number, or boolean');
  }
  const text = String(value).trim();
  if (text === '' || text.includes('/')) {
    throw new Error(routeId + ' ' + language + ' sitemap param ' + paramName + ' must be a non-empty path segment');
  }
  return encodeURIComponent(text);
}

function expandPublicPathPattern(routeId, language, pattern, params) {
  const segments = splitPublicPathSegments(pattern);
  if (segments.length === 0) {
    return '/';
  }
  const expanded = segments.map(segment => {
    const paramName = routePathParamName(segment);
    if (!paramName) {
      if (segment.includes('*')) {
        throw new Error(routeId + ' ' + language + ' sitemap expansion does not support wildcard path segment ' + segment);
      }
      return segment;
    }
    if (!Object.prototype.hasOwnProperty.call(params, paramName)) {
      throw new Error(routeId + ' ' + language + ' sitemap entry is missing param ' + paramName);
    }
    return assertParamValue(routeId, language, paramName, params[paramName]);
  });
  return '/' + expanded.join('/');
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
  return value;
}

function normalizeSitemapFields(routeId, entry) {
  const normalized = {};
  if (entry.lastModified !== undefined) {
    const lastModified = String(entry.lastModified).trim();
    if (lastModified === '' || Number.isNaN(Date.parse(lastModified))) {
      throw new Error(routeId + ' sitemap entry has invalid lastModified');
    }
    normalized.lastModified = lastModified;
  }
  if (entry.changeFrequency !== undefined) {
    const allowed = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
    if (!allowed.has(entry.changeFrequency)) {
      throw new Error(routeId + ' sitemap entry has invalid changeFrequency');
    }
    normalized.changeFrequency = entry.changeFrequency;
  }
  if (entry.priority !== undefined) {
    if (typeof entry.priority !== 'number' || entry.priority < 0 || entry.priority > 1) {
      throw new Error(routeId + ' sitemap entry priority must be a number between 0 and 1');
    }
    normalized.priority = entry.priority;
  }
  return normalized;
}

function routePathToProviderDirectory(routePath) {
  const segments = splitPublicPathSegments(routePath);
  if (segments.length === 0) {
    return 'src/routes/[lang]';
  }
  return path.posix.join(
    'src/routes/[lang]',
    ...segments.map(routeSegmentToDirectory),
  );
}

function createDiscoveredContentSources(app, publicSurface) {
  const explicitRouteIds = new Set(
    (publicSurface.contentSources ?? []).map(source => source.routeId),
  );
  const discovered = [];
  for (const route of publicSurface.publicRoutes ?? []) {
    if (
      explicitRouteIds.has(route.id) ||
      !Object.values(route.localisedPaths ?? {}).some(routePath =>
        /(?:^|\/):[^/]+|\[[^\]]+\]/u.test(routePath),
      )
    ) {
      continue;
    }
    const providerModule = path.posix.join(
      routePathToProviderDirectory(route.canonicalPath),
      'route.sitemap.mjs',
    );
    if (fs.existsSync(resolveAppRelativePath(app, providerModule))) {
      discovered.push({
        entryExport: 'default-or-entries',
        module: providerModule,
        routeId: route.id,
      });
    }
  }
  return discovered;
}

function resolveContentSources(app, publicSurface) {
  return [
    ...(publicSurface.contentSources ?? []),
    ...createDiscoveredContentSources(app, publicSurface),
  ];
}

async function loadContentSourceEntries(app, contentSource, languages) {
  if (typeof contentSource?.routeId !== 'string' || contentSource.routeId.trim() === '') {
    throw new Error(app.id + ' public content source is missing routeId');
  }
  const modulePath = resolveAppRelativePath(app, contentSource.module);
  const moduleExports = await import(pathToFileURL(modulePath).href);
  const exported = moduleExports.default ?? moduleExports.entries;
  const rawEntries =
    typeof exported === 'function'
      ? await exported({
          appId: app.id,
          languages,
          routeId: contentSource.routeId,
        })
      : exported;
  if (!Array.isArray(rawEntries)) {
    throw new Error(app.id + ' public content source for ' + contentSource.routeId + ' must export an entries array or loader');
  }
  return rawEntries;
}

async function expandContentSources(app, publicSurface, languages) {
  const routesById = new Map(
    (publicSurface.publicRoutes ?? []).map(route => [route.id, route]),
  );
  const expanded = [];
  for (const contentSource of resolveContentSources(app, publicSurface)) {
    const route = routesById.get(contentSource.routeId);
    if (!route) {
      throw new Error(app.id + ' public content source references unknown route ' + contentSource.routeId);
    }
    const rawEntries = await loadContentSourceEntries(app, contentSource, languages);
    for (const rawEntry of rawEntries) {
      const entry = assertPlainObject(rawEntry, route.id + ' sitemap entry');
      if (entry.draft === true || entry.indexable === false) {
        continue;
      }
      const baseParams = assertPlainObject(entry.params, route.id + ' sitemap entry params');
      const localeParams = entry.localeParams === undefined
        ? {}
        : assertPlainObject(entry.localeParams, route.id + ' sitemap entry localeParams');
      const localeUrlPaths = {};
      for (const language of languages) {
        const params = {
          ...baseParams,
          ...(localeParams[language] ?? {}),
        };
        localeUrlPaths[language] = createLocalisedPublicPath(
          expandPublicPathPattern(route.id, language, route.localisedPaths[language], params),
          language,
        );
      }
      expanded.push({
        ...route,
        ...normalizeSitemapFields(route.id, entry),
        canonicalUrlPath: localeUrlPaths.en,
        localeUrlPaths,
      });
    }
  }
  return expanded;
}

function mergeRouteEntries(routeEntries, expandedRouteEntries, languages) {
  const byKey = new Map();
  const urlPathOwners = new Map();
  for (const route of [...routeEntries, ...expandedRouteEntries]) {
    const key = route.id + ':' + route.canonicalUrlPath;
    if (byKey.has(key)) {
      throw new Error('Duplicate public sitemap route entry ' + key);
    }
    for (const language of languages) {
      const urlPath = route.localeUrlPaths?.[language];
      if (typeof urlPath !== 'string') {
        throw new Error(route.id + ' public route entry is missing ' + language + ' locale URL path');
      }
      const existingOwner = urlPathOwners.get(urlPath);
      if (existingOwner && existingOwner !== route.id) {
        throw new Error('Duplicate public sitemap URL path ' + urlPath + ' from ' + existingOwner + ' and ' + route.id);
      }
      urlPathOwners.set(urlPath, route.id);
    }
    byKey.set(key, route);
  }
  return Array.from(byKey.values()).sort(
    (left, right) =>
      left.canonicalUrlPath.localeCompare(right.canonicalUrlPath) ||
      left.id.localeCompare(right.id),
  );
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function createConcreteUrlPaths(routeEntries, languages) {
  return uniqueSorted(
    routeEntries.flatMap(route => languages.map(language => route.localeUrlPaths[language])),
  );
}

function escapeXmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replaceAll('"', '&quot;');
}

function renderRobotsTxt(urlPaths, sitemapUrl) {
  const lines = ['User-agent: *'];
  if (urlPaths.length === 0) {
    lines.push('Disallow: /');
  } else {
    for (const urlPath of urlPaths) {
      lines.push(`Allow: ${urlPath}$`);
    }
    lines.push('Disallow: /');
    if (sitemapUrl) {
      lines.push(`Sitemap: ${sitemapUrl}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderSitemapXml(origin, routeEntries, languages) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const route of routeEntries) {
    for (const language of languages) {
      lines.push('  <url>');
      lines.push(`    <loc>${escapeXmlText(`${origin}${route.localeUrlPaths[language]}`)}</loc>`);
      for (const alternateLanguage of languages) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${alternateLanguage}" href="${escapeXmlAttribute(
            `${origin}${route.localeUrlPaths[alternateLanguage]}`,
          )}" />`,
        );
      }
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXmlAttribute(
          `${origin}${route.localeUrlPaths.en}`,
        )}" />`,
      );
      if (route.lastModified) {
        lines.push(`    <lastmod>${escapeXmlText(route.lastModified)}</lastmod>`);
      }
      if (route.changeFrequency) {
        lines.push(`    <changefreq>${escapeXmlText(route.changeFrequency)}</changefreq>`);
      }
      if (route.priority !== undefined) {
        lines.push(`    <priority>${route.priority.toFixed(1).replace(/\.0$/u, '')}</priority>`);
      }
      lines.push('  </url>');
    }
  }

  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

function renderWebManifest(app, urlPaths) {
  const startUrl = urlPaths[0];
  const manifest = {
    background_color: '#ffffff',
    categories: ['business', 'productivity'],
    display: 'standalone',
    icons: [],
    lang: 'en',
    name: app.marker?.appId ?? app.id,
    short_name: app.marker?.appId ?? app.id,
    theme_color: '#133225',
    ...(startUrl ? { scope: '/', start_url: startUrl } : {}),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function removeIfExists(outputDir, fileName) {
  fs.rmSync(path.join(outputDir, fileName), { force: true });
}

function writeText(outputDir, fileName, content) {
  fs.writeFileSync(path.join(outputDir, fileName), content);
}

async function generatePublicSurfaceAssets(app, target, requirePublicOrigin) {
  const publicSurface = app.routes?.publicSurface ?? {};
  const languages = publicSurface.languages ?? ['en', 'cs'];
  const outputDir = ensureOutputDir(app, target);
  const shouldRequirePublicOrigin =
    requirePublicOrigin ||
    process.env.ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS === 'true';
  const routeEntries = mergeRouteEntries(
    publicSurface.routeEntries ?? [],
    await expandContentSources(app, publicSurface, languages),
    languages,
  );
  const urlPaths = createConcreteUrlPaths(routeEntries, languages);

  if (routeEntries.length === 0) {
    writeText(outputDir, 'robots.txt', renderRobotsTxt([], undefined));
    removeIfExists(outputDir, 'sitemap.xml');
    removeIfExists(outputDir, 'site.webmanifest');
    return;
  }

  const origin = resolveOrigin(app, shouldRequirePublicOrigin);
  if (!origin) {
    writeText(outputDir, 'robots.txt', renderRobotsTxt([], undefined));
    removeIfExists(outputDir, 'sitemap.xml');
    removeIfExists(outputDir, 'site.webmanifest');
    return;
  }

  writeText(outputDir, 'sitemap.xml', renderSitemapXml(origin, routeEntries, languages));
  writeText(outputDir, 'site.webmanifest', renderWebManifest(app, urlPaths));
  writeText(outputDir, 'robots.txt', renderRobotsTxt(urlPaths, `${origin}/sitemap.xml`));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const contract = readGeneratedContractView();
  const app = contract.apps?.find(candidate => candidate.id === args.appId);
  if (!app) {
    throw new Error(`Unknown app in UltraModern config: ${args.appId}`);
  }
  await generatePublicSurfaceAssets(app, args.target, args.requirePublicOrigin);
} catch (error) {
  process.stderr.write(`[public-surface] ${error.message}\n`);
  process.exitCode = 1;
}
