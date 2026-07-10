import {
  consumeSurface,
  createSurfaceConsumer,
  type ResolvedDeliveryUnit,
  type SurfaceConsumptionFailure,
  type SurfaceResolutionProvider,
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
        {
          platform: 'browser-mf-manifest',
          manifestUrl: 'https://cdn/mf-manifest.json',
        },
      ],
    },
  ],
  compatibility: { status: 'compatible', baselineCohortId: 'cohort-1' },
});

const providerOf = (
  resolve: SurfaceResolutionProvider['resolve'],
): SurfaceResolutionProvider => ({
  name: 'test-provider',
  resolve,
});

describe('G22 consumeSurface — mandatory degraded consumption', () => {
  test('unavailable remote invokes the required degraded handler (never throws)', async () => {
    const provider = providerOf(() => ({
      ok: false,
      error: {
        code: 'provider-unavailable',
        ref: 'acme/checkout#cart',
        message: 'env provider offline',
      },
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
    const provider = providerOf(() => ({ ok: true, unit: okRecord() }));

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
      ok: true,
      unit: {
        ...okRecord(),
        compatibility: {
          status: 'incompatible' as const,
          baselineCohortId: 'cohort-9',
          reason: 'baseline skew',
        },
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
      ok: false,
      error: {
        code: 'unknown-unit',
        ref: 'acme/broken#x',
        message: 'no such unit',
      },
    }));
    const healthy = providerOf(() => ({ ok: true, unit: okRecord() }));

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
      provider: providerOf(() => ({ ok: true, unit: okRecord() })),
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

  test('a malformed string ref degrades without calling the provider', async () => {
    let resolved = false;
    const provider = providerOf(() => {
      resolved = true;
      return { ok: true, unit: okRecord() };
    });

    let seen: SurfaceConsumptionFailure | undefined;
    const value = await consumeSurface<string>({
      ref: 'not-a-surface-ref',
      env: 'prod',
      provider,
      appName: 'shell',
      load: () => 'live',
      degraded: failure => {
        seen = failure;
        return 'fallback-ui';
      },
    });

    expect(value).toBe('fallback-ui');
    expect(resolved).toBe(false);
    expect(seen?.phase).toBe('discovery');
    expect(seen?.classification).toBe('remote-unavailable');
    expect(seen?.discoveryError?.code).toBe('unknown-surface');
  });
});
