import {
  classifyRemoteLoadFailure,
  loadRemoteModuleWithRetryBase,
  RemoteComponentContractError,
  RemoteLoadError,
  RemoteLoadTimeoutError,
  resolveRemoteComponentBase,
} from '../mf-host/src/routes/mf/remoteLoaderCore';

describe('remote loader reliability', () => {
  test('retries retryable load errors before succeeding', async () => {
    let attempts = 0;

    const module = await loadRemoteModuleWithRetryBase('remote/Widget', {
      retries: 1,
      retryDelayMs: 0,
      loadRemoteImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('network failure');
        }
        return {
          default: (): null => null,
        } as unknown as {
          default: unknown;
        };
      },
      waitImpl: async () => {},
    });

    expect(attempts).toBe(2);
    expect(typeof module.default).toBe('function');
  });

  test('surfaces timeout as deterministic RemoteLoadError', async () => {
    await expect(
      loadRemoteModuleWithRetryBase('remote/Widget', {
        retries: 0,
        timeoutMs: 20,
        loadRemoteImpl: () =>
          new Promise(() => {
            // never resolve to trigger timeout branch
          }),
      }),
    ).rejects.toBeInstanceOf(RemoteLoadError);
  });

  test('does not retry non-retryable load errors', async () => {
    let attempts = 0;

    await expect(
      loadRemoteModuleWithRetryBase('remote/Widget', {
        retries: 2,
        retryDelayMs: 0,
        loadRemoteImpl: async () => {
          attempts += 1;
          throw new Error('contract mismatch');
        },
      }),
    ).rejects.toBeInstanceOf(RemoteLoadError);

    expect(attempts).toBe(1);
  });

  test('throws typed contract error for invalid component export', () => {
    expect(() =>
      resolveRemoteComponentBase(
        'remote/Widget',
        {
          default: {
            notAComponent: true,
          },
        },
        'default',
      ),
    ).toThrow(RemoteComponentContractError);
  });

  test('classifies remote fallback telemetry reasons', () => {
    expect(
      classifyRemoteLoadFailure(
        new RemoteLoadTimeoutError('remote/Widget', 20),
      ),
    ).toBe('timeout');
    expect(classifyRemoteLoadFailure(new Error('failed to fetch chunk'))).toBe(
      'network',
    );
    expect(
      classifyRemoteLoadFailure(
        new RemoteComponentContractError('remote/Widget', 'default'),
      ),
    ).toBe('contract');
    expect(
      classifyRemoteLoadFailure(
        new Error('@tanstack/react-router requiredVersion mismatch'),
      ),
    ).toBe('version-skew');
    expect(
      classifyRemoteLoadFailure(
        new RemoteLoadError(
          'remote/Widget',
          1,
          new Error('manifest not found'),
        ),
      ),
    ).toBe('remote-unavailable');
  });
});
