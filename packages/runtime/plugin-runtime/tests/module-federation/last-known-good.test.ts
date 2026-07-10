import {
  createLastKnownGoodProvider,
  type DiscoveryResult,
  type LkgStorage,
  type ResolvedDeliveryUnit,
  type SurfaceResolutionProvider,
} from '../../src/module-federation';

const record = (buildMarker: string): ResolvedDeliveryUnit => ({
  unitId: 'acme/checkout',
  buildMarker,
  sourceRevision: `rev-${buildMarker}`,
  baselineCohortId: 'cohort-1',
  surfaces: [
    {
      surfaceId: 'cart',
      kind: 'component',
      locations: [
        {
          platform: 'browser-mf-manifest',
          manifestUrl: `https://cdn/${buildMarker}.json`,
        },
      ],
    },
  ],
  compatibility: { status: 'compatible', baselineCohortId: 'cohort-1' },
});

const okResult = (buildMarker: string): DiscoveryResult => ({
  ok: true,
  unit: record(buildMarker),
});

const ref = { unitId: 'acme/checkout', surfaceId: 'cart' };

/** Unwrap a successful result or fail the test with the typed error. */
const unitOf = (result: DiscoveryResult): ResolvedDeliveryUnit => {
  if (!result.ok) {
    throw new Error(`expected ok result, got ${result.error.code}`);
  }
  return result.unit;
};

/** A provider whose per-call result is scripted. */
const scriptedProvider = (
  script: Array<DiscoveryResult | (() => never)>,
): SurfaceResolutionProvider => {
  let i = 0;
  return {
    name: 'scripted',
    resolve() {
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      if (typeof next === 'function') {
        return next();
      }
      return next;
    },
  };
};

describe('G24a/b last-known-good provider wrapper', () => {
  test('serves the last complete record marked degraded on provider failure', async () => {
    const provider = scriptedProvider([
      okResult('bm-1'),
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    const first = await lkg.resolve(ref, 'prod');
    expect(first.ok).toBe(true);

    const second = await lkg.resolve(ref, 'prod');
    expect(second.ok).toBe(true);
    const served = unitOf(second);
    // Whole prior record, only the verdict flipped.
    expect(served.buildMarker).toBe('bm-1');
    expect(served.sourceRevision).toBe('rev-bm-1');
    expect(served.surfaces).toEqual(record('bm-1').surfaces);
    expect(served.compatibility.status).toBe('degraded');
  });

  test('serves LKG when the wrapped provider throws', async () => {
    const provider = scriptedProvider([
      okResult('bm-1'),
      () => {
        throw new Error('boom');
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    await lkg.resolve(ref, 'prod');
    const served = await lkg.resolve(ref, 'prod');
    expect(served.ok).toBe(true);
    expect(unitOf(served).compatibility.status).toBe('degraded');
  });

  test('expiry yields a typed stale-record error, never a partial record', async () => {
    let clock = 1_000;
    const provider = scriptedProvider([
      okResult('bm-1'),
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({
      provider,
      freshness: { maxStaleMs: 5_000 },
      now: () => clock,
    });

    await lkg.resolve(ref, 'prod'); // stored at t=1000
    clock = 10_000; // age 9000ms > 5000ms
    const served = await lkg.resolve(ref, 'prod');

    expect(served.ok).toBe(false);
    expect(!served.ok && served.error.code).toBe('stale-record');
  });

  test('passes through the resolver failure when nothing is cached', async () => {
    const provider = scriptedProvider([
      {
        ok: false,
        error: {
          code: 'unknown-unit',
          ref: 'acme/checkout#cart',
          message: 'no such unit',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    const served = await lkg.resolve(ref, 'prod');
    expect(!served.ok && served.error.code).toBe('unknown-unit');
  });

  test('rollback = atomic whole-record swap; the latest success is what is served', async () => {
    const provider = scriptedProvider([
      okResult('bm-1'),
      okResult('bm-2'),
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    await lkg.resolve(ref, 'prod'); // caches bm-1
    await lkg.resolve(ref, 'prod'); // swaps whole record to bm-2
    const served = unitOf(await lkg.resolve(ref, 'prod'));
    expect(served.buildMarker).toBe('bm-2');
    expect(served.compatibility.status).toBe('degraded');
  });

  test('two surfaces of one unit share a single atomically-swapped snapshot', async () => {
    const provider = scriptedProvider([
      okResult('bm-1'),
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#banner',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    const cartRef = { unitId: 'acme/checkout', surfaceId: 'cart' };
    const bannerRef = { unitId: 'acme/checkout', surfaceId: 'banner' };

    // Resolving one surface caches the whole unit snapshot under (unitId, env).
    await lkg.resolve(cartRef, 'prod');
    // A different surface of the SAME unit, while the provider is down, is
    // served from that one shared snapshot — no mixed build markers.
    const served = await lkg.resolve(bannerRef, 'prod');
    expect(served.ok).toBe(true);
    expect(unitOf(served).buildMarker).toBe('bm-1');
    expect(unitOf(served).compatibility.status).toBe('degraded');
  });

  test('an incompatible record is never cached nor served as last-known-good', async () => {
    const incompatible: DiscoveryResult = {
      ok: true,
      unit: {
        ...record('bm-9'),
        compatibility: {
          status: 'incompatible',
          baselineCohortId: 'cohort-9',
          reason: 'baseline skew',
        },
      },
    };
    const provider = scriptedProvider([
      incompatible,
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    // The incompatible success is returned live but never cached.
    const first = await lkg.resolve(ref, 'prod');
    expect(unitOf(first).compatibility.status).toBe('incompatible');
    // With nothing good cached, the provider failure passes through — the
    // incompatible record is never resurrected as a degraded LKG.
    const served = await lkg.resolve(ref, 'prod');
    expect(served.ok).toBe(false);
    expect(!served.ok && served.error.code).toBe('provider-unavailable');
  });

  test('an incompatible refresh does not clobber the last good record', async () => {
    const incompatibleBm2: DiscoveryResult = {
      ok: true,
      unit: {
        ...record('bm-2'),
        compatibility: {
          status: 'incompatible',
          baselineCohortId: 'cohort-9',
          reason: 'baseline skew',
        },
      },
    };
    const provider = scriptedProvider([
      okResult('bm-1'),
      incompatibleBm2,
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    await lkg.resolve(ref, 'prod'); // caches bm-1 (compatible)
    await lkg.resolve(ref, 'prod'); // incompatible bm-2 returned, NOT cached
    const served = unitOf(await lkg.resolve(ref, 'prod')); // provider fails
    expect(served.buildMarker).toBe('bm-1');
    expect(served.compatibility.status).toBe('degraded');
  });

  test('honours a pluggable storage hook', async () => {
    const backing = new Map<string, unknown>();
    const storage: LkgStorage = {
      read: key => backing.get(key) as never,
      write: (key, value) => {
        backing.set(key, value);
      },
    };
    const provider = scriptedProvider([
      okResult('bm-1'),
      {
        ok: false,
        error: {
          code: 'provider-unavailable',
          ref: 'acme/checkout#cart',
          message: 'offline',
        },
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider, storage });

    await lkg.resolve(ref, 'prod');
    expect(backing.size).toBe(1);
    const served = await lkg.resolve(ref, 'prod');
    expect(unitOf(served).compatibility.status).toBe('degraded');
  });
});
