import { createAppBaselineConfig, withAppBaseline } from '../src/baseline';

describe('app baseline config', () => {
  it('creates stable baseline defaults', () => {
    const baseline = createAppBaselineConfig();

    expect(baseline.output?.precompress).toBe(true);
    expect(baseline.performance?.rsdoctor).toEqual({
      enabled: false,
      disableClientServer: true,
    });
    expect(baseline.server?.telemetry).toEqual({
      enabled: true,
      failLoudStartup: true,
      exporters: {
        otlp: {
          enabled: true,
          endpoint: 'http://127.0.0.1:4318/v1/logs',
        },
        victoriaMetrics: {
          enabled: true,
          endpoint: 'http://127.0.0.1:8428/api/v1/import/prometheus',
        },
      },
    });
    expect(baseline.bff?.requestId).toBe('app');
    expect(
      baseline.server?.ssr &&
        typeof baseline.server.ssr === 'object' &&
        baseline.server.ssr.mode,
    ).toBe('stream');
    expect(
      baseline.server?.ssr &&
        typeof baseline.server.ssr === 'object' &&
        baseline.server.ssr.moduleFederationAppSSR,
    ).toBe(true);
  });

  it('adds optional bff requestId and mf ssr handshake', () => {
    const baseline = createAppBaselineConfig({
      appId: 'erp-shell',
      enableModuleFederationSSR: true,
    });

    expect(baseline.bff?.requestId).toBe('erp-shell');
    expect(
      baseline.server?.ssr &&
        typeof baseline.server.ssr === 'object' &&
        baseline.server.ssr.moduleFederationAppSSR,
    ).toBe(true);
  });

  it('supports opt-out for strict defaults', () => {
    const baseline = createAppBaselineConfig({
      enableBffRequestId: false,
      enableModuleFederationSSR: false,
      enableTelemetryExporters: false,
    });

    expect(baseline.bff).toBeUndefined();
    expect(baseline.server?.ssr).toBeUndefined();
    expect(baseline.server?.telemetry?.exporters).toBeUndefined();
  });

  it('allows app config overrides when composed', () => {
    const composed = withAppBaseline({
      output: {
        precompress: false,
      },
      server: {
        ssr: false,
        telemetry: {
          enabled: false,
        },
      },
      bff: {
        requestId: 'custom-app',
      },
    });

    expect(composed.output?.precompress).toBe(false);
    expect(composed.server?.telemetry?.enabled).toBe(false);
    expect(composed.server?.ssr).toBe(false);
    expect(composed.bff?.requestId).toBe('custom-app');
  });
});
