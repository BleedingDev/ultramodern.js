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
  resolveApiProtocol,
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
  TANSTACK_HISTORY_VERSION,
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPES_NODE_VERSION,
  TYPES_REACT_DOM_VERSION,
  TYPES_REACT_VERSION,
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
    ...(appHasApi(app) && resolveApiProtocol(app) === 'rest'
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
    // Backend-federation runtime smoke checks: every API vertical exposes a
    // deterministic readiness endpoint, so emit a smoke check the node backend
    // federation proof can run against the deployed Effect BFF handler.
    ...(app.api
      ? {
          jsonSmokeChecks: [
            {
              id: `${app.id}-readiness-smoke`,
              route: `${app.api.prefix}/${resolveApiStem(app)}/readiness`,
              expect: {
                status: 'ready',
                'checks.api': 'ready',
                'checks.moduleFederation': 'ready',
                'checks.ssr': 'ready',
              },
            },
          ],
        }
      : {}),
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
  acceptedLegacySha256?: readonly string[];
};

const releaseAgeReasons = {
  cloudflare:
    'Reviewed Cloudflare runtime cohort required by generated Worker tooling before pnpm minimum release age elapsed.',
  effect:
    'Reviewed Effect 4 beta cohort required by generated strict Effect workspaces before pnpm minimum release age elapsed.',
  i18next:
    'Reviewed i18next release required by generated localized applications before pnpm minimum release age elapsed.',
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
  i18next: {
    reviewer: 'Petr Glaser <syreanis+1@gmail.com>',
    reviewedAt: '2026-07-09T23:03:09.000Z',
    expiresAt: '2026-08-08T23:03:09.000Z',
    uri: 'https://github.com/BleedingDev/ultramodern.js/commit/04ae8b3445464e8f6179c3c89606792c97e9acbd',
    sha256: 'bdc703627ded04958aceff6663844994fca3a0be0d1266ea4fdb8dec7c06f4fa',
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
  // FORK: `@modern-js/plugin-bff` declares `effect` and `@effect/opentelemetry`
  // as OPTIONAL peers so a hono-only consumer is never forced to install Effect.
  // Every generated UltraModern workspace runs the strict Effect BFF lane, so
  // whoever depends on plugin-bff must supply that peer itself — at the exact
  // cohort version, which is the whole point of the optional-peer shape (one
  // Effect Context/Service identity). Without this the generated workspace
  // installs no `effect` at all: the BFF lane fails at runtime, and the
  // `effect@<version>` entry in `patchedDependencies` matches nothing, so pnpm
  // rejects the install with ERR_PNPM_UNUSED_PATCH.
  bffEffectDependencies: {
    '@effect/opentelemetry': EFFECT_VERSION,
    effect: EFFECT_VERSION,
  },
  appDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@rsbuild/plugin-tailwindcss': `^${RSBUILD_PLUGIN_TAILWINDCSS_VERSION}`,
    '@typescript/native': `npm:typescript@${TYPESCRIPT_VERSION}`,
    '@types/node': TYPES_NODE_VERSION,
    '@types/react': TYPES_REACT_VERSION,
    '@types/react-dom': TYPES_REACT_DOM_VERSION,
    tailwindcss: `^${TAILWIND_VERSION}`,
    typescript: TYPESCRIPT_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
  },
  rootDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@typescript/native': `npm:typescript@${TYPESCRIPT_VERSION}`,
    lefthook: LEFTHOOK_VERSION,
    miniflare: MINIFLARE_VERSION,
    oxlint: OXLINT_VERSION,
    oxfmt: OXFMT_VERSION,
    ultracite: ULTRACITE_VERSION,
    wrangler: WRANGLER_VERSION,
    'zephyr-agent': ZEPHYR_AGENT_VERSION,
  },
  transitiveDependencies: {
    '@cloudflare/workers-types': CLOUDFLARE_WORKERS_TYPES_VERSION,
    '@module-federation/node': MODULE_FEDERATION_NODE_VERSION,
    '@tanstack/history': TANSTACK_HISTORY_VERSION,
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
    packageName: '@module-federation/bridge-react',
    version: '2.8.0',
    path: 'patches/@module-federation__bridge-react@2.8.0.patch',
    sha256: '54bfc79e097473222f83cbfa6d717792e3026bf16b5097c2ed91715b7da126be',
  },
  {
    packageName: '@module-federation/modern-js-v3',
    version: '2.8.0',
    path: 'patches/@module-federation__modern-js-v3@2.8.0.patch',
    sha256: '948d2a725ae526f395b0343b113ff80dfaa50dbdec8158179746e98259925d20',
  },
  {
    packageName: '@module-federation/bridge-react',
    version: '2.7.0',
    path: 'patches/@module-federation__bridge-react@2.7.0.patch',
    sha256: '2f89441475f83a6e12d8c2a755b5b15c4d2b04523a1b33fd318c2d537382537f',
  },
  {
    packageName: '@module-federation/modern-js-v3',
    version: '2.7.0',
    path: 'patches/@module-federation__modern-js-v3@2.7.0.patch',
    sha256: 'f51adf0aa6c6e2daa5b7d2978a7716c0d4fb05b29af449b2f16257b957fb7923',
  },
  {
    packageName: 'effect',
    version: '4.0.0-beta.94',
    path: 'patches/effect-schema-error-type-id.patch',
    // Same path as the active effect patch, so the primary digest tracks the
    // current template patch and the legacy list carries superseded ones. The
    // beta.107 retains only the public SchemaAST.Sentinel repair. The previous
    // private preResponseHandler declaration hunk is intentionally historical.
    sha256: 'ed9f636f82a1a1e5c128fc85e99e24a8fcf4ba06a35e89e3dd6460250875153f',
    acceptedLegacySha256: [
      'd9e12b42d06a051957899a9df14b2b7b2385fc3a5677a89037eeee3674d64ebe',
      'dc7e8088e600beb20185eb877754d749c4a93909fb79f49465e8319e40d6596a',
      'bd29a0ae24f0674c6007e5e6060d847dbeb9499a6e2cf4c9f13b24ba9fb3af37',
    ],
  },
  {
    packageName: 'effect',
    version: '4.0.0-beta.97',
    path: 'patches/effect-schema-error-type-id.patch',
    // Same path as the active effect patch, so the primary digest tracks the
    // current template patch and the legacy list carries superseded ones. The
    // beta.107 retains only the public SchemaAST.Sentinel repair. The previous
    // private preResponseHandler declaration hunk is intentionally historical.
    sha256: 'ed9f636f82a1a1e5c128fc85e99e24a8fcf4ba06a35e89e3dd6460250875153f',
    acceptedLegacySha256: [
      'd9e12b42d06a051957899a9df14b2b7b2385fc3a5677a89037eeee3674d64ebe',
      'dc7e8088e600beb20185eb877754d749c4a93909fb79f49465e8319e40d6596a',
      'bd29a0ae24f0674c6007e5e6060d847dbeb9499a6e2cf4c9f13b24ba9fb3af37',
    ],
  },
  {
    packageName: 'effect',
    version: '4.0.0-beta.102',
    path: 'patches/effect-schema-error-type-id.patch',
    sha256: 'ed9f636f82a1a1e5c128fc85e99e24a8fcf4ba06a35e89e3dd6460250875153f',
    acceptedLegacySha256: [
      'd9e12b42d06a051957899a9df14b2b7b2385fc3a5677a89037eeee3674d64ebe',
      'dc7e8088e600beb20185eb877754d749c4a93909fb79f49465e8319e40d6596a',
      'bd29a0ae24f0674c6007e5e6060d847dbeb9499a6e2cf4c9f13b24ba9fb3af37',
    ],
  },
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
    acceptedLegacySha256: [
      'ad19439992ca0757dc7354ad4197eecd5ac83f3ef5ed990e9200c672138600d5',
    ],
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
  {
    packageName: '@tanstack/router-core',
    version: '1.171.14',
    path: 'patches/@tanstack__router-core@1.171.14.patch',
    sha256: '1e1572940e00d6327c75bb8457c108e32e75a2292e4d90d764208d5b6f330155',
  },
  {
    packageName: 'react-server-dom-rspack',
    version: '0.0.3',
    path: 'patches/@react-server-dom-rspack@0.0.3.patch',
    sha256: '11e471512012c0015883a233017b3ad695765e344cbd1d8174e79196ab6ba567',
  },
];

const moduleFederationRegistryReleases = [
  [
    'bridge-react',
    '2026-08-06T11:23:38.662Z',
    'sha512-cRuoIZ2sX572+N5Ih3gKvajVnWMHN0n3FpWNtTheX81XYYKghGpl+fsJ68fAthZefYccnEcy9SGoaSYyXEtIyA==',
  ],
  [
    'bridge-react-webpack-plugin',
    '2026-08-06T11:24:16.927Z',
    'sha512-cEhnpCsWHqUndQC6WKtwat5BGz+IU0UdCjzyXrZtx1UqHX1jRB0+DZxB4DKYKtxTko8fsV0FUCJ/0FjKZY6z8g==',
  ],
  [
    'cli',
    '2026-08-06T11:26:17.305Z',
    'sha512-SrRe2UOzjYux/9Zf7AYymGGsYpJgrIHUPF+T9JQ+rZ7MC9Uiy5rNUtSYdxNrdFpVaRZYXMrI4b82iUy66CU6UA==',
  ],
  [
    'dts-plugin',
    '2026-08-06T11:24:53.645Z',
    'sha512-pwZFW8b2LZTymMMC+o2M9xMXDIQKAHGtCRqj/IkOp0jHRYrKjK9cma9xoUNst8/R3sEn878/i9wgv/43BnCEyg==',
  ],
  [
    'enhanced',
    '2026-08-06T11:30:02.334Z',
    'sha512-XVCp1dz7ADd2YgjuvGVsS7IVJ8ViuAUCEz9gAb4M0qMJCjcPfzXQ1CzV1/Me1lKaPPwNj/cJ3NXTRvXjMHanGg==',
  ],
  [
    'error-codes',
    '2026-08-06T11:26:04.260Z',
    'sha512-8inlDv48QOjA//CLQ3epjoHEiMQGsz1Pmtu2N+s7gQVggn6AYHpjnMe8AsyGxtpaPg3wbX0HmBZtRFggpXUB9A==',
  ],
  [
    'inject-external-runtime-core-plugin',
    '2026-08-06T11:26:50.044Z',
    'sha512-RetbaupJGiT2FtmA3WWGm72xZkNSJ6Xyy53jSgtu9HRnR/5xt/wiQl+Pe/iEfzgfLsUnUAkOsSfiPBXrDtNizw==',
  ],
  [
    'managers',
    '2026-08-06T11:25:25.160Z',
    'sha512-OQfnoUwy1IUfn6DaI2S/DPKgnElkYlP+gG8mbUQlJVEW1Zg/8V/dZbNgJUKikTJly6yR1r08PK59g7239ITYMw==',
  ],
  [
    'manifest',
    '2026-08-06T11:27:26.712Z',
    'sha512-mJUZo7QFL46NXoEWNby3CfPFFm2235J7LO6bXAAMrEIT4qF8QHLiqfoo5dZmrisRgM6e+muriWtGvPFMprnXyA==',
  ],
  [
    'modern-js-v3',
    '2026-08-06T11:25:21.202Z',
    'sha512-FK6ez4uUAZrG9a/5+T37DKN8OIAHLFpNTvlM5Qha4U4reeZavLU8TPsayaPON/3WVbzMxvy2uKfObwXq8+ubTQ==',
  ],
  [
    'rsbuild-plugin',
    '2026-08-06T11:25:12.457Z',
    'sha512-rUzx5quE/pqEiZk0ESyPj4QCDCvSpqhgoq/+zjuz9vyHAuMvXL/U0si6bOclBg4UGGFlLmq5+XVIJR43iAADJg==',
  ],
  [
    'rspack',
    '2026-08-06T11:25:53.432Z',
    'sha512-HEDirYhVYvx7IzP9jes6KLPMqSoSQwuLfBzPSOgBqY7sIH/e9zRSRO1qh5C8OXYKHi23WcQpGY+EeecIK9wxWw==',
  ],
  [
    'runtime',
    '2026-08-06T11:24:39.297Z',
    'sha512-SUoP+PD5EjSPSi6FxEPGIZoRkFifxdeYcVQbJE9mO0VEjF51gAk3/TgX8k0vzUryOBPmXekLr9SfQXU6DqUtvA==',
  ],
  [
    'runtime-core',
    '2026-08-06T11:24:25.871Z',
    'sha512-PEkkK9MUp+nUCeQMS4ox3QGZfwwxgfjGA7P4umEnr5c3y8DLNDR+26tyHf/Gkjen2VsjlcyL+mEAQo1Zi4IE3g==',
  ],
  [
    'runtime-tools',
    '2026-08-06T11:25:33.018Z',
    'sha512-eW/yPvZB2LbpbyPXPTnOeF1ieWl165D9QcPV0y5Bj1QYGDjL2cb+dnzrBp0fmFtJhCYqmAdsVNoYItVa3yuJ3g==',
  ],
  [
    'sdk',
    '2026-08-06T11:24:06.157Z',
    'sha512-OPS/lbQjraLXoWniQpCwQ/vqgURHTrhsackSNcOPmcJHM3LyR+DabxUc0pl8jAqExsW2l+uepQq7+/Gkei871w==',
  ],
  [
    'third-party-dts-extractor',
    '2026-08-06T11:24:09.575Z',
    'sha512-Xf3iZ4iDi972XMOMbmUm/c5Vwwb6cTsU+Jpoz96lUom6Yps9FQX48elIdhgcQsL7/K64PqdOONsrlZVo8zphKA==',
  ],
  [
    'webpack-bundler-runtime',
    '2026-08-06T11:27:08.353Z',
    'sha512-g4xQgfgMMCKgJjVMBh7nIYGjLGNDYwSZ4lfpTdkVyWDnxmR3SL6VPQTJEZHRYPyqvrTtZE1zdDhDd++yNRvLdA==',
  ],
] as const;

const moduleFederationNodeRegistryRelease = {
  packageName: '@module-federation/node',
  version: MODULE_FEDERATION_NODE_VERSION,
  registry: {
    publishedAt: '2026-08-06T11:26:03.867Z',
    dist: {
      integrity:
        'sha512-xNGYfhA2aqFpogb/uq6lwBeEbnmDLV6PwHzSe97mRrSSr00eUKAMwlLG6PcQP6ynbkPeDG86RYj/YUC7EWgLMA==',
    },
  },
} as const;

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
  // FORK: fresh-cohort approvals are added only after the purpose-built review
  // artifact has an immutable pushed commit identity. Never attest a cohort
  // from a commit that predates its reviewed versions, timestamps, integrities,
  // optional-platform closure, and patch applicability evidence.
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
        '@effect/vitest>effect': EFFECT_VERSION,
      },
    },
    overrides: {
      '@effect/opentelemetry': EFFECT_VERSION,
      '@effect/vitest': EFFECT_VITEST_VERSION,
      '@tanstack/history': TANSTACK_HISTORY_VERSION,
      '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
      '@tanstack/router-core': TANSTACK_ROUTER_CORE_VERSION,
      effect: EFFECT_VERSION,
      'node-fetch': NODE_FETCH_VERSION,
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
      registryEvidence: {
        moduleFederation: {
          version: MODULE_FEDERATION_VERSION,
          nodeVersion: MODULE_FEDERATION_NODE_VERSION,
          releases: moduleFederationRegistryReleases.map(
            ([packageSuffix, publishedAt, integrity]) => ({
              packageName: `@module-federation/${packageSuffix}`,
              version: MODULE_FEDERATION_VERSION,
              registry: {
                publishedAt,
                dist: { integrity },
              },
            }),
          ),
          node: moduleFederationNodeRegistryRelease,
        },
      },
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
