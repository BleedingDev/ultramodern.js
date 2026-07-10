import {
  createDiscoveryError,
  matchDeliveryUnitIdentity,
  parseSurfaceRef,
  type ResolvedDeliveryUnit,
  selectResolvedSurface,
  type SurfaceResolutionProvider,
  validateResolvedDeliveryUnit,
} from '../src/universal/surface-resolution';

function createRecord(
  overrides: Partial<ResolvedDeliveryUnit> = {},
): ResolvedDeliveryUnit {
  return {
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
            manifestUrl: 'https://checkout.example.test/mf-manifest.json',
          },
          {
            platform: 'node-mf-manifest',
            manifestRef:
              'https://checkout.example.test/backend-mf-manifest.json',
          },
          {
            platform: 'http-api',
            baseUrl: 'https://checkout.example.test',
            prefix: '/checkout',
          },
          {
            platform: 'cloudflare-service-binding',
            serviceBinding: 'CHECKOUT',
            dispatchNamespace: 'super-app',
          },
        ],
      },
    ],
    compatibility: {
      status: 'compatible',
      baselineCohortId: 'cohort-2026-07',
    },
    ...overrides,
  };
}

function parseRef(input: string) {
  const parsed = parseSurfaceRef(input);
  if (!parsed.ok) {
    throw new Error(`invalid test ref ${input}`);
  }
  return parsed.ref;
}

describe('validateResolvedDeliveryUnit', () => {
  it('accepts a complete record with all four location kinds', () => {
    expect(validateResolvedDeliveryUnit(createRecord())).toEqual({
      ok: true,
      issues: [],
    });
  });

  it('rejects a missing identity root field by field', () => {
    const result = validateResolvedDeliveryUnit(
      createRecord({ buildMarker: '', sourceRevision: '' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.path)).toEqual([
      'buildMarker',
      'sourceRevision',
    ]);
  });

  it('rejects a unit id outside the SurfaceRef grammar', () => {
    const result = validateResolvedDeliveryUnit(
      createRecord({ unitId: 'acme//checkout' }),
    );
    expect(result.issues.map(issue => issue.path)).toEqual(['unitId']);
  });

  it('rejects a compatibility verdict computed against a different cohort', () => {
    const result = validateResolvedDeliveryUnit(
      createRecord({
        compatibility: { status: 'compatible', baselineCohortId: 'other' },
      }),
    );
    expect(result.issues.map(issue => issue.path)).toEqual([
      'compatibility.baselineCohortId',
    ]);
  });

  it('rejects empty surface sets and surfaces without locations', () => {
    expect(
      validateResolvedDeliveryUnit(createRecord({ surfaces: [] })).issues.map(
        issue => issue.path,
      ),
    ).toEqual(['surfaces']);

    const result = validateResolvedDeliveryUnit(
      createRecord({
        surfaces: [{ surfaceId: 'cart', kind: 'component', locations: [] }],
      }),
    );
    expect(result.issues.map(issue => issue.path)).toEqual([
      'surfaces[0].locations',
    ]);
  });

  it('rejects duplicate surface ids and duplicate platforms per surface', () => {
    const duplicateSurfaces = validateResolvedDeliveryUnit(
      createRecord({
        surfaces: [
          createRecord().surfaces[0],
          { ...createRecord().surfaces[0] },
        ],
      }),
    );
    expect(duplicateSurfaces.issues.map(issue => issue.path)).toEqual([
      'surfaces[1].surfaceId',
    ]);

    const duplicatePlatforms = validateResolvedDeliveryUnit(
      createRecord({
        surfaces: [
          {
            surfaceId: 'cart',
            kind: 'component',
            locations: [
              { platform: 'http-api', baseUrl: 'https://a', prefix: '/a' },
              { platform: 'http-api', baseUrl: 'https://b', prefix: '/b' },
            ],
          },
        ],
      }),
    );
    expect(duplicatePlatforms.issues.map(issue => issue.path)).toEqual([
      'surfaces[0].locations[1].platform',
    ]);
  });
});

describe('selectResolvedSurface', () => {
  it('selects the referenced surface', () => {
    const selection = selectResolvedSurface(
      createRecord(),
      parseRef('acme/checkout#cart'),
    );
    expect(selection).toMatchObject({
      ok: true,
      surface: { surfaceId: 'cart' },
    });
  });

  it('returns unknown-unit for a record of another unit', () => {
    const selection = selectResolvedSurface(
      createRecord(),
      parseRef('acme/billing#cart'),
    );
    expect(selection).toMatchObject({
      ok: false,
      error: { code: 'unknown-unit', ref: 'acme/billing#cart' },
    });
  });

  it('returns unknown-surface with the available surfaces', () => {
    const selection = selectResolvedSurface(
      createRecord(),
      parseRef('acme/checkout#missing'),
    );
    expect(selection).toMatchObject({
      ok: false,
      error: {
        code: 'unknown-surface',
        details: { availableSurfaces: ['cart'] },
      },
    });
  });
});

describe('matchDeliveryUnitIdentity', () => {
  const expected = { unitId: 'acme/checkout', buildMarker: 'checkout-build-1' };

  it('accepts a matching identity', () => {
    expect(
      matchDeliveryUnitIdentity(expected, createRecord(), 'acme/checkout#cart'),
    ).toBeUndefined();
  });

  it('returns identity-mismatch for a different build marker', () => {
    const error = matchDeliveryUnitIdentity(
      expected,
      createRecord({ buildMarker: 'checkout-build-2' }),
      parseRef('acme/checkout#cart'),
    );
    expect(error).toMatchObject({
      code: 'identity-mismatch',
      ref: 'acme/checkout#cart',
      details: {
        expected,
        resolved: { unitId: 'acme/checkout', buildMarker: 'checkout-build-2' },
      },
    });
  });

  it('returns identity-mismatch for a different unit id', () => {
    const error = matchDeliveryUnitIdentity(
      expected,
      createRecord({ unitId: 'acme/billing' }),
      'acme/checkout#cart',
    );
    expect(error).toMatchObject({ code: 'identity-mismatch' });
  });
});

describe('provider SPI', () => {
  it('accepts a conforming provider returning whole records or typed errors', async () => {
    const record = createRecord();
    const provider: SurfaceResolutionProvider = {
      name: 'test-static',
      resolve(ref) {
        if (ref.unitId !== record.unitId) {
          return {
            ok: false,
            error: createDiscoveryError('unknown-unit', ref, 'unknown unit'),
          };
        }
        return { ok: true, unit: record };
      },
    };

    const hit = await provider.resolve(
      parseRef('acme/checkout#cart'),
      'production',
    );
    expect(hit).toEqual({ ok: true, unit: record });

    const miss = await provider.resolve(parseRef('other#cart'), 'production');
    expect(miss).toMatchObject({
      ok: false,
      error: { code: 'unknown-unit', ref: 'other#cart' },
    });
  });
});
