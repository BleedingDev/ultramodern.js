import {
  appHasApi,
  appI18nNamespace,
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  resolveApiPrefix,
  resolveApiStem,
} from './descriptors';
import { createLocalisedUrlsMap } from './routes';
import type { JsonValue, WorkspaceApp } from './types';
import { isRecord } from './types';
import { CLOUDFLARE_COMPATIBILITY_DATE } from './versions';

function createCloudflareProofRoute(app: WorkspaceApp): JsonValue {
  if (app.kind === 'shell') {
    return {
      ssr: '/en',
      mfManifest: '/mf-manifest.json',
      locale: `/locales/en/${appI18nNamespace(app)}.json`,
    };
  }

  const languageRoutes = createLocalisedUrlsMap(app);
  const firstCanonicalPath = Object.keys(languageRoutes)[0];
  const localizedPath =
    firstCanonicalPath && isRecord(languageRoutes[firstCanonicalPath])
      ? (languageRoutes[firstCanonicalPath].en as string | undefined)
      : undefined;

  return {
    ssr: localizedPath ?? '/en',
    mfManifest: '/mf-manifest.json',
    locale: `/locales/en/${appI18nNamespace(app)}.json`,
    ...(appHasApi(app)
      ? {
          apiReadiness: `${resolveApiPrefix(app)}/${resolveApiStem(
            app,
          )}/readiness`,
        }
      : {}),
  };
}

export function createCloudflareSecurityContract(): JsonValue {
  return {
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
      },
      reason:
        'Report-only by default so Cloudflare Module Federation SSR can prove remote script, style, and connect compatibility before enforcement.',
    },
    noindex: {
      workersDev: true,
      localhost: true,
      previewHostnames: [],
    },
    // No `cookies` block: deploy.worker.security.cookies is a deprecated
    // no-op (the worker never owned Set-Cookie); CORS defaults are correct
    // for federated workspaces (assets wildcard, BFF/SSR same-origin).
  };
}

const PUBLIC_WEBSITE_POLICY = {
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
      decision:
        'Report-only remains the generated final mode until public smoke proof records MF SSR script/style/connect compatibility for the deployed surface.',
    },
  },
  publicHead: {
    indexableRobots: 'index, follow',
    privateRouteRobots: 'noindex, nofollow',
  },
  publicSurface: {
    defaultProviderFile: 'route.sitemap.mjs',
    draftPolicy: 'omit-draft-by-default',
    indexablePolicy: 'omit-indexable-false',
  },
};

export function formatTsJsonValue(value: JsonValue, indent: number): string {
  return JSON.stringify(value, null, 2).replaceAll(
    '\n',
    `\n${' '.repeat(indent)}`,
  );
}

function formatIntegerCodeLiteral(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, '_');
}

function createPublicWebsiteQualityGateContract(): JsonValue {
  return PUBLIC_WEBSITE_POLICY.qualityGates;
}

function createPublicWebsiteBudgetFallback(
  budgetName: keyof (typeof PUBLIC_WEBSITE_POLICY)['qualityGates']['budgets'],
): string {
  return formatIntegerCodeLiteral(
    PUBLIC_WEBSITE_POLICY.qualityGates.budgets[budgetName],
  );
}

export function createPublicHeadRobotsPolicy() {
  return PUBLIC_WEBSITE_POLICY.publicHead;
}

export function createPublicSurfaceContentExpansionPolicy() {
  return PUBLIC_WEBSITE_POLICY.publicSurface;
}

export function createCloudflareDeployContract(
  scope: string,
  app: WorkspaceApp,
): JsonValue {
  return {
    target: 'cloudflare',
    workerName: createCloudflareWorkerName(scope, app),
    publicUrlEnv: createCloudflarePublicUrlEnv(app),
    compatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    assetsBinding: 'ASSETS',
    routes: createCloudflareProofRoute(app),
    security: createCloudflareSecurityContract(),
    qualityGates: createPublicWebsiteQualityGateContract(),
    evidence: {
      proofScript: 'scripts/proof-cloudflare-version.mts',
      reportDefault:
        '.codex/reports/cloudflare-version-proof/public-url-proof.json',
    },
  };
}
