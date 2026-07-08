import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPresetUltramodernConfig,
  presetUltramodern,
} from '../src/presetUltramodern';

type BundlerChainFn = (chain: unknown, utils: { isProd: boolean }) => void;

const getBundlerChain = (
  config: ReturnType<typeof createPresetUltramodernConfig>,
) => config.tools?.bundlerChain as BundlerChainFn;

const createFakeChain = (context?: string) => {
  const aliases = new Map<string, string>();

  return {
    aliases,
    chain: {
      get: (key: string) => (key === 'context' ? context : undefined),
      resolve: {
        alias: {
          set: (name: string, value: string) => {
            aliases.set(name, value);
          },
        },
      },
    },
  };
};

const createReactRouterFixture = ({
  viaReactRouterDom = false,
}: {
  viaReactRouterDom?: boolean;
} = {}) => {
  // realpath: require.resolve returns resolved symlinks (/var vs /private/var
  // on macOS).
  const appDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'modern-preset-react-router-')),
  );
  const reactRouterRoot = viaReactRouterDom
    ? path.join(appDirectory, 'node_modules/react-router-dom/node_modules')
    : path.join(appDirectory, 'node_modules');
  const reactRouterDir = path.join(reactRouterRoot, 'react-router');

  fs.mkdirSync(reactRouterDir, { recursive: true });
  fs.writeFileSync(
    path.join(reactRouterDir, 'package.json'),
    JSON.stringify({ name: 'react-router', version: '0.0.0' }),
  );

  if (viaReactRouterDom) {
    const reactRouterDomDir = path.join(
      appDirectory,
      'node_modules/react-router-dom',
    );
    fs.mkdirSync(reactRouterDomDir, { recursive: true });
    fs.writeFileSync(
      path.join(reactRouterDomDir, 'package.json'),
      JSON.stringify({
        name: 'react-router-dom',
        version: '0.0.0',
        dependencies: { 'react-router': '0.0.0' },
      }),
    );
  }

  return { appDirectory, reactRouterDir };
};

describe('presetUltramodern config', () => {
  it('creates stable preset defaults that boot without local collectors', () => {
    const preset = createPresetUltramodernConfig();

    expect(preset.output?.precompress).toBe(true);
    // RsDoctor stays opt-in per the reverted ADR-0001; the preset must not
    // force-enable it for production builds.
    expect(preset.performance?.rsdoctor).toBeUndefined();
    // Telemetry contract on, but no exporters unless endpoints are
    // configured, so fail-loud startup probes have nothing to fail on.
    expect(preset.server?.telemetry).toEqual({
      enabled: true,
      failLoudStartup: true,
    });
    expect(preset.bff?.requestId).toBe('app');
    expect(
      preset.server?.ssr &&
        typeof preset.server.ssr === 'object' &&
        preset.server.ssr.mode,
    ).toBe('stream');
    expect(
      preset.server?.ssr &&
        typeof preset.server.ssr === 'object' &&
        preset.server.ssr.moduleFederationAppSSR,
    ).toBe(true);
  });

  it('does not enable rsdoctor even for production builds', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(
        createPresetUltramodernConfig().performance?.rsdoctor,
      ).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('enables only explicitly configured telemetry exporters', () => {
    const otlpOnly = createPresetUltramodernConfig({
      otlpEndpoint: 'http://collector.internal:4318/v1/logs',
    });

    expect(otlpOnly.server?.telemetry?.exporters).toEqual({
      otlp: {
        enabled: true,
        endpoint: 'http://collector.internal:4318/v1/logs',
      },
    });

    const victoriaOnly = createPresetUltramodernConfig({
      victoriaMetricsEndpoint:
        'http://metrics.internal:8428/api/v1/import/prometheus',
    });

    expect(victoriaOnly.server?.telemetry?.exporters).toEqual({
      victoriaMetrics: {
        enabled: true,
        endpoint: 'http://metrics.internal:8428/api/v1/import/prometheus',
      },
    });
  });

  it('enables exporters from telemetry endpoint environment variables', () => {
    const previous = process.env.MODERN_TELEMETRY_OTLP_ENDPOINT;
    process.env.MODERN_TELEMETRY_OTLP_ENDPOINT =
      'http://env-collector.internal:4318/v1/logs';
    try {
      const preset = createPresetUltramodernConfig();

      expect(preset.server?.telemetry?.exporters).toEqual({
        otlp: {
          enabled: true,
          endpoint: 'http://env-collector.internal:4318/v1/logs',
        },
      });
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.MODERN_TELEMETRY_OTLP_ENDPOINT;
      } else {
        process.env.MODERN_TELEMETRY_OTLP_ENDPOINT = previous;
      }
    }
  });

  it('forces both exporters on default endpoints with enableTelemetryExporters', () => {
    const preset = createPresetUltramodernConfig({
      enableTelemetryExporters: true,
    });

    expect(preset.server?.telemetry).toEqual({
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
  });

  it('disables exporters even with endpoints when exporters are opted out', () => {
    const preset = createPresetUltramodernConfig({
      enableTelemetryExporters: false,
      otlpEndpoint: 'http://collector.internal:4318/v1/logs',
    });

    expect(preset.server?.telemetry?.exporters).toBeUndefined();
  });

  it('adds optional bff requestId and mf ssr handshake', () => {
    const preset = createPresetUltramodernConfig({
      appId: 'erp-shell',
      enableModuleFederationSSR: true,
    });

    expect(preset.bff?.requestId).toBe('erp-shell');
    expect(
      preset.server?.ssr &&
        typeof preset.server.ssr === 'object' &&
        preset.server.ssr.moduleFederationAppSSR,
    ).toBe(true);
  });

  it('supports opt-out for strict defaults', () => {
    const preset = createPresetUltramodernConfig({
      enableBffRequestId: false,
      enableModuleFederationSSR: false,
      enableTelemetryExporters: false,
    });

    expect(preset.bff).toBeUndefined();
    expect(preset.server?.ssr).toBeUndefined();
    expect(preset.server?.telemetry?.exporters).toBeUndefined();
  });

  it('allows app config overrides when composed', () => {
    const composed = presetUltramodern({
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

describe('presetUltramodern react-router bridge aliases', () => {
  it('resolves react-router from the bundler context and picks the build by mode', () => {
    const { appDirectory, reactRouterDir } = createReactRouterFixture();
    try {
      const bundlerChain = getBundlerChain(createPresetUltramodernConfig());

      const dev = createFakeChain(appDirectory);
      bundlerChain(dev.chain, { isProd: false });
      expect(dev.aliases.get('react-router$')).toBe(
        path.join(reactRouterDir, 'dist/development/index.mjs'),
      );
      expect(dev.aliases.get('react-router/dist/production/index.js')).toBe(
        path.join(reactRouterDir, 'dist/production/index.mjs'),
      );
      expect(dev.aliases.get('react-router/dist/development/index.js')).toBe(
        path.join(reactRouterDir, 'dist/development/index.mjs'),
      );

      const prod = createFakeChain(appDirectory);
      bundlerChain(prod.chain, { isProd: true });
      expect(prod.aliases.get('react-router$')).toBe(
        path.join(reactRouterDir, 'dist/production/index.mjs'),
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('keeps resolving react-router through v7 react-router-dom apps', () => {
    const { appDirectory, reactRouterDir } = createReactRouterFixture({
      viaReactRouterDom: true,
    });
    try {
      const bundlerChain = getBundlerChain(createPresetUltramodernConfig());

      const dev = createFakeChain(appDirectory);
      bundlerChain(dev.chain, { isProd: false });

      expect(dev.aliases.get('react-router$')).toBe(
        path.join(reactRouterDir, 'dist/development/index.mjs'),
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('falls back to process.cwd() when the chain has no context', () => {
    const previousCwd = process.cwd();
    const { appDirectory } = createReactRouterFixture();
    try {
      process.chdir(appDirectory);
      const bundlerChain = getBundlerChain(createPresetUltramodernConfig());
      const { chain, aliases } = createFakeChain(undefined);

      bundlerChain(chain, { isProd: true });

      const alias = aliases.get('react-router$');
      expect(alias).toBeDefined();
      expect(alias).toContain(`${path.sep}react-router${path.sep}`);
      expect(alias?.endsWith(path.join('dist/production/index.mjs'))).toBe(
        true,
      );
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
