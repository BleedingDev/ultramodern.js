import {
  createLastKnownGoodProvider,
  isDiscoveryError,
  type LkgStorage,
  type ResolvedDeliveryUnit,
  type SurfaceProvider,
  type SurfaceResolution,
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
          platform: 'browser-mf',
          manifestUrl: `https://cdn/${buildMarker}.json`,
        },
      ],
    },
  ],
  compatibility: { status: 'compatible', baselineCohortId: 'cohort-1' },
});

const ref = { unitId: 'acme/checkout', surfaceId: 'cart' };

/** A provider whose per-call result is scripted. */
const scriptedProvider = (
  script: Array<SurfaceResolution | (() => never)>,
): SurfaceProvider => {
  let i = 0;
  return {
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
      record('bm-1'),
      {
        kind: 'discovery-error',
        code: 'provider-unavailable',
        message: 'offline',
        ref,
        env: 'prod',
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    const first = await lkg.resolve(ref, 'prod');
    expect(isDiscoveryError(first)).toBe(false);

    const second = await lkg.resolve(ref, 'prod');
    expect(isDiscoveryError(second)).toBe(false);
    const served = second as ResolvedDeliveryUnit;
    // Whole prior record, only the verdict flipped.
    expect(served.buildMarker).toBe('bm-1');
    expect(served.sourceRevision).toBe('rev-bm-1');
    expect(served.surfaces).toEqual(record('bm-1').surfaces);
    expect(served.compatibility.status).toBe('degraded');
  });

  test('serves LKG when the wrapped provider throws', async () => {
    const provider = scriptedProvider([
      record('bm-1'),
      () => {
        throw new Error('boom');
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    await lkg.resolve(ref, 'prod');
    const served = await lkg.resolve(ref, 'prod');
    expect(isDiscoveryError(served)).toBe(false);
    expect((served as ResolvedDeliveryUnit).compatibility.status).toBe(
      'degraded',
    );
  });

  test('expiry yields a typed stale-record error, never a partial record', async () => {
    let clock = 1_000;
    const provider = scriptedProvider([
      record('bm-1'),
      {
        kind: 'discovery-error',
        code: 'provider-unavailable',
        message: 'offline',
        ref,
        env: 'prod',
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

    expect(isDiscoveryError(served)).toBe(true);
    expect(isDiscoveryError(served) && served.code).toBe('stale-record');
  });

  test('passes through the resolver failure when nothing is cached', async () => {
    const provider = scriptedProvider([
      {
        kind: 'discovery-error',
        code: 'unknown-unit',
        message: 'no such unit',
        ref,
        env: 'prod',
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    const served = await lkg.resolve(ref, 'prod');
    expect(isDiscoveryError(served) && served.code).toBe('unknown-unit');
  });

  test('rollback = atomic whole-record swap; the latest success is what is served', async () => {
    const provider = scriptedProvider([
      record('bm-1'),
      record('bm-2'),
      {
        kind: 'discovery-error',
        code: 'provider-unavailable',
        message: 'offline',
        ref,
        env: 'prod',
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider });

    await lkg.resolve(ref, 'prod'); // caches bm-1
    await lkg.resolve(ref, 'prod'); // swaps whole record to bm-2
    const served = (await lkg.resolve(ref, 'prod')) as ResolvedDeliveryUnit;
    expect(served.buildMarker).toBe('bm-2');
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
      record('bm-1'),
      {
        kind: 'discovery-error',
        code: 'provider-unavailable',
        message: 'offline',
        ref,
        env: 'prod',
      },
    ]);
    const lkg = createLastKnownGoodProvider({ provider, storage });

    await lkg.resolve(ref, 'prod');
    expect(backing.size).toBe(1);
    const served = await lkg.resolve(ref, 'prod');
    expect((served as ResolvedDeliveryUnit).compatibility.status).toBe(
      'degraded',
    );
  });
});
