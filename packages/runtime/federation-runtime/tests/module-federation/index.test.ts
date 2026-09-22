import {
  classifyModuleFederationFallback,
  consumeSurface,
  createLastKnownGoodProvider,
  type DiscoveryResult,
  emitModuleFederationFallbackTelemetry,
  ModuleFederationRemoteComponentContractError,
  ModuleFederationRemoteLoadError,
  ModuleFederationRemoteLoadTimeoutError,
  type ResolvedDeliveryUnit,
} from '../../src/module-federation';

describe('module federation degraded telemetry', () => {
  test('classifies deterministic fallback reasons', () => {
    expect(
      classifyModuleFederationFallback(
        new ModuleFederationRemoteLoadTimeoutError('remote/Widget', 20),
      ),
    ).toBe('timeout');
    expect(
      classifyModuleFederationFallback(new Error('failed to fetch chunk')),
    ).toBe('network');
    expect(
      classifyModuleFederationFallback(
        new ModuleFederationRemoteComponentContractError(
          'remote/Widget',
          'default',
        ),
      ),
    ).toBe('contract');
    expect(
      classifyModuleFederationFallback(
        new Error('@tanstack/react-router requiredVersion mismatch'),
      ),
    ).toBe('version-skew');
    expect(
      classifyModuleFederationFallback(
        new ModuleFederationRemoteLoadError(
          'remote/Widget',
          1,
          new Error('manifest not found'),
        ),
      ),
    ).toBe('remote-unavailable');
  });
});

const cartUnit = (): ResolvedDeliveryUnit => ({
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

const offline: DiscoveryResult = {
  ok: false,
  error: {
    code: 'provider-unavailable',
    ref: 'acme/checkout#cart',
    message: 'offline',
  },
};

describe('degraded remote consumption', () => {
  test('an unavailable remote renders the fallback instead of throwing', async () => {
    const value = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      appName: 'shell',
      classification: 'noncritical',
      provider: { name: 'offline', resolve: () => offline },
      load: () => 'live',
      degraded: () => 'fallback-ui',
    });

    expect(value).toBe('fallback-ui');
  });

  test('last-known-good serves the previous record marked degraded', async () => {
    let calls = 0;
    const lkg = createLastKnownGoodProvider({
      provider: {
        name: 'scripted',
        resolve: () => {
          calls += 1;
          return calls === 1 ? { ok: true, unit: cartUnit() } : offline;
        },
      },
    });
    const ref = { unitId: 'acme/checkout', surfaceId: 'cart' };

    await lkg.resolve(ref, 'prod');
    const served = await lkg.resolve(ref, 'prod');

    expect(served.ok).toBe(true);
    expect(served.ok && served.unit.buildMarker).toBe('bm-1');
    expect(served.ok && served.unit.compatibility.status).toBe('degraded');
  });
});

describe('bounded fallback reporting', () => {
  test('degraded UI settles before stalled reporting and exposes bounded delivery observation', async () => {
    const deliveries: Promise<{ posted: boolean }>[] = [];
    let reported: unknown;
    let signal: AbortSignal | undefined;
    let received: unknown;
    const value = await consumeSurface<string>({
      ref: 'acme/checkout#cart',
      env: 'prod',
      appName: 'shell',
      classification: 'noncritical',
      provider: { name: 'offline', resolve: () => offline },
      load: () => 'live',
      degraded: failure => {
        received = failure.telemetry;
        return 'fallback';
      },
      telemetry: {
        endpoint: '/signals',
        timeoutMs: 20,
        fetchImpl: (_url, init) => {
          signal = init?.signal ?? undefined;
          return new Promise(() => {});
        },
        observe: (payload, delivery) => {
          reported = payload;
          deliveries.push(delivery);
        },
      },
    });
    expect(value).toBe('fallback');
    expect(reported).toBe(received);
    expect(signal?.aborted).toBe(false);
    expect(await deliveries[0]).toMatchObject({ posted: false });
    expect(signal?.aborted).toBe(true);
  });

  test('preserves local browser events and authenticated HTTP reporting', async () => {
    const dispatchEvent = rs.fn();
    const fetchImpl = rs.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    rs.stubGlobal('window', { dispatchEvent });
    try {
      await expect(
        emitModuleFederationFallbackTelemetry(
          {
            appName: 'shell',
            classification: 'network',
            phase: 'load',
            remote: 'checkout/cart',
          },
          { endpoint: '/signals', authToken: 'local-test-token', fetchImpl },
        ),
      ).resolves.toEqual({
        dispatched: true,
        posted: true,
        postStatus: 202,
      });
      const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('modernjs:mf-runtime-fallback');
      const init = fetchImpl.mock.calls[0][1] as RequestInit;
      expect(
        new Headers(init.headers).get('x-modernjs-runtime-signal-token'),
      ).toBe('local-test-token');
      expect(JSON.parse(String(init.body))).toEqual(event.detail);
    } finally {
      rs.unstubAllGlobals();
    }
  });

  test('critical failure retains its original cause while both reporter and handler fail', async () => {
    const original = new Error('load failed');
    const deliveries: Promise<unknown>[] = [];
    await expect(
      consumeSurface<string>({
        ref: 'acme/checkout#cart',
        env: 'prod',
        appName: 'shell',
        provider: {
          name: 'online',
          resolve: () => ({ ok: true, unit: cartUnit() }),
        },
        load: () => {
          throw original;
        },
        degraded: () => {
          throw new Error('handler failed');
        },
        telemetry: {
          endpoint: '/signals',
          fetchImpl: () => Promise.reject(new Error('sink failed')),
          observe: (_payload, delivery) => deliveries.push(delivery),
        },
      }),
    ).rejects.toBe(original);
    expect(await Promise.all(deliveries)).toEqual([
      { dispatched: false, posted: false },
      { dispatched: false, posted: false },
    ]);
  });

  test('noncritical handler failure resolves undefined even if observation throws', async () => {
    await expect(
      consumeSurface<string>({
        ref: 'acme/checkout#cart',
        env: 'prod',
        appName: 'shell',
        classification: 'noncritical',
        provider: { name: 'offline', resolve: () => offline },
        load: () => 'live',
        degraded: () => {
          throw new Error('handler failed');
        },
        telemetry: {
          observe: () => {
            throw new Error('observer failed');
          },
        },
      }),
    ).resolves.toBeUndefined();
  });
});
