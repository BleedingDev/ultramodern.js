import {
  DEFAULT_ENVIRONMENT_NAME,
  DEFAULT_MF_REMOTE_MANIFEST_TIMEOUT_MS,
  DEFAULT_TELEMETRY_OTLP_ENDPOINT,
  DEFAULT_TELEMETRY_VICTORIA_METRICS_ENDPOINT,
  parseServerRuntimeExtensionsEnv,
} from '../src/env';

describe('parseServerRuntimeExtensionsEnv', () => {
  test('applies documented defaults for an empty environment', () => {
    const parsed = parseServerRuntimeExtensionsEnv({});

    expect(parsed).toEqual({
      modernEnv: undefined,
      nodeEnv: undefined,
      environmentName: DEFAULT_ENVIRONMENT_NAME,
      contractGatesFile: undefined,
      telemetryOtlpEndpoint: DEFAULT_TELEMETRY_OTLP_ENDPOINT,
      telemetryVictoriaMetricsEndpoint:
        DEFAULT_TELEMETRY_VICTORIA_METRICS_ENDPOINT,
      mfRemoteManifestTimeoutMs: DEFAULT_MF_REMOTE_MANIFEST_TIMEOUT_MS,
    });
  });

  test('parses configured values and trims whitespace', () => {
    const parsed = parseServerRuntimeExtensionsEnv({
      MODERN_ENV: ' staging ',
      NODE_ENV: 'production',
      MODERN_CONTRACT_GATES_FILE: ' /var/run/gates.json ',
      MODERN_TELEMETRY_OTLP_ENDPOINT: 'https://otlp.example.com/v1/logs',
      MODERN_TELEMETRY_VICTORIA_ENDPOINT: 'https://vm.example.com/import',
      MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS: '2500',
    });

    expect(parsed.modernEnv).toBe('staging');
    expect(parsed.nodeEnv).toBe('production');
    expect(parsed.environmentName).toBe('staging');
    expect(parsed.contractGatesFile).toBe('/var/run/gates.json');
    expect(parsed.telemetryOtlpEndpoint).toBe(
      'https://otlp.example.com/v1/logs',
    );
    expect(parsed.telemetryVictoriaMetricsEndpoint).toBe(
      'https://vm.example.com/import',
    );
    expect(parsed.mfRemoteManifestTimeoutMs).toBe(2500);
  });

  test('falls back from MODERN_ENV to NODE_ENV to the default', () => {
    expect(
      parseServerRuntimeExtensionsEnv({ NODE_ENV: 'production' })
        .environmentName,
    ).toBe('production');
    expect(
      parseServerRuntimeExtensionsEnv({
        MODERN_ENV: 'preview',
        NODE_ENV: 'production',
      }).environmentName,
    ).toBe('preview');
    expect(parseServerRuntimeExtensionsEnv({}).environmentName).toBe(
      DEFAULT_ENVIRONMENT_NAME,
    );
  });

  test('treats blank strings as unset', () => {
    const parsed = parseServerRuntimeExtensionsEnv({
      MODERN_ENV: '   ',
      MODERN_CONTRACT_GATES_FILE: '',
      MODERN_TELEMETRY_OTLP_ENDPOINT: ' ',
    });

    expect(parsed.modernEnv).toBeUndefined();
    expect(parsed.contractGatesFile).toBeUndefined();
    expect(parsed.telemetryOtlpEndpoint).toBe(DEFAULT_TELEMETRY_OTLP_ENDPOINT);
    expect(parsed.environmentName).toBe(DEFAULT_ENVIRONMENT_NAME);
  });

  test.each([
    'not-a-number',
    '-100',
    '0',
    'NaN',
    'Infinity',
  ])('rejects invalid MF manifest timeout %p and keeps the default', value => {
    expect(
      parseServerRuntimeExtensionsEnv({
        MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS: value,
      }).mfRemoteManifestTimeoutMs,
    ).toBe(DEFAULT_MF_REMOTE_MANIFEST_TIMEOUT_MS);
  });

  test('floors fractional MF manifest timeouts', () => {
    expect(
      parseServerRuntimeExtensionsEnv({
        MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS: '1234.9',
      }).mfRemoteManifestTimeoutMs,
    ).toBe(1234);
  });

  test('reads from process.env by default', () => {
    const previous = process.env.MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS;
    process.env.MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS = '4321';
    try {
      expect(parseServerRuntimeExtensionsEnv().mfRemoteManifestTimeoutMs).toBe(
        4321,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS;
      } else {
        process.env.MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS = previous;
      }
    }
  });
});
