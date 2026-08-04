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
  TANSTACK_ROUTER_CORE_VERSION,
  TANSTACK_ROUTER_VERSION,
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
  appDevDependencies: {
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    '@rsbuild/plugin-tailwindcss': `^${RSBUILD_PLUGIN_TAILWINDCSS_VERSION}`,
    '@typescript/native': `npm:typescript@${TYPESCRIPT_VERSION}`,
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
    // beta.102 cohort dropped the dead SchemaError TypeId hunk and rebased the
    // remaining hunk onto the beta.102 pre-image; workspaces still on the
    // beta.94/beta.97 template carry the older two-hunk digest.
    sha256: 'bd29a0ae24f0674c6007e5e6060d847dbeb9499a6e2cf4c9f13b24ba9fb3af37',
    acceptedLegacySha256: [
      'dc7e8088e600beb20185eb877754d749c4a93909fb79f49465e8319e40d6596a',
    ],
  },
  {
    packageName: 'effect',
    version: '4.0.0-beta.97',
    path: 'patches/effect-schema-error-type-id.patch',
    // Same path as the active effect patch, so the primary digest tracks the
    // current template patch and the legacy list carries superseded ones. The
    // beta.102 cohort dropped the dead SchemaError TypeId hunk and rebased the
    // remaining hunk onto the beta.102 pre-image; workspaces still on the
    // beta.94/beta.97 template carry the older two-hunk digest.
    sha256: 'bd29a0ae24f0674c6007e5e6060d847dbeb9499a6e2cf4c9f13b24ba9fb3af37',
    acceptedLegacySha256: [
      'dc7e8088e600beb20185eb877754d749c4a93909fb79f49465e8319e40d6596a',
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
];

const moduleFederationRegistryReleases = [
  [
    'bridge-react',
    '2026-07-15T09:16:06.334Z',
    'sha512-+MIaWVaXyrFfE2qq7ErZeflSTscJtDV6g4lZ+TQxjup1nC83Zw+Nw0fvfJnScDR5lP5SM9epSvZrrZHxpFeEgw==',
  ],
  [
    'bridge-react-webpack-plugin',
    '2026-07-15T09:15:40.748Z',
    'sha512-7AaaiE4YOXFb+st6xlVDK65aNKZYR9S9ykH0q2mkHAHTgquXciAjypS8JuhmKn7Lob/2rkplMOc4YsGxG3Ng9Q==',
  ],
  [
    'cli',
    '2026-07-15T09:16:37.679Z',
    'sha512-yTxdWkCJPPo+IGASz+NqdW13cw3DhjSBEn9r85aYn1ahckDwB1WcZe0OjDWMqCcR6yi0BMLedk0SWrUeUj0fWw==',
  ],
  [
    'dts-plugin',
    '2026-07-15T09:16:15.728Z',
    'sha512-defjq4jOWMEfeejezPWLP5sc8kw0O6FqTT7/E5rbZPEVyjB1A0U3ynhW6GDE5/6hk9/TzdbWS+fBNi4MqUOY6Q==',
  ],
  [
    'enhanced',
    '2026-07-15T09:17:21.630Z',
    'sha512-h8vkLdhK7tlcSPmyYNGfGyt0pSzfDB0tYVYdyUt2tXwQRfaJAi3bsIpujMXElw3MXtOfSHESa6M/hPKrtWTHBw==',
  ],
  [
    'error-codes',
    '2026-07-15T09:15:24.091Z',
    'sha512-Gaog9904EmxYOQV0hli3XQ7jXeFaADfh5bnBtTCtbZ37Qd/Sz9kQfd+gYQRyIj7RGmkv9DPiN/SsmrTMrTymKw==',
  ],
  [
    'inject-external-runtime-core-plugin',
    '2026-07-15T09:17:12.157Z',
    'sha512-fW3jD1ZVds6r/Ul8TtUA42RsB0LfT1yjo5KjqgirH9QrmEMH21x44e3e6BC6IN820XKawRDSmz2kFA5YHIQp7Q==',
  ],
  [
    'managers',
    '2026-07-15T09:15:44.830Z',
    'sha512-SnVBCwmi962WGg6hLFElxZUCnrRJdR6glE2ZKPBY/iK07AHUN2ZxuaBCBsVzyws+xLZGHZxBHmVstijTh8dSUA==',
  ],
  [
    'manifest',
    '2026-07-15T09:16:46.336Z',
    'sha512-wfVeBXc4/C2F70nRFSPqJhkcwbDgo+wQyEn3jbjJTDoUqxxhYBfHFs1ACBYOk3Qm97L7hHclHGtUG0/nvDEfAA==',
  ],
  [
    'modern-js-v3',
    '2026-07-15T09:17:49.953Z',
    'sha512-zmFs0I/E3dLa8Vsj35ep7Ms29SePXFOShjedfFs5VnJPooif6l7fgdIJdxThyI1Rdw5JnRXmJsp4qmGm+naziA==',
  ],
  [
    'rsbuild-plugin',
    '2026-07-15T09:17:40.351Z',
    'sha512-rul5OPvLx599rWoAhCtKJ3UYqyM3Dxg0RWEfad3JdnJFqkcSLBojZXgHJE1vbF7DRdGQNmNscKw34iEyn89NwQ==',
  ],
  [
    'rspack',
    '2026-07-15T09:17:16.399Z',
    'sha512-TPcrkHpaZgL25Vx3c8oSNwyv7/KktC7uo6HTQdVWlFzbq5RSoMMGkWoir5pY5124isae2/p6v5xAuqICi4r0Zg==',
  ],
  [
    'runtime',
    '2026-07-15T09:16:02.203Z',
    'sha512-cGtUBQ1/TVy7KrXy6xPgy3FEmOGyIYkBA2T4iGH3ZH5PNPPTmqN9jF2AfneTSOj0RtBr7Pxq3CUt81E/UCvK1A==',
  ],
  [
    'runtime-core',
    '2026-07-15T09:15:49.410Z',
    'sha512-Tf98+epGGiPSHqmQHuXa2uXZMMvjGf1IqJDR1/FpXfmobv5ECN0mGZCjUHGNSyxvoDyXKIkKwJu7IwEoh0ouQA==',
  ],
  [
    'runtime-tools',
    '2026-07-15T09:16:55.255Z',
    'sha512-3yOqjdSHXxX4HA3GhlXg3hghGAXW2RJUsnwXCcik2/lTxOHizKI8f3RM+GGCKPxDVqtw43IShe3tA12jNL5A/A==',
  ],
  [
    'sdk',
    '2026-07-15T09:15:28.114Z',
    'sha512-yBP+9+0Z8nlvKEXAZS3AsQVy7bFbZf8eMivGk4q4ZdwG3TsLMlsPjb1dQb2i7gcAG6ux9y2LWLkj/0LVk74cnQ==',
  ],
  [
    'third-party-dts-extractor',
    '2026-07-15T09:15:32.527Z',
    'sha512-nAMlr74OKIylkfRwlunOhytQbmsgb3gCqdXWnPQhG+ZtqWXGELLfMT4a1Q1ht3cS+sRpWj2SZRqK2M7GadI6tA==',
  ],
  [
    'webpack-bundler-runtime',
    '2026-07-15T09:16:28.628Z',
    'sha512-82fDy9v+7qV5fiN8TKVhOdrxhmAZnUIX/IKivYX5ulCt8aoOzVFTiwm/P1GQUDD8z6dqR48xgJdZdf0548Mc9w==',
  ],
] as const;

const moduleFederationNodeRegistryRelease = {
  packageName: '@module-federation/node',
  version: MODULE_FEDERATION_NODE_VERSION,
  registry: {
    publishedAt: '2026-07-15T09:17:26.899Z',
    dist: {
      integrity:
        'sha512-mifMvCjWmLl53GS+badQws0j2bsu1ICpdGzCbez4I6kSpaYA8v86L6dwcHtVHIZtkUC6cjAZBDcgpxs4fK3nFQ==',
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
  // FORK: the Effect cohort (`effect`, `@effect/opentelemetry`,
  // `@effect/vitest` at EFFECT_VERSION) carries NO release-age approval.
  // 4.0.0-beta.102 published 2026-07-26T22:24Z and passed the 1440-minute
  // minimum release age on 2026-07-27, so no exemption is needed and none is
  // claimed. Do NOT re-add one against a commit that predates the cohort it
  // attests: an approval requires purpose-made review evidence (an immutable
  // GitHub commit whose payload sha256 is recorded) that actually CONTAINS the
  // reviewed versions, timestamps, integrities and patch applicability.
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
        '@effect/vitest>effect': EFFECT_VERSION,
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
