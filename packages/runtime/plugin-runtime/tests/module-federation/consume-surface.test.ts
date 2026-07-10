import {
  consumeSurface,
  createSurfaceConsumer,
  type ResolvedDeliveryUnit,
  type SurfaceConsumptionFailure,
  type SurfaceProvider,
} from '../../src/module-federation';

const okRecord = (): ResolvedDeliveryUnit => ({
  unitId: 'acme/checkout',
  buildMarker: 'bm-1',
  sourceRevision: 'rev-1',
  baselineCohortId: 'cohort-1',
  surfaces: [
    {
      surfaceId: 'cart',
      kind: 'component',
      locations: [
        { platform: 'browser-mf', manifestUrl: 'https://cdn/mf-manifest.json' },
      ],
    },
  ],
  compatibility: { status: 'compatible', baselineCohortId: 'cohort-1' },
});

const providerOf = (resolve: SurfaceProvider['resolve']): SurfaceProvider => ({
  resolve,
});

describe('G22 consumeSurface — mandatory degraded consumption', () => {
  test('unavailable remote invokes the required degraded handler (never throws)', async () => {
    const provider = providerOf(() => ({
      kind: 'discovery-error',
      code: 'provider-unavailable',
      message: 'env provider offline',
      ref: { unitId: 'acme/checkout', surfaceId: 'cart' },
      env: 'prod',
    }));

    let seen: SurfaceConsumptionFailure | undefined;
    const value = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      provider,
      appName: 'crm-shell',
      load: () => 'live',
      degraded: failure => {
        seen = failure;
        return 'fallback-ui';
      },
    });

    expect(value).toBe('fallback-ui');
    expect(seen?.phase).toBe('discovery');
    expect(seen?.classification).toBe('remote-unavailable');
    expect(seen?.discoveryError?.code).toBe('provider-unavailable');
    expect(seen?.telemetry.eventName).toBe('modernjs:mf-runtime-fallback');
    expect(seen?.telemetry.metadata.status).toBe('degraded');
  });

  test('load failure is caught, classified, and degraded with the resolved record', async () => {
    const provider = providerOf(() => okRecord());

    let seen: SurfaceConsumptionFailure | undefined;
    const value = await consumeSurface<string>({
      ref: { unitId: 'acme/checkout', surfaceId: 'cart' },
      env: 'prod',
      provider,
      appName: 'crm-shell',
      load: () => {
        throw new Error('failed to fetch chunk');
      },
      degraded: failure => {
        seen = failure;
        return 'fallback-ui';
      },
    });

    expect(value).toBe('fallback-ui');
    expect(seen?.phase).toBe('load');
    expect(seen?.classification).toBe('network');
    expect(seen?.resolved?.buildMarker).toBe('bm-1');
    expect(seen?.discoveryError).toBeUndefined();
  });

  test('incompatible verdict degrades before loading against a bad contract', async () => {
    const provider = providerOf(() => ({
      ...okRecord(),
      compatibility: {
        status: 'incompatible' as const,
        baselineCohortId: 'cohort-9',
        reason: 'baseline skew',
      },
    }));

    let loaded = false;
    const value = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      provider,
      appName: 'crm-shell',
      load: () => {
        loaded = true;
        return 'live';
      },
      degraded: () => 'fallback-ui',
    });

    expect(value).toBe('fallback-ui');
    expect(loaded).toBe(false);
  });

  test('sibling isolation: one failing consumption never affects another', async () => {
    const failing = providerOf(() => ({
      kind: 'discovery-error',
      code: 'unknown-unit',
      message: 'no such unit',
      ref: { unitId: 'acme/broken', surfaceId: 'x' },
      env: 'prod',
    }));
    const healthy = providerOf(() => okRecord());

    const [a, b] = await Promise.all([
      consumeSurface<string>({
        ref: 'acme/broken#x',
        env: 'prod',
        provider: failing,
        appName: 'shell',
        load: () => 'never',
        degraded: () => 'A-degraded',
      }),
      consumeSurface<string>({
        ref: 'acme/checkout#cart',
        env: 'prod',
        provider: healthy,
        appName: 'shell',
        load: () => 'B-live',
        degraded: () => 'B-degraded',
      }),
    ]);

    expect(a).toBe('A-degraded');
    expect(b).toBe('B-live');
  });

  test('createSurfaceConsumer binds provider/env/app and still requires degraded', async () => {
    const consume = createSurfaceConsumer({
      provider: providerOf(() => okRecord()),
      env: 'prod',
      appName: 'shell',
    });

    const value = await consume<string>({
      ref: 'acme/checkout#cart',
      load: ({ resolved }) => `live:${resolved.buildMarker}`,
      degraded: () => 'fallback',
    });

    expect(value).toBe('live:bm-1');
  });
});
