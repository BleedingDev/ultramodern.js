import {
  createModuleFederationManifestRecoveryPlugin,
  type ModuleFederationManifestRecoveryPluginOptions,
} from '../../src/module-federation/manifest-recovery-runtime-plugin';

type RecoveryHook = NonNullable<
  ReturnType<
    typeof createModuleFederationManifestRecoveryPlugin
  >['errorLoadRemote']
>;

const manifest = {
  exposes: [],
  metaData: {
    name: 'inventory',
  },
  shared: [],
};

function hook(
  options: ModuleFederationManifestRecoveryPluginOptions = {},
): RecoveryHook {
  const recovery = createModuleFederationManifestRecoveryPlugin(options);
  if (!recovery.errorLoadRemote) {
    throw new Error('manifest recovery plugin did not register its hook');
  }
  return recovery.errorLoadRemote;
}

const args = (error: unknown = new TypeError('fetch failed')) =>
  ({
    error,
    from: 'runtime',
    id: 'http://127.0.0.1:3999/mf-manifest.json',
    lifecycle: 'afterResolve',
  }) as Parameters<RecoveryHook>[0];

describe('Module Federation manifest recovery runtime plugin', () => {
  test('retries a transient manifest network failure and returns valid JSON', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async input => {
      calls.push(String(input));
      if (calls.length === 1) {
        throw new TypeError('fetch failed');
      }
      return Response.json(manifest);
    };

    await expect(
      hook({
        attempts: 2,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args()),
    ).resolves.toEqual(manifest);
    expect(calls).toHaveLength(2);
  });

  test('retries an explicitly transient HTTP 503 response', async () => {
    const status = 503;
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response('temporarily unavailable', { status })
        : Response.json(manifest);
    };

    await expect(
      hook({
        attempts: 2,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args(Object.assign(new Error(`HTTP ${status}`), { status }))),
    ).resolves.toEqual(manifest);
    expect(calls).toBe(2);
  });

  // The runtime parses a 503 error page as JSON and reports the SyntaxError.
  test('recovers a transient HTTP 503 that the runtime saw as malformed JSON', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response('temporarily unavailable', { status: 503 })
        : Response.json(manifest);
    };

    await expect(
      hook({
        attempts: 3,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args(new SyntaxError('Unexpected token'))),
    ).resolves.toEqual(manifest);
    expect(calls).toBe(2);
  });

  test('checks a malformed manifest once and leaves a successful response alone', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('{broken', { status: 200 });
    };

    await expect(
      hook({
        attempts: 3,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args(new SyntaxError('Unexpected token'))),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  test('stops after the configured bounded attempt count', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };

    await expect(
      hook({
        attempts: 3,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args()),
    ).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  test('abandons a manifest fetch at the configured timeout', async () => {
    let aborted = false;
    const fetchImpl: typeof fetch = (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(
          new Error('fetch did not receive an abort signal'),
        );
      }

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    };

    await expect(
      hook({
        attempts: 1,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 5,
      })(args()),
    ).resolves.toBeUndefined();
    expect(aborted).toBe(true);
  });

  test.each([
    {
      error: new Error('factory execution failed'),
      id: 'http://127.0.0.1:3999/mf-manifest.json',
      lifecycle: 'onLoad',
      name: 'arbitrary factory error',
    },
    {
      error: new TypeError('fetch failed'),
      id: 'file:///tmp/mf-manifest.json',
      lifecycle: 'afterResolve',
      name: 'non-HTTP manifest',
    },
    {
      error: new TypeError('fetch failed'),
      id: 'http://127.0.0.1:3999/remoteEntry.js',
      lifecycle: 'afterResolve',
      name: 'remote entry',
    },
    {
      error: new Error('[ Federation Runtime ]: RUNTIME-013'),
      id: 'http://127.0.0.1:3999/mf-manifest.json',
      lifecycle: 'afterResolve',
      name: 'typed invalid-manifest failure',
    },
    {
      error: new Error('identity mismatch'),
      id: 'http://127.0.0.1:3999/mf-manifest.json',
      lifecycle: 'afterResolve',
      name: 'identity incompatibility',
    },
  ])('never intercepts $name', async ({ error, id, lifecycle }) => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return Response.json(manifest);
    };

    await expect(
      hook({ attempts: 2, fetchImpl })({
        ...args(error),
        id,
        lifecycle,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  test('does not recover a successful HTTP response containing malformed JSON', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('{broken', { status: 200 });
    };

    await expect(
      hook({
        attempts: 3,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args()),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  test('returns structurally invalid JSON to runtime-core for typed RUNTIME-013 validation', async () => {
    const invalidManifest = { metaData: { name: 'inventory' } };
    const fetchImpl: typeof fetch = async () => Response.json(invalidManifest);

    await expect(
      hook({
        attempts: 1,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args()),
    ).resolves.toEqual(invalidManifest);
  });
});
