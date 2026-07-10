import {
  createEnvStaticSurfaceResolutionProvider,
  ENV_STATIC_PROVIDER_NAME,
  type EnvStaticUnitConfig,
  parseSurfaceRef,
} from '../src/universal/surface-resolution';

function createUnitConfig(
  overrides: Partial<EnvStaticUnitConfig> = {},
): EnvStaticUnitConfig {
  return {
    unitId: 'acme/checkout',
    buildMarker: 'checkout-build-1',
    sourceRevision: 'rev-1',
    baselineCohortId: 'cohort-2026-07',
    envSegment: 'CHECKOUT',
    mfName: 'verticalCheckout',
    port: 3101,
    workerName: 'acme-checkout',
    surfaces: [
      {
        surfaceId: 'cart',
        kind: 'component',
        platforms: { browserMfManifest: true },
      },
      {
        surfaceId: 'checkout-api',
        kind: 'api',
        platforms: {
          nodeMfManifest: true,
          httpApi: { prefix: '/checkout' },
          cloudflareServiceBinding: {
            serviceBinding: 'CHECKOUT_BACKEND',
            dispatchNamespace: 'super-app',
          },
        },
      },
    ],
    ...overrides,
  };
}

function ref(input: string) {
  const parsed = parseSurfaceRef(input);
  if (!parsed.ok) {
    throw new Error(`invalid test ref ${input}`);
  }
  return parsed.ref;
}

function createProvider(
  env: Record<string, string | undefined> = {},
  unitOverrides: Partial<EnvStaticUnitConfig> = {},
) {
  return createEnvStaticSurfaceResolutionProvider({
    env,
    units: [createUnitConfig(unitOverrides)],
  });
}

describe('createEnvStaticSurfaceResolutionProvider', () => {
  it('names the provider env-static', () => {
    expect(createProvider().name).toBe(ENV_STATIC_PROVIDER_NAME);
  });

  it('assembles ONE complete record covering browser, node, http, and binding locations from localhost fallbacks', async () => {
    const result = await createProvider().resolve(
      ref('acme/checkout#cart'),
      'development',
    );

    expect(result).toEqual({
      ok: true,
      unit: {
        unitId: 'acme/checkout',
        buildMarker: 'checkout-build-1',
        sourceRevision: 'rev-1',
        baselineCohortId: 'cohort-2026-07',
        surfaces: [
          {
            surfaceId: 'cart',
            kind: 'component',
            locations: [
              {
                platform: 'browser-mf-manifest',
                manifestUrl: 'http://localhost:3101/mf-manifest.json',
              },
            ],
          },
          {
            surfaceId: 'checkout-api',
            kind: 'api',
            locations: [
              {
                platform: 'node-mf-manifest',
                manifestRef: 'http://localhost:3101/backend-mf-manifest.json',
              },
              {
                platform: 'http-api',
                baseUrl: 'http://localhost:3101',
                prefix: '/checkout',
              },
              {
                platform: 'cloudflare-service-binding',
                serviceBinding: 'CHECKOUT_BACKEND',
                dispatchNamespace: 'super-app',
              },
            ],
          },
        ],
        compatibility: {
          status: 'compatible',
          baselineCohortId: 'cohort-2026-07',
        },
      },
    });
  });

  it('prefers configured manifest env values and strips the mfName@ remote-ref prefix', async () => {
    const result = await createProvider({
      VERTICAL_CHECKOUT_MF_MANIFEST:
        'verticalCheckout@https://checkout.example.test/mf-manifest.json',
      VERTICAL_CHECKOUT_BACKEND_MF_MANIFEST:
        '/srv/checkout/backend-mf-manifest.json',
    }).resolve(ref('acme/checkout#cart'), 'production');

    expect(result).toMatchObject({
      ok: true,
      unit: {
        surfaces: [
          {
            locations: [
              {
                platform: 'browser-mf-manifest',
                manifestUrl: 'https://checkout.example.test/mf-manifest.json',
              },
            ],
          },
          {
            locations: [
              {
                platform: 'node-mf-manifest',
                manifestRef: '/srv/checkout/backend-mf-manifest.json',
              },
              expect.anything(),
              expect.anything(),
            ],
          },
        ],
      },
    });
  });

  it('derives browser manifest and http base from the public URL env, trimming trailing slashes', async () => {
    const result = await createProvider({
      ULTRAMODERN_PUBLIC_URL_CHECKOUT: 'https://checkout.example.test//',
    }).resolve(ref('acme/checkout#cart'), 'production');

    expect(result).toMatchObject({
      ok: true,
      unit: {
        surfaces: [
          {
            locations: [
              {
                manifestUrl: 'https://checkout.example.test/mf-manifest.json',
              },
            ],
          },
          {
            locations: [
              expect.anything(),
              { baseUrl: 'https://checkout.example.test', prefix: '/checkout' },
              expect.anything(),
            ],
          },
        ],
      },
    });
  });

  it('falls back to the Cloudflare workers.dev overlay when deploying to Cloudflare', async () => {
    const result = await createProvider({
      MODERNJS_DEPLOY: 'cloudflare',
      ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: 'acme-team',
    }).resolve(ref('acme/checkout#cart'), 'production');

    expect(result).toMatchObject({
      ok: true,
      unit: {
        surfaces: [
          {
            locations: [
              {
                manifestUrl:
                  'https://acme-checkout.acme-team.workers.dev/mf-manifest.json',
              },
            ],
          },
          {
            locations: [
              expect.anything(),
              { baseUrl: 'https://acme-checkout.acme-team.workers.dev' },
              expect.anything(),
            ],
          },
        ],
      },
    });
  });

  it('returns unknown-unit for unconfigured units', async () => {
    const result = await createProvider().resolve(
      ref('acme/billing#invoices'),
      'production',
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'unknown-unit',
        ref: 'acme/billing#invoices',
        details: { knownUnits: ['acme/checkout'] },
      },
    });
  });

  it('returns unknown-surface for undeclared surfaces', async () => {
    const result = await createProvider().resolve(
      ref('acme/checkout#missing'),
      'production',
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'unknown-surface',
        details: { availableSurfaces: ['cart', 'checkout-api'] },
      },
    });
  });

  it('returns major-not-published for unpublished external majors', async () => {
    const provider = createProvider({}, { publishedMajors: [1] });
    expect(
      await provider.resolve(ref('acme/checkout#cart@v2'), 'production'),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'major-not-published',
        ref: 'acme/checkout#cart@v2',
        details: { publishedMajors: [1] },
      },
    });
    expect(
      await provider.resolve(ref('acme/checkout#cart@v1'), 'production'),
    ).toMatchObject({ ok: true });
  });

  it('fails the WHOLE record when any surface location is unassemblable (missing env, no port)', async () => {
    // Browser manifest for `cart` resolves via public URL, but the backend
    // manifest for `checkout-api` has neither env value nor port: no partial
    // record may be returned.
    const result = await createProvider(
      { ULTRAMODERN_PUBLIC_URL_CHECKOUT: 'https://checkout.example.test' },
      { port: undefined },
    ).resolve(ref('acme/checkout#cart'), 'production');

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'provider-unavailable',
        details: { manifestEnv: 'VERTICAL_CHECKOUT_BACKEND_MF_MANIFEST' },
      },
    });
  });

  it('fails when Cloudflare deploy requires public URLs and none are configured', async () => {
    const result = await createProvider(
      {
        MODERNJS_DEPLOY: 'cloudflare',
        ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS: 'true',
        VERTICAL_CHECKOUT_BACKEND_MF_MANIFEST:
          'https://checkout.example.test/backend-mf-manifest.json',
      },
      { workerName: undefined },
    ).resolve(ref('acme/checkout#cart'), 'production');

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'provider-unavailable',
        details: { publicUrlEnv: 'ULTRAMODERN_PUBLIC_URL_CHECKOUT' },
      },
    });
  });

  it('treats blank env values as unset', async () => {
    const result = await createProvider({
      VERTICAL_CHECKOUT_MF_MANIFEST: '   ',
    }).resolve(ref('acme/checkout#cart'), 'development');

    expect(result).toMatchObject({
      ok: true,
      unit: {
        surfaces: [
          {
            locations: [
              { manifestUrl: 'http://localhost:3101/mf-manifest.json' },
            ],
          },
          expect.anything(),
        ],
      },
    });
  });
});
