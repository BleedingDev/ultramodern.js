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
      classification: 'noncritical',
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
      classification: 'noncritical',
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
      classification: 'noncritical',
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
        classification: 'noncritical',
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
      classification: 'noncritical',
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

  test('unclassified consumption defaults to critical and rejects after the degraded handler ran', async () => {
    const provider = providerOf(() => ({
      ok: false,
      error: {
        code: 'unknown-unit',
        ref: 'acme/checkout#cart',
        message: 'no such unit',
      },
    }));

    let degradedRan = false;
    const rejection = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      provider,
      appName: 'shell',
      // no classification → defaults to 'critical'
      load: () => 'live',
      degraded: () => {
        degradedRan = true;
        return 'fallback-ui';
      },
    }).then(
      () => undefined,
      error => error,
    );

    // Degraded handler still ran (telemetry + fallback-UI obligations hold)...
    expect(degradedRan).toBe(true);
    // ...but the promise rejected with the typed discovery error.
    expect((rejection as { code?: string } | undefined)?.code).toBe(
      'unknown-unit',
    );
  });

  test('explicit critical classification rejects with the typed error', async () => {
    const provider = providerOf(() => ({
      ok: false,
      error: {
        code: 'provider-unavailable',
        ref: 'acme/checkout#cart',
        message: 'offline',
      },
    }));

    await expect(
      consumeSurface<string>({
        ref: 'acme/checkout#cart',
        env: 'prod',
        provider,
        appName: 'shell',
        classification: 'critical',
        load: () => 'live',
        degraded: () => 'fallback-ui',
      }),
    ).rejects.toMatchObject({ code: 'provider-unavailable' });
  });

  test('noncritical: a throwing degraded handler is contained and resolves undefined', async () => {
    const provider = providerOf(() => ({
      ok: false,
      error: {
        code: 'provider-unavailable',
        ref: 'acme/checkout#cart',
        message: 'offline',
      },
    }));

    const value = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      provider,
      appName: 'shell',
      classification: 'noncritical',
      load: () => 'live',
      degraded: () => {
        throw new Error('handler blew up');
      },
    });

    expect(value).toBeUndefined();
  });

  test('critical: a throwing degraded handler rejects with the ORIGINAL typed error, not the handler error', async () => {
    const provider = providerOf(() => ({
      ok: false,
      error: {
        code: 'provider-unavailable',
        ref: 'acme/checkout#cart',
        message: 'offline',
      },
    }));

    const rejection = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      provider,
      appName: 'shell',
      classification: 'critical',
      load: () => 'live',
      degraded: () => {
        throw new Error('handler blew up');
      },
    }).then(
      () => undefined,
      error => error,
    );

    expect((rejection as { code?: string } | undefined)?.code).toBe(
      'provider-unavailable',
    );
    expect((rejection as { message?: string } | undefined)?.message).not.toBe(
      'handler blew up',
    );
  });
});
