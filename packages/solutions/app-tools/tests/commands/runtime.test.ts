import {
  createRuntimeFallbackSignalPayload,
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
