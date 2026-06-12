import {
  createRuntimeFallbackSignalPayload,
  formatRuntimeOutput,
  resolveRuntimeEndpoint,
  resolveToken,
} from '../../src/commands/runtime';

describe('runtime command helpers', () => {
  test('resolveRuntimeEndpoint supports absolute URLs and path shortcuts', () => {
    expect(
      resolveRuntimeEndpoint(
        'https://service.example.com/_modern/runtime/status',
        '/_modern/runtime/status',
      ),
    ).toBe('https://service.example.com/_modern/runtime/status');

    expect(
      resolveRuntimeEndpoint(
        '/_modern/runtime/status',
        '/_modern/runtime/status',
      ),
    ).toBe('http://127.0.0.1:8080/_modern/runtime/status');

    expect(resolveRuntimeEndpoint(undefined, '/_modern/runtime/status')).toBe(
      'http://127.0.0.1:8080/_modern/runtime/status',
    );
  });

  test('resolveToken prefers explicit token over env var', () => {
    const previous = process.env.MODERN_RUNTIME_SIGNAL_TOKEN;
    process.env.MODERN_RUNTIME_SIGNAL_TOKEN = 'env-token';
    try {
      expect(
        resolveToken({
          token: 'explicit-token',
          tokenEnv: 'MODERN_RUNTIME_SIGNAL_TOKEN',
        }),
      ).toBe('explicit-token');
      expect(
        resolveToken({
          tokenEnv: 'MODERN_RUNTIME_SIGNAL_TOKEN',
        }),
      ).toBe('env-token');
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.MODERN_RUNTIME_SIGNAL_TOKEN;
      } else {
        process.env.MODERN_RUNTIME_SIGNAL_TOKEN = previous;
      }
    }
  });

  test('formatRuntimeOutput emits machine JSON only with --json', () => {
    const payload = {
      status: 'healthy',
      apps: [{ name: 'crm-shell', healthy: true }],
      counts: { remotes: 2 },
    };

    const jsonOutput = formatRuntimeOutput(payload, true);
    expect(JSON.parse(jsonOutput)).toEqual(payload);
    expect(jsonOutput).toBe(JSON.stringify(payload, null, 2));

    const humanOutput = formatRuntimeOutput(payload, undefined);
    expect(humanOutput).not.toBe(jsonOutput);
    expect(() => JSON.parse(humanOutput)).toThrow();
    expect(humanOutput).toBe(
      [
        'status: healthy',
        'apps:',
        '  -',
        '    name: crm-shell',
        '    healthy: true',
        'counts:',
        '  remotes: 2',
      ].join('\n'),
    );
  });

  test('createRuntimeFallbackSignalPayload includes optional metadata and digest', () => {
    const payload = createRuntimeFallbackSignalPayload({
      app: 'crm-shell',
      reason: 'remote_load_failed',
      phase: 'load',
      entry: 'https://erp.example.com/remoteEntry.js',
      runtimeDigest: 'digest-crm-v1',
      metadata: '{"traceId":"abc123"}',
    });

    expect(payload).toEqual({
      appName: 'crm-shell',
      reason: 'remote_load_failed',
      phase: 'load',
      entry: 'https://erp.example.com/remoteEntry.js',
      runtimeDigest: 'digest-crm-v1',
      metadata: {
        traceId: 'abc123',
      },
    });
  });
});
