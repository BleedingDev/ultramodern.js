import type { ResolvedUltramodernPackageSource } from '../ultramodern-package-source';
import {
  assertReleaseCohortPackageSource,
  parseUltramodernReleaseCohort,
  releaseCohortSelectors,
  type UltramodernReleaseCohort,
} from '../ultramodern-release-cohort';
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
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  CLOUDFLARE_WORKERS_TYPES_VERSION,
  DRIZZLE_ORM_VERSION,
  EFFECT_TSGO_VERSION,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  I18NEXT_VERSION,
  LEFTHOOK_VERSION,
  MINIFLARE_VERSION,
  MODULE_FEDERATION_NODE_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  NODE_VERSION,
  OXFMT_VERSION,
  OXLINT_VERSION,
  PNPM_VERSION,
  REACT_DOM_VERSION,
  REACT_ROUTER_VERSION,
  REACT_VERSION,
  RSBUILD_PLUGIN_TAILWINDCSS_VERSION,
  TAILWIND_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPES_REACT_DOM_VERSION,
  TYPES_REACT_VERSION,
  TYPESCRIPT_COMPILER_API_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  TYPESCRIPT_VERSION,
  ULTRACITE_VERSION,
  WORKERD_VERSION,
  WRANGLER_VERSION,
  ZEPHYR_AGENT_VERSION,
  ZEPHYR_RSPACK_PLUGIN_VERSION,
} from './versions';

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

export type UltramodernReleaseAgeApproval = {
  packageName: string;
  version: string;
  reason: string;
  reviewer: string;
  reviewedAt: string;
  evidence: {
    uri: string;
    sha256: string;
    sha256Subject: 'git-commit-payload';
  };
  registry: {
    publishedAt: string;
    dist: {
      integrity: string;
    };
  };
  expiresAt: string;
};

export type UltramodernReleaseAgeCandidate = {
  packageName: string;
  version: string;
  registry: {
    publishedAt?: string;
    dist: {
      integrity: string;
    };
  };
};

export type UltramodernPatchPolicy = {
  packageName: string;
  version: string;
  path: string;
};

export type UltramodernStalePatchPolicy = UltramodernPatchPolicy & {
  sha256: string;
};

const releaseAgeReasons = {
  cloudflare:
    'Reviewed Cloudflare runtime cohort required by generated Worker tooling before pnpm minimum release age elapsed.',
  effect:
    'Reviewed Effect 4 beta cohort required by generated strict Effect workspaces before pnpm minimum release age elapsed.',
  i18next:
    'Reviewed i18next release required by generated localized applications before pnpm minimum release age elapsed.',
  moduleFederation:
    'Reviewed Module Federation 2.7 cohort required by generated SSR federation workspaces before pnpm minimum release age elapsed.',
  typescript:
    'Reviewed TypeScript compiler and platform cohort required by generated TypeScript 7 workspaces before pnpm minimum release age elapsed.',
} as const;

type ReleaseAgeReviewEvidence = {
  reviewer: string;
  reviewedAt: string;
  expiresAt: string;
  uri: string;
  sha256: string;
};

const releaseAgeReviewEvidence = {
  dependencyCohort: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-10T01:20:00.000Z',
    expiresAt: '2026-08-09T01:20:00.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/3e83a30a06fd4d056057e8f0aad52bc46f256811',
    sha256: 'b70f1326e9b555465d9390048d416238bce1efcf91b467336308aa4c3b253940',
  },
  i18next: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-09T23:03:09.000Z',
    expiresAt: '2026-08-08T23:03:09.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/04ae8b3445464e8f6179c3c89606792c97e9acbd',
    sha256: 'bdc703627ded04958aceff6663844994fca3a0be0d1266ea4fdb8dec7c06f4fa',
  },
  moduleFederation: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-09T20:51:39.000Z',
    expiresAt: '2026-08-08T20:51:39.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/9de554b9c165e8bf3c09bfcca3163612fd0cd473',
    sha256: 'ffb6fd168d53bff7b48aedb409d832b20155a4526edebb460288d7d10f40ae28',
  },
  releaseCohort: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-10T01:20:00.000Z',
    expiresAt: '2026-08-09T01:20:00.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/2d0622c2e784676161ce28a2299f1d0847b03cf1',
    sha256: '3ad53ef8e90582462b11e062a882ba57991c2c9f2cbf87bc1f88a7eb216b33b4',
  },
  typescript: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-09T14:00:39.000Z',
    expiresAt: '2026-08-08T14:00:39.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/50b905faa441954cac46bef073036514ddf78faa',
    sha256: '39b3f634548088af3e6c8417263d34f8ac430f0aff8ffec6dbded3eb977579c1',
  },
} as const satisfies Record<string, ReleaseAgeReviewEvidence>;

type ReleaseAgeApprovalSeed = {
  packageName: string;
  version: string;
  reason: string;
  publishedAt: string;
  integrity: string;
  review: ReleaseAgeReviewEvidence;
};

function createReleaseAgeApproval(
  seed: ReleaseAgeApprovalSeed,
): UltramodernReleaseAgeApproval {
  return {
    packageName: seed.packageName,
    version: seed.version,
    reason: seed.reason,
    reviewer: seed.review.reviewer,
    reviewedAt: seed.review.reviewedAt,
    evidence: {
      uri: seed.review.uri,
      sha256: seed.review.sha256,
      sha256Subject: 'git-commit-payload',
    },
    registry: {
      publishedAt: seed.publishedAt,
      dist: {
        integrity: seed.integrity,
      },
    },
    expiresAt: seed.review.expiresAt,
  };
}

export const ULTRAMODERN_PACKAGE_PINS = {
  appDependencies: {
    '@module-federation/bridge-react': MODULE_FEDERATION_VERSION,
    '@module-federation/modern-js-v3': MODULE_FEDERATION_VERSION,
    '@module-federation/runtime': MODULE_FEDERATION_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    i18next: I18NEXT_VERSION,
    'node-fetch': NODE_FETCH_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
    'react-router': REACT_ROUTER_VERSION,
  },
  appDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@rsbuild/plugin-tailwindcss': `^${RSBUILD_PLUGIN_TAILWINDCSS_VERSION}`,
    '@types/node': '^20',
    '@types/react': TYPES_REACT_VERSION,
    '@types/react-dom': TYPES_REACT_DOM_VERSION,
    tailwindcss: `^${TAILWIND_VERSION}`,
    typescript: TYPESCRIPT_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
  },
  rootDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    lefthook: LEFTHOOK_VERSION,
    oxlint: OXLINT_VERSION,
    oxfmt: OXFMT_VERSION,
    ultracite: ULTRACITE_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-agent': ZEPHYR_AGENT_VERSION,
  },
  transitiveDependencies: {
    '@cloudflare/workers-types': CLOUDFLARE_WORKERS_TYPES_VERSION,
    '@module-federation/node': MODULE_FEDERATION_NODE_VERSION,
    '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
    '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    miniflare: MINIFLARE_VERSION,
    workerd: WORKERD_VERSION,
  },
} as const;

const requiredPatchPolicies: readonly UltramodernPatchPolicy[] = [
  {
    packageName: '@module-federation/bridge-react',
    version: MODULE_FEDERATION_VERSION,
    path: `patches/@module-federation__bridge-react@${MODULE_FEDERATION_VERSION}.patch`,
  },
  {
    packageName: '@module-federation/modern-js-v3',
    version: MODULE_FEDERATION_VERSION,
    path: `patches/@module-federation__modern-js-v3@${MODULE_FEDERATION_VERSION}.patch`,
  },
  {
    packageName: '@tanstack/router-core',
    version: TANSTACK_ROUTER_CORE_VERSION,
    path: `patches/@tanstack__router-core@${TANSTACK_ROUTER_CORE_VERSION}.patch`,
  },
  {
    packageName: 'effect',
    version: EFFECT_VERSION,
    path: 'patches/effect-schema-error-type-id.patch',
  },
];

const conditionalPatchPolicies: readonly UltramodernPatchPolicy[] = [
  {
    packageName: 'drizzle-orm',
    version: DRIZZLE_ORM_VERSION,
    path: 'patches/drizzle-orm-ts7-strict-declarations.patch',
  },
];

const stalePatchPolicies: readonly UltramodernStalePatchPolicy[] = [
  {
    packageName: '@module-federation/dts-plugin',
    version: '2.7.0',
    path: 'patches/@module-federation__dts-plugin@2.7.0.patch',
    sha256: '768cc3bb22e2dede264515f141fdc8af937c8f53d4f8ef8f83469bb0cec1c9a0',
  },
  {
    packageName: '@module-federation/bridge-react',
    version: '2.6.0',
    path: 'patches/@module-federation__bridge-react@2.6.0.patch',
    sha256: '75982bd9b4d40922ce3110ded5254f7faca39112b79d41f27fe0ac4bb416c467',
  },
  {
    packageName: '@module-federation/dts-plugin',
    version: '2.6.0',
    path: 'patches/@module-federation__dts-plugin@2.6.0.patch',
    sha256: 'bc998f74617f7f060ea0f65235f071a5880aade3144ccd610d098d6bbc1c52fe',
  },
  {
    packageName: '@module-federation/modern-js-v3',
    version: '2.6.0',
    path: 'patches/@module-federation__modern-js-v3@2.6.0.patch',
    sha256: '51ab49dc776c56cdaa8eb43fbd0bb2788633d6b05acfb18fb2f3a1db81c02d87',
  },
  {
    packageName: '@tanstack/router-core',
    version: '1.171.13',
    path: 'patches/@tanstack__router-core@1.171.13.patch',
    sha256: '0c6119dcaa6ad35a11e1ce4fd95179bf929d5b5a86e9cbee110f45bd07c5c8d3',
  },
];

const moduleFederationRegistryReleases = [
  [
    'bridge-react',
    '2026-07-08T08:45:11.302Z',
    'sha512-i+RDBvAYVxZklRZwD50crqEewP8YYhwZ0LwO6rA2GLXVgcf7OR2aFVE0HLURByoT/oX86dyvKgVvPtXZLHNUhw==',
  ],
  [
    'bridge-react-webpack-plugin',
    '2026-07-08T08:44:46.582Z',
    'sha512-+7eYeJnIaofQHha8CK+FxPAXMIigd2xwONHi9rlYpdGqpCBIggRKMqL0b1owyDDNiAPF2lWUbxeNm0oUfF7GbA==',
  ],
  [
    'cli',
    '2026-07-08T08:45:40.376Z',
    'sha512-Nx5PQFmYqiiiIaU8uyzFcm9j8bNGb0SEo1GvbjI4ehfRJ5a92sUjNE++Q3o6zmVDI4wDXIhpGxioYdXi5QF40w==',
  ],
  [
    'dts-plugin',
    '2026-07-08T08:45:20.112Z',
    'sha512-mVKeGUf/7iqRMAFfikhsr2zXtA70WuzJdS1bPqqoeLQNRGXBLDjedcDG26RpIlsvuZcmIOqgN5Z6qw7Bh/HZUg==',
  ],
  [
    'enhanced',
    '2026-07-08T08:46:28.667Z',
    'sha512-1ZaiFIsFdH68MLoU7jrYxwhDt4WbDqmuTcnVsRqp9QZhZsex9h2zkeNpZdctL2Q1BtGsuNJ4ngJCOmO84O+6CQ==',
  ],
  [
    'error-codes',
    '2026-07-08T08:44:26.609Z',
    'sha512-syToF3H77IbBhJ7auGMCIb5ZDmJ5tvaqSeEvncJrOCq7JBT96F4UDlQDyNh6kCVznvYqqHsPeEMrfI9b5/Omlg==',
  ],
  [
    'inject-external-runtime-core-plugin',
    '2026-07-08T08:46:19.229Z',
    'sha512-8xHVUWsnlYd1vQPUjVEO+OPBhBjbdur+jp33QwqwkJkSUW/WOgnybCevVyfiA05aaiSyPo1PluQPT6uhImVb7A==',
  ],
  [
    'managers',
    '2026-07-08T08:44:50.532Z',
    'sha512-cWohiUvSrY6dIfhwsRABmEWfvJiAD5u/gxU7XRk7bx5nYPj7qn5gvYWJtvLNWzenluHZR6sib+03QMlyo+MYKQ==',
  ],
  [
    'manifest',
    '2026-07-08T08:45:48.810Z',
    'sha512-phK5/pK/e0JyjMh7a2tvRXUFE0WCG9lxu4BtBQllZXNO0zjrroOHl2s/0sSUCdOq6NIL1HF9wTAudYiCKmNFjA==',
  ],
  [
    'modern-js-v3',
    '2026-07-08T08:47:26.283Z',
    'sha512-HiTplBM9z4g9WXrIbifRuCira845fALpPXFpeuDrOCnNVuWYrAh0MZNQwv3A8oyi/7zcTSXElotnvGqFCQwp6w==',
  ],
  [
    'rsbuild-plugin',
    '2026-07-08T08:47:02.386Z',
    'sha512-rB001vPryB94/ytTzvDyVS5PGB82ImWLY938DrPjSqmG+rQWPRyV7QmDPodwDEzZEUvlWGS+MOu4CmqtrkRKpA==',
  ],
  [
    'rspack',
    '2026-07-08T08:46:23.723Z',
    'sha512-VbYc/5cpIze16ysBZJvmeXU7NN8tAs6Q/MdDsllIwO+Ir7JIEXgGrs5Bs+K7BuAu3HpxyRC8KanJTD+JB91+WA==',
  ],
  [
    'runtime',
    '2026-07-08T08:45:07.096Z',
    'sha512-UtLozKKNvhT0D1+F0MEWsAmddJ39ItKW15E22LVMAwXmYZRSnzIvJQ2Y6kQ4LwhWABsw/GRSpUDex5OfhpSQPw==',
  ],
  [
    'runtime-core',
    '2026-07-08T08:44:54.742Z',
    'sha512-5ROZLVIeV9YnWO2RwCwSHcy6sh48yclErO/2GZ2Xe8lFubPrFirgU8pbwBjZw+All0ZzN44BGS4ECRMVFzVcpg==',
  ],
  [
    'runtime-tools',
    '2026-07-08T08:45:57.683Z',
    'sha512-AY61QeZ0jV0GywgR9j3Yd37KiXoY6gaSYABhjDF3q7XL9PNtb2Ezm1F/985wqaKJYX+qJvYv+PMH6hTvyHdPYQ==',
  ],
  [
    'sdk',
    '2026-07-08T08:44:30.710Z',
    'sha512-piiLEjaIdjbNq8E11Di6vsfryhcdN/+sBCH6NjG7gSU2VHHoHEayZQWWL7VVdS6rVjexF9McLhPTSrl0adUU+A==',
  ],
  [
    'third-party-dts-extractor',
    '2026-07-08T08:44:34.650Z',
    'sha512-hZJKkngQ4hwe0U+vrT3KOsU11qoHCQK0wB4x1bXoTgpTfV9j5NSuddOyRmwbvXpir9bDWh3xy7ghqsx3mFf3kA==',
  ],
  [
    'webpack-bundler-runtime',
    '2026-07-08T08:45:31.961Z',
    'sha512-3qLRIqcZVBNgJrZpiEzcTP8a6+mCdUV1QGk/XljawsQHyNieMVdLQtdLvkoF5Z5kRXNMovq+wv3vchKOMWyA8w==',
  ],
] as const;

const typescriptPlatformRegistryReleases = [
  [
    'aix-ppc64',
    '2026-07-08T15:49:32.839Z',
    'sha512-MTKKkWB7p/0E9xi1d1tHtZ5PiLkGEMIq88pK2CubZjOsLtYTLqhgIgi6zepFa+9GHZ6h05NMCkQxGKiPXMxXtQ==',
  ],
  [
    'darwin-arm64',
    '2026-07-08T15:49:36.897Z',
    'sha512-gowzar9MwS/aRWp6f3a4KUqzRjAZjOsmGNCM6LcTgXum+dBfgsBVMN+AgvOCCbguXyick6LJhpBszxMebJ8syA==',
  ],
  [
    'darwin-x64',
    '2026-07-08T15:49:40.886Z',
    'sha512-SZ9xZInqApNlNGc9s0W1VSsktYSOe9cFqNOIqmN1Gs8SmkjKZYFt017G4VwPxASInODuAdbTW7sXiFUf893RgA==',
  ],
  [
    'freebsd-arm64',
    '2026-07-08T15:49:45.020Z',
    'sha512-W5NH4y/J0plIIS5b2xvTEkU7JFxyqdMAOgf+Ilhl0vHQXKO5dZoxd+C/jEtq56c4F3wk71RB4BMRQ2XdI+bwYQ==',
  ],
  [
    'freebsd-x64',
    '2026-07-08T15:49:49.189Z',
    'sha512-UMGDx5sTpzNw3WiPebH7l90IWfJggEd+egHt/q6p7/Cm3zqoV7VxkGXt+3DxPIw8CcmvAB0j3sVVfbhX+M4Tpw==',
  ],
  [
    'linux-arm',
    '2026-07-08T15:49:53.075Z',
    'sha512-gffT3xPz9sR7j/YJExkyPntrI0P2EP9XbOyWzth2/Gs0RstK+90RBcO0ncXoXy/beYll1SXw846Nf2zdnEz0QQ==',
  ],
  [
    'linux-arm64',
    '2026-07-08T15:49:57.270Z',
    'sha512-Qh4eU4/y3yDjnfjjyPYihMj5/ODIlmt+Bzu17OI+fiSRDW57QmU5SiN63exPRNJPKUzcc1INa1NXdrJ+MqHjUQ==',
  ],
  [
    'linux-loong64',
    '2026-07-08T15:50:01.501Z',
    'sha512-uEHck9i8hoAzXPiYRib1O7miOnz23SxIeVl6F4LXox+qov1K35jHcEW6VHKvZI+pyvl7fZEP4MCU5LYvIq1GuQ==',
  ],
  [
    'linux-mips64el',
    '2026-07-08T15:50:05.178Z',
    'sha512-R4KvAMnE43W5Qeqb0Ly56O3mWMWIAgsMyz36DCaycd5nbg/9kzm0liw3JocfRqyJY0KPmzFjbswozXyW0DnIYA==',
  ],
  [
    'linux-ppc64',
    '2026-07-08T15:50:09.539Z',
    'sha512-DORx5b3sd/4S7eayxm4FQv+A7CrkUIGRaHiwI8oiHTAI1fAPWhF4J0vAlkC8biAlHSVVwxMQ3tjZ2/DVbnQiiA==',
  ],
  [
    'linux-riscv64',
    '2026-07-08T15:50:13.357Z',
    'sha512-wf0jqEDOjrPRnKwYRyyJDRo11KMbvMFrU+q4zqKyChODBzvlkbhNQfKvLxQCcwTpdDaXSHZTVuh0JoCrKCUMHQ==',
  ],
  [
    'linux-s390x',
    '2026-07-08T15:50:17.275Z',
    'sha512-IkwJc3L7yhytWd/ewjyxNDfOmswCm9GWMJT/ue/dU4aZNbwZeYAetq42VyLmsmSjvoX7z74X6ZaYCtzAr0EuGw==',
  ],
  [
    'linux-x64',
    '2026-07-08T15:50:21.639Z',
    'sha512-EYdf2cNg7rgCWJnxCdJ+F3V39O8ihb37eHAu1LK8oAFizgTQbPOK7zHHXbPt8rX24COqODXeI3sIf0fCXG7H/A==',
  ],
  [
    'netbsd-arm64',
    '2026-07-08T15:50:25.229Z',
    'sha512-+polYF4MF04aPpO5FTkHran9yUQDSXqy5GiSDKpsll5jy3l3+g9QLhpf39T+ePtefhXLOGrLl0QIjkQP6VnelA==',
  ],
  [
    'netbsd-x64',
    '2026-07-08T15:50:29.798Z',
    'sha512-8YIT0EHM/3dq10ZOVF/A7pc/YSMtbcecct4rWtexrnSCHOPcpC2KTLXfTCR6vDpnSiY12heNb1GiN/wu+T/FyA==',
  ],
  [
    'openbsd-arm64',
    '2026-07-08T15:50:33.600Z',
    'sha512-APT8+ClYnuYm1u9+kgGXoMj2VzWzcymwh2gNSQVySHfkRDGOTVkoWLjCmOQSaO+PoqQ57B0flRp9SA+7GnnkzQ==',
  ],
  [
    'openbsd-x64',
    '2026-07-08T15:50:37.789Z',
    'sha512-yX7s+Q0Dln0Dt9tEzZsAjXXR/+ytBM7AlglaqyeMPxQszJ1JhlJdZ6jLA+IzldHtflX81em7lDao1xXu+aRRkg==',
  ],
  [
    'sunos-x64',
    '2026-07-08T15:50:41.700Z',
    'sha512-dLJDGaLZ1D4HPQn62u1n8mBDkJREwMsAkCdkwd4Ieqw+x3TUyTsqY0YiBCtE6H6OzzgGk3iuZ3vFWRS+E8/d1g==',
  ],
  [
    'win32-arm64',
    '2026-07-08T15:50:45.825Z',
    'sha512-Gyl1Vy6OsWesLzmq+EP0Fb7b4Nid5232AvcA2SFcdYreldpNtYFFofPjnt62y9hQy7VTaZp65ICJjuAQRaVcIQ==',
  ],
  [
    'win32-x64',
    '2026-07-08T15:50:50.403Z',
    'sha512-0BQ3HkAHHlKLSp1qRvf3SUhGpGsDuhB/jgFw75guyqbxJqEaS0Cw/VFO8i2nHglJUzQCRtMMR/IBAKE3ETMC4g==',
  ],
] as const;

const releaseAgeApprovals: readonly UltramodernReleaseAgeApproval[] = [
  createReleaseAgeApproval({
    packageName: '@effect/opentelemetry',
    version: EFFECT_VERSION,
    reason: releaseAgeReasons.effect,
    publishedAt: '2026-07-10T00:07:44.725Z',
    integrity:
      'sha512-x9yPmb8K8D0GLlGogz28VpKN6q5va9Zvti8kA3Mq1DgTIQf2641Tt6UbhlYfvHxjtwE/mVgztuuapjN8qlDLBw==',
    review: releaseAgeReviewEvidence.dependencyCohort,
  }),
  createReleaseAgeApproval({
    packageName: '@effect/vitest',
    version: EFFECT_VITEST_VERSION,
    reason: releaseAgeReasons.effect,
    publishedAt: '2026-07-10T00:07:56.326Z',
    integrity:
      'sha512-1dH6LBWSZyqnTV7ZO+yIpPGPf/xd7RtFfvQ4ZpTy9elzFN+wr1YBFpHSCr8+BfXOml6b8g9Mtj5eDy1qjbizUA==',
    review: releaseAgeReviewEvidence.dependencyCohort,
  }),
  ...moduleFederationRegistryReleases.map(
    ([packageSuffix, publishedAt, integrity]) =>
      createReleaseAgeApproval({
        packageName: `@module-federation/${packageSuffix}`,
        version: MODULE_FEDERATION_VERSION,
        reason: releaseAgeReasons.moduleFederation,
        publishedAt,
        integrity,
        review: releaseAgeReviewEvidence.moduleFederation,
      }),
  ),
  createReleaseAgeApproval({
    packageName: '@module-federation/node',
    version: MODULE_FEDERATION_NODE_VERSION,
    reason: releaseAgeReasons.moduleFederation,
    publishedAt: '2026-07-08T08:46:33.557Z',
    integrity:
      'sha512-LgrV5NU8SHKznzxl1gAtAYiWT0lFe9K8+mYNZ1atGkhpQiSeQFVsQbObZq5USs0dgjmpZtLtkwfFOQ66fKyNRA==',
    review: releaseAgeReviewEvidence.moduleFederation,
  }),
  createReleaseAgeApproval({
    packageName: '@typescript/native-preview',
    version: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    reason: releaseAgeReasons.typescript,
    publishedAt: '2026-07-07T08:20:24.277Z',
    integrity:
      'sha512-oUGp+Rep/hqMhPunyinsALUwSlzHINSxitifPiSaeqoKOKD2OlR9NE3TaPqwsl4NlGslsOSUXI1JotWQzpYCPg==',
    review: releaseAgeReviewEvidence.typescript,
  }),
  ...typescriptPlatformRegistryReleases.map(
    ([platform, publishedAt, integrity]) =>
      createReleaseAgeApproval({
        packageName: `@typescript/typescript-${platform}`,
        version: TYPESCRIPT_VERSION,
        reason: releaseAgeReasons.typescript,
        publishedAt,
        integrity,
        review: releaseAgeReviewEvidence.typescript,
      }),
  ),
  createReleaseAgeApproval({
    packageName: 'typescript',
    version: TYPESCRIPT_COMPILER_API_VERSION,
    reason: releaseAgeReasons.typescript,
    publishedAt: '2026-04-16T23:38:27.905Z',
    integrity:
      'sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==',
    review: releaseAgeReviewEvidence.typescript,
  }),
  createReleaseAgeApproval({
    packageName: 'effect',
    version: EFFECT_VERSION,
    reason: releaseAgeReasons.effect,
    publishedAt: '2026-07-10T00:07:52.514Z',
    integrity:
      'sha512-pK03HpQVxGZOWdwDAy/iwvV8u3KYcUf2mOWyWqaut2zau8V2u6ejWP7b4BELjyUIiZWW1fl/s/VJpgZUcTjThg==',
    review: releaseAgeReviewEvidence.dependencyCohort,
  }),
  createReleaseAgeApproval({
    packageName: '@cloudflare/workers-types',
    version: CLOUDFLARE_WORKERS_TYPES_VERSION,
    reason: releaseAgeReasons.cloudflare,
    publishedAt: '2026-07-10T01:13:24.132Z',
    integrity:
      'sha512-4ooaY2Pb5XGwDn8Fzm6jnTAJkIX0R5LBvL9euQpp2T58sQItlAQd9yivAlkwGhpY5cM1u81/9HaXwKAjXwtyzA==',
    review: releaseAgeReviewEvidence.releaseCohort,
  }),
  createReleaseAgeApproval({
    packageName: 'miniflare',
    version: MINIFLARE_VERSION,
    reason: releaseAgeReasons.cloudflare,
    publishedAt: '2026-07-09T18:25:09.203Z',
    integrity:
      'sha512-c94O9zRDISdqO18EHt6l0iF/fWgWt8p18PJvRsA/L/NJZ9Cfke3s/F5Blg1XXF7WDutVRzWVWy8Vy4LaT5ifsA==',
    review: releaseAgeReviewEvidence.releaseCohort,
  }),
  createReleaseAgeApproval({
    packageName: 'wrangler',
    version: WRANGLER_VERSION,
    reason: releaseAgeReasons.cloudflare,
    publishedAt: '2026-07-09T18:25:09.429Z',
    integrity:
      'sha512-xZeXKYi7hxQRF5anL+v77RkufJNpF9f3Eqeyqq2QBsETpLZgh0Agj0jJ6JPtkbgn6ukZdh8OK5egsGPWIditgg==',
    review: releaseAgeReviewEvidence.releaseCohort,
  }),
  createReleaseAgeApproval({
    packageName: 'i18next',
    version: I18NEXT_VERSION,
    reason: releaseAgeReasons.i18next,
    publishedAt: '2026-07-09T13:42:14.596Z',
    integrity:
      'sha512-Bu5Z2nAXgfVyM8xvW3jk9EKRIuX37PudsrBViThNFx7CR7aaYTpP01cxNB/E4c4UUzTDiAZRstEhsRfPOL/8xA==',
    review: releaseAgeReviewEvidence.i18next,
  }),
  createReleaseAgeApproval({
    packageName: 'typescript',
    version: TYPESCRIPT_VERSION,
    reason: releaseAgeReasons.typescript,
    publishedAt: '2026-07-08T15:55:18.431Z',
    integrity:
      'sha512-8FYau96o3NKOhbjKi/qNvG/W5jhzxkbdm5sj9AbZ/5T5sWqn3hJgLfGx27sRKZWTvyzCP8dLRBTf5tBTSRVUNA==',
    review: releaseAgeReviewEvidence.typescript,
  }),
];

export const ULTRAMODERN_WORKSPACE_POLICY = {
  schemaVersion: 1,
  dependencies: ULTRAMODERN_PACKAGE_PINS,
  toolchain: {
    node: {
      version: NODE_VERSION,
      engineRange: '>=26',
    },
    packageManager: {
      name: 'pnpm',
      version: PNPM_VERSION,
      engineRange: '>=11',
    },
  },
  pnpm: {
    minimumReleaseAge: 1440,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustPolicy: 'no-downgrade',
    trustPolicyIgnoreAfter: 1440,
    trustPolicyExclude: [
      `@effect/opentelemetry@${EFFECT_VERSION}`,
      `effect@${EFFECT_VERSION}`,
    ],
    blockExoticSubdeps: true,
    engineStrict: true,
    pmOnFail: 'error',
    verifyDepsBeforeRun: 'error',
    strictDepBuilds: true,
    peerDependencyRules: {
      allowedVersions: {
        react: '>=19.0.0',
        '@module-federation/dts-plugin>typescript':
          TYPESCRIPT_COMPILER_API_VERSION,
        '@module-federation/enhanced>typescript': TYPESCRIPT_VERSION,
        '@module-federation/modern-js-v3>typescript': TYPESCRIPT_VERSION,
        '@module-federation/rspack>typescript': TYPESCRIPT_VERSION,
        '@effect/vitest>effect': EFFECT_VERSION,
        'i18next>typescript': TYPESCRIPT_VERSION,
      },
    },
    overrides: {
      '@effect/opentelemetry': EFFECT_VERSION,
      '@effect/vitest': EFFECT_VITEST_VERSION,
      '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
      '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
      effect: EFFECT_VERSION,
      'node-fetch': NODE_FETCH_VERSION,
    },
    packageExtensions: {
      [`@module-federation/dts-plugin@${MODULE_FEDERATION_VERSION}`]: {
        dependencies: {
          typescript: `npm:typescript@${TYPESCRIPT_COMPILER_API_VERSION}`,
        },
      },
    },
    allowBuilds: {
      '@parcel/watcher': true,
      '@swc/core': true,
      'core-js': true,
      esbuild: true,
      lefthook: true,
      'msgpackr-extract': true,
      sharp: true,
      workerd: true,
    },
    patchedDependencies: {
      required: requiredPatchPolicies,
      conditional: conditionalPatchPolicies,
      stale: stalePatchPolicies,
    },
    releaseAge: {
      approvals: releaseAgeApprovals,
      firstParty: {
        source: 'authenticated-release-cohort-projection',
        exactVersionOnly: true,
        staticApprovals: false,
      },
    },
  },
  metadata: {
    packageSource: {
      configPath: '.modernjs/ultramodern.json',
      rootManifestPath: 'modernjs.packageSource',
      ownedKeys: [
        'strategy',
        'modernPackageVersion',
        'registry',
        'aliasScope',
        'aliasPackageNamePrefix',
      ],
    },
    moduleFederation: {
      version: MODULE_FEDERATION_VERSION,
      nodeVersion: MODULE_FEDERATION_NODE_VERSION,
      configPath: 'moduleFederation',
      appConfigPath: 'topology.apps[].moduleFederation',
    },
    nativePreview: {
      packageName: '@typescript/native-preview',
      version: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      generatedDependencyPolicy: 'forbidden',
      releaseAgePolicy: 'exact-reviewed-closure-only',
    },
  },
} as const;

const exactPackageNamePattern =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const exactVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const integrityPattern = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const immutableCommitUriPattern =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[a-f0-9]{40}$/u;

function comparePackageVersions(
  left: Pick<UltramodernReleaseAgeApproval, 'packageName' | 'version'>,
  right: Pick<UltramodernReleaseAgeApproval, 'packageName' | 'version'>,
) {
  if (left.packageName !== right.packageName) {
    return left.packageName < right.packageName ? -1 : 1;
  }
  if (left.version === right.version) {
    return 0;
  }
  return left.version < right.version ? -1 : 1;
}

function packageVersionKey(value: { packageName: string; version: string }) {
  return `${value.packageName}@${value.version}`;
}

function assertCanonicalInstant(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO-8601 UTC timestamp.`);
  }
  return timestamp;
}

function assertExactPackageVersion(
  value: Record<string, any>,
  label: string,
): asserts value is Record<string, any> & {
  packageName: string;
  version: string;
} {
  if (
    typeof value.packageName !== 'string' ||
    !exactPackageNamePattern.test(value.packageName)
  ) {
    throw new Error(
      `${label}.packageName must be an exact npm package name without ranges, tags, or globs.`,
    );
  }
  if (
    typeof value.version !== 'string' ||
    !exactVersionPattern.test(value.version)
  ) {
    throw new Error(
      `${label}.version must be one exact semantic version without ranges, tags, or globs.`,
    );
  }
}

function requiredRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function validateReleaseAgeApprovals(
  approvals: readonly unknown[],
  options: { now?: Date } = {},
): UltramodernReleaseAgeApproval[] {
  if (!Array.isArray(approvals)) {
    throw new Error('releaseAge.approvals must be an array.');
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Release-age validation requires a valid current time.');
  }

  const seen = new Set<string>();
  const validated = approvals.map((rawApproval, index) => {
    const label = `releaseAge.approvals[${index}]`;
    const approval = requiredRecord(rawApproval, label);
    assertExactPackageVersion(approval, label);
    const key = packageVersionKey({
      packageName: approval.packageName,
      version: approval.version,
    });
    if (seen.has(key)) {
      throw new Error(`Duplicate release-age approval for ${key}.`);
    }
    seen.add(key);

    for (const field of ['reason', 'reviewer'] as const) {
      const value = approval[field];
      if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        /^(?:unknown|todo|tbd|placeholder)$/iu.test(value.trim())
      ) {
        throw new Error(
          `${label}.${field} must identify real review evidence.`,
        );
      }
    }

    const reviewedAt = assertCanonicalInstant(
      approval.reviewedAt,
      `${label}.reviewedAt`,
    );
    const expiresAt = assertCanonicalInstant(
      approval.expiresAt,
      `${label}.expiresAt`,
    );
    if (expiresAt <= reviewedAt) {
      throw new Error(`${key} expiresAt must be after reviewedAt.`);
    }
    const evidence = requiredRecord(approval.evidence, `${label}.evidence`);
    if (
      typeof evidence.uri !== 'string' ||
      !immutableCommitUriPattern.test(evidence.uri)
    ) {
      throw new Error(
        `${label}.evidence.uri must reference an immutable full GitHub commit.`,
      );
    }
    if (
      typeof evidence.sha256 !== 'string' ||
      !sha256Pattern.test(evidence.sha256)
    ) {
      throw new Error(`${label}.evidence.sha256 must be a SHA-256 digest.`);
    }
    if (evidence.sha256Subject !== 'git-commit-payload') {
      throw new Error(
        `${label}.evidence.sha256Subject must identify the raw Git commit payload.`,
      );
    }

    const registry = requiredRecord(approval.registry, `${label}.registry`);
    const publishedAt = assertCanonicalInstant(
      registry.publishedAt,
      `${label}.registry.publishedAt`,
    );
    if (publishedAt > reviewedAt) {
      throw new Error(
        `${key} cannot be reviewed before its registry publish time.`,
      );
    }
    const dist = requiredRecord(registry.dist, `${label}.registry.dist`);
    if (
      typeof dist.integrity !== 'string' ||
      !integrityPattern.test(dist.integrity)
    ) {
      throw new Error(`${label}.registry.dist.integrity must be a valid SRI.`);
    }

    return approval as UltramodernReleaseAgeApproval;
  });

  return validated.sort(comparePackageVersions);
}

export function renderMinimumReleaseAgeExclude(
  options: {
    approvals?: readonly unknown[];
    now?: Date;
    packageSource?: ResolvedUltramodernPackageSource;
    releaseCohort?: UltramodernReleaseCohort;
  } = {},
) {
  const now = options.now ?? new Date();
  const nowTimestamp = now.getTime();
  const reviewedSelectors = validateReleaseAgeApprovals(
    options.approvals ?? ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals,
    { now },
  )
    .filter(approval => {
      const reviewedAt = Date.parse(approval.reviewedAt);
      const expiresAt = Date.parse(approval.expiresAt);
      const maturesAt =
        Date.parse(approval.registry.publishedAt) +
        ULTRAMODERN_WORKSPACE_POLICY.pnpm.minimumReleaseAge * 60_000;
      return (
        reviewedAt <= nowTimestamp &&
        nowTimestamp < expiresAt &&
        nowTimestamp < maturesAt
      );
    })
    .map(packageVersionKey);

  const packageSource = options.packageSource;
  if (
    packageSource?.strategy !== 'install' ||
    !exactVersionPattern.test(packageSource.modernPackageVersion)
  ) {
    return reviewedSelectors;
  }

  if (options.releaseCohort === undefined) {
    throw new Error(
      'Authenticated release cohort projection is required for install package sources.',
    );
  }
  const releaseCohort = parseUltramodernReleaseCohort(options.releaseCohort);
  assertReleaseCohortPackageSource(releaseCohort, packageSource);
  const firstPartySelectors = releaseCohortSelectors(releaseCohort);
  return [...new Set([...reviewedSelectors, ...firstPartySelectors])].sort();
}

export function resolveReleaseAgeApprovals(
  candidates: readonly UltramodernReleaseAgeCandidate[],
  options: {
    approvals?: readonly unknown[];
    now?: Date;
  } = {},
) {
  if (!Array.isArray(candidates)) {
    throw new Error('Release-age dependency closure must be an array.');
  }

  const approvals = validateReleaseAgeApprovals(
    options.approvals ?? ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals,
    { now: options.now },
  );
  const now = options.now ?? new Date();
  const nowTimestamp = now.getTime();
  const approvalsByKey = new Map(
    approvals.map(approval => [packageVersionKey(approval), approval]),
  );
  const candidatesByKey = new Map<
    string,
    {
      candidate: UltramodernReleaseAgeCandidate;
      publishedAt: number;
    }
  >();

  for (const [index, candidate] of candidates.entries()) {
    const label = `dependencyClosure[${index}]`;
    const record = requiredRecord(candidate, label);
    assertExactPackageVersion(record, label);
    const registry = requiredRecord(record.registry, `${label}.registry`);
    const dist = requiredRecord(registry.dist, `${label}.registry.dist`);
    if (
      typeof dist.integrity !== 'string' ||
      !integrityPattern.test(dist.integrity)
    ) {
      throw new Error(
        `${label}.registry.dist.integrity is required; registry uncertainty is fail-closed.`,
      );
    }
    const publishedAt = assertCanonicalInstant(
      registry.publishedAt,
      `${label}.registry.publishedAt`,
    );
    if (publishedAt > nowTimestamp) {
      throw new Error(
        `${label}.registry.publishedAt is in the future; registry uncertainty is fail-closed.`,
      );
    }

    const key = packageVersionKey(record as UltramodernReleaseAgeCandidate);
    if (candidatesByKey.has(key)) {
      throw new Error(`Duplicate dependency-closure candidate for ${key}.`);
    }
    candidatesByKey.set(key, { candidate, publishedAt });
  }

  const approved: UltramodernReleaseAgeCandidate[] = [];
  const reviewCandidates: UltramodernReleaseAgeCandidate[] = [];
  for (const [key, resolvedCandidate] of candidatesByKey) {
    const { candidate, publishedAt } = resolvedCandidate;
    const approval = approvalsByKey.get(key);
    const maturesAt =
      publishedAt +
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.minimumReleaseAge * 60_000;

    if (approval) {
      if (
        candidate.registry.dist.integrity !== approval.registry.dist.integrity
      ) {
        throw new Error(
          `Release-age approval ${key} does not match lock integrity.`,
        );
      }
      if (candidate.registry.publishedAt !== approval.registry.publishedAt) {
        throw new Error(
          `Release-age approval ${key} does not match registry publish time.`,
        );
      }
    }

    if (nowTimestamp >= maturesAt) {
      continue;
    }
    if (!approval || Date.parse(approval.reviewedAt) > nowTimestamp) {
      reviewCandidates.push(candidate);
      continue;
    }
    if (Date.parse(approval.expiresAt) <= nowTimestamp) {
      throw new Error(
        `Release-age approval for immature ${key} expired at ${approval.expiresAt}.`,
      );
    }
    approved.push(candidate);
  }

  for (const approval of approvals) {
    const key = packageVersionKey(approval);
    const reviewedAt = Date.parse(approval.reviewedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    const maturesAt =
      Date.parse(approval.registry.publishedAt) +
      ULTRAMODERN_WORKSPACE_POLICY.pnpm.minimumReleaseAge * 60_000;
    if (
      reviewedAt <= nowTimestamp &&
      nowTimestamp < expiresAt &&
      nowTimestamp < maturesAt &&
      !candidatesByKey.has(key)
    ) {
      throw new Error(
        `Release-age approval ${key} is unmatched by the dependency closure.`,
      );
    }
  }

  return {
    minimumReleaseAgeExclude: approved
      .sort(comparePackageVersions)
      .map(packageVersionKey),
    reviewCandidates: reviewCandidates.sort(comparePackageVersions),
  };
}

export function discoverPnpmLockReleaseAgeCandidates(
  lockfile: unknown,
): UltramodernReleaseAgeCandidate[] {
  const lock = requiredRecord(lockfile, 'pnpm lockfile');
  const packages = requiredRecord(lock.packages, 'pnpm lockfile packages');
  const candidates = new Map<string, UltramodernReleaseAgeCandidate>();

  for (const [rawKey, rawPackage] of Object.entries(packages)) {
    const peerSuffix = rawKey.indexOf('(');
    const packageKey = peerSuffix === -1 ? rawKey : rawKey.slice(0, peerSuffix);
    const versionSeparator = packageKey.lastIndexOf('@');
    if (versionSeparator <= 0) {
      continue;
    }
    const packageName = packageKey.slice(0, versionSeparator);
    const version = packageKey.slice(versionSeparator + 1);
    if (
      !exactPackageNamePattern.test(packageName) ||
      !exactVersionPattern.test(version)
    ) {
      continue;
    }

    const packageRecord = requiredRecord(
      rawPackage,
      `pnpm lockfile package ${packageKey}`,
    );
    const resolution = requiredRecord(
      packageRecord.resolution,
      `pnpm lockfile package ${packageKey} resolution`,
    );
    if (
      typeof resolution.integrity !== 'string' ||
      !integrityPattern.test(resolution.integrity)
    ) {
      throw new Error(
        `pnpm lockfile package ${packageKey} has uncertain registry integrity.`,
      );
    }

    const key = packageVersionKey({ packageName, version });
    const existing = candidates.get(key);
    if (existing) {
      if (existing.registry.dist.integrity !== resolution.integrity) {
        throw new Error(
          `pnpm lockfile has conflicting registry integrity for ${key}.`,
        );
      }
      continue;
    }

    candidates.set(key, {
      packageName,
      version,
      registry: {
        dist: {
          integrity: resolution.integrity,
        },
      },
    });
  }

  return [...candidates.values()].sort(comparePackageVersions);
}
