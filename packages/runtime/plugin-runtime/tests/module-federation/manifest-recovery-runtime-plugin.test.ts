import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rsbuild/core';
import {
  createModuleFederationManifestRecoveryPlugin,
  type ModuleFederationManifestRecoveryPluginOptions,
} from '../../src/module-federation/manifest-recovery-runtime-plugin';

const recoveryPluginEntry = path.resolve(
  __dirname,
  '../../src/module-federation/manifest-recovery-runtime-plugin.ts',
);

const compileBrowserRecoveryPlugin = async () => {
  const outputPath = await mkdtemp(
    path.join(tmpdir(), 'modern-manifest-recovery-browser-'),
  );

  try {
    const compiler = rspack({
      context: path.dirname(recoveryPluginEntry),
      entry: recoveryPluginEntry,
      mode: 'production',
      module: {
        rules: [
          {
            test: /\.[cm]?[jt]sx?$/,
            type: 'javascript/auto',
            use: [
              {
                loader: 'builtin:swc-loader',
                options: {
                  jsc: {
                    parser: {
                      syntax: 'typescript',
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      output: {
        filename: 'manifest-recovery.js',
        library: {
          type: 'commonjs2',
        },
        path: outputPath,
      },
      target: 'web',
    });

    await new Promise<void>((resolve, reject) => {
      compiler.run((runError, compilationStats) => {
        compiler.close(closeError => {
          const error = runError ?? closeError;
          if (error !== null && error !== undefined) {
            reject(error);
            return;
          }
          if (compilationStats === undefined || compilationStats.hasErrors()) {
            reject(
              new Error(
                compilationStats?.toString({
                  all: false,
                  errors: true,
                  warnings: true,
                }) ?? 'Rspack did not return compilation stats.',
              ),
            );
            return;
          }
          resolve();
        });
      });
    });
  } finally {
    await rm(outputPath, { force: true, recursive: true });
  }
};

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
  test('builds as a browser runtime without Node-only dependencies', async () => {
    await expect(compileBrowserRecoveryPlugin()).resolves.toBeUndefined();
  });

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

  test('retries a synchronous fetch failure through the hook promise contract', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed');
      }
      return Promise.resolve(Response.json(manifest));
    };

    await expect(
      hook({
        attempts: 2,
        fetchImpl,
        retryDelayMs: 0,
        timeoutMs: 50,
      })(args()),
    ).resolves.toEqual(manifest);
    expect(calls).toBe(2);
  });

  test('retries through the built-in backoff when no wait implementation is injected', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(Response.json(manifest));
    };

    await expect(
      hook({
        attempts: 2,
        fetchImpl,
        retryDelayMs: 1,
        timeoutMs: 50,
      })(args()),
    ).resolves.toEqual(manifest);
    expect(calls).toBe(2);
  });

  test.each([
    408, 425, 429, 500, 502, 503, 504,
  ])('retries explicitly transient HTTP %i responses', async status => {
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
      error: new SyntaxError('Unexpected token'),
      id: 'http://127.0.0.1:3999/mf-manifest.json',
      lifecycle: 'afterResolve',
      name: 'malformed JSON',
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
