import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUltramodernReleaseBuildMarker } from '@modern-js/app-tools-extensions/release-identity';
import { createBuilder } from '@modern-js/builder';
import { mergeConfig } from '@modern-js/plugin/cli';
import { rspack } from '@rsbuild/core';
import {
  createPresetUltramodernConfig,
  presetUltramodern,
} from '../src/presetUltramodern';
import type { AppUserConfig } from '../src/types';

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
    expect(preset.source?.reactCompiler).toBe(true);
    expect(preset.tools?.lightningcssLoader).toBe(true);
    // RsDoctor stays opt-in per the reverted ADR-0001; the preset must not
    // force-enable it for production builds.
    expect(preset.performance?.rsdoctor).toBeUndefined();
    // Telemetry contract on, but no exporters unless endpoints are
    // configured, so fail-loud startup probes have nothing to fail on.
    expect(preset.server?.telemetry).toEqual({
      enabled: true,
      failLoudStartup: false,
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

  it('evaluates telemetry endpoint environment variables for every call', () => {
    const previousOtlp = process.env.MODERN_TELEMETRY_OTLP_ENDPOINT;
    const previousVictoria = process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT;
    delete process.env.MODERN_TELEMETRY_OTLP_ENDPOINT;
    delete process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT;

    try {
      const beforeEndpoint = createPresetUltramodernConfig();
      process.env.MODERN_TELEMETRY_OTLP_ENDPOINT =
        'http://env-collector.internal:4318/v1/logs';
      const afterEndpoint = createPresetUltramodernConfig();

      expect(beforeEndpoint.server?.telemetry?.exporters).toBeUndefined();
      expect(afterEndpoint.server?.telemetry?.exporters).toEqual({
        otlp: {
          enabled: true,
          endpoint: 'http://env-collector.internal:4318/v1/logs',
        },
      });
    } finally {
      if (typeof previousOtlp === 'undefined') {
        delete process.env.MODERN_TELEMETRY_OTLP_ENDPOINT;
      } else {
        process.env.MODERN_TELEMETRY_OTLP_ENDPOINT = previousOtlp;
      }
      if (typeof previousVictoria === 'undefined') {
        delete process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT;
      } else {
        process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT = previousVictoria;
      }
    }
  });

  it('forces both exporters on default endpoints with enableTelemetryExporters', () => {
    const preset = createPresetUltramodernConfig({
      enableTelemetryExporters: true,
    });

    expect(preset.server?.telemetry).toEqual({
      enabled: true,
      failLoudStartup: false,
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

  it('injects one source-derived delivery-unit identity into every build target', () => {
    const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
    const previousCwd = process.cwd();
    const workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'modern-preset-identity-')),
    );
    const sourceRevision = 'a'.repeat(40);
    process.env.ULTRAMODERN_SOURCE_REVISION = sourceRevision;
    try {
      process.chdir(workspaceRoot);
      const preset = createPresetUltramodernConfig({
        deliveryUnit: {
          buildMarker: '0123456789abcdef',
          unitId: 'acme/catalog',
          version: '1.2.3',
        },
      });
      const buildMarker = createUltramodernReleaseBuildMarker({
        generationBuildMarker: '0123456789abcdef',
        sourceRevision,
        unitId: 'acme/catalog',
      });

      expect(preset.source?.globalVars).toEqual({
        ULTRAMODERN_BUILD_MARKER: buildMarker,
        ULTRAMODERN_RELEASE_VERSION: '1.2.3',
        ULTRAMODERN_SOURCE_REVISION: sourceRevision,
      });

      const rspackConfig = { plugins: [] };
      const configuredRspack = preset.tools?.rspack as (
        config: typeof rspackConfig,
      ) => typeof rspackConfig;
      configuredRspack(rspackConfig);
      expect(rspackConfig.plugins).toHaveLength(1);

      const bannerPlugin = rspackConfig.plugins[0] as unknown as {
        _args: [
          {
            banner: string;
            raw: boolean;
            stage: number;
            test: RegExp;
          },
        ];
      };
      expect(bannerPlugin._args[0]).toMatchObject({
        banner: `void ${JSON.stringify(buildMarker)};void ${JSON.stringify(sourceRevision)};void "1.2.3";`,
        raw: true,
        stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
      });
      expect(bannerPlugin._args[0].test.test('client.js')).toBe(true);
      expect(bannerPlugin._args[0].test.test('server.mjs')).toBe(true);
      expect(bannerPlugin._args[0].test.test('backend.cjs')).toBe(true);
      expect(bannerPlugin._args[0].test.test('styles.css')).toBe(false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.ULTRAMODERN_SOURCE_REVISION;
      } else {
        process.env.ULTRAMODERN_SOURCE_REVISION = previous;
      }
    }
  });

  it('stamps minimized browser bytes before content hashes are finalized', async () => {
    const previous = process.env.ULTRAMODERN_SOURCE_REVISION;
    const previousCwd = process.cwd();
    const workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'modern-preset-rspack-banner-')),
    );
    const sourceRevision = 'b'.repeat(40);
    const entry = path.join(workspaceRoot, 'entry.js');
    fs.writeFileSync(entry, 'globalThis.ultramodernClientLoaded = true;\n');
    process.env.ULTRAMODERN_SOURCE_REVISION = sourceRevision;

    try {
      process.chdir(workspaceRoot);
      const outputs: Array<{ filename: string }> = [];
      for (const [index, generationBuildMarker] of [
        '1111111111111111',
        '2222222222222222',
      ].entries()) {
        const outputPath = path.join(workspaceRoot, `dist-${index}`);
        const preset = createPresetUltramodernConfig({
          deliveryUnit: {
            buildMarker: generationBuildMarker,
            unitId: 'acme/catalog',
            version: '1.2.3',
          },
        });
        const rspackConfig = {
          plugins: [],
        };
        const configureRspack = preset.tools?.rspack as (
          config: typeof rspackConfig,
        ) => typeof rspackConfig;
        configureRspack(rspackConfig);

        await new Promise<void>((resolve, reject) => {
          rspack.rspack(
            {
              entry,
              mode: 'production',
              optimization: {
                minimize: true,
              },
              output: {
                clean: true,
                filename: '[contenthash].js',
                path: outputPath,
              },
              plugins: rspackConfig.plugins,
            },
            (error, stats) => {
              if (error) {
                reject(error);
              } else if (!stats || stats.hasErrors()) {
                reject(
                  new Error(
                    stats?.toString({ all: false, errors: true }) ??
                      'Rspack returned no build stats.',
                  ),
                );
              } else {
                resolve();
              }
            },
          );
        });

        const filename = fs
          .readdirSync(outputPath)
          .find(candidate => candidate.endsWith('.js'));
        expect(filename).toBeDefined();
        delete (globalThis as Record<string, unknown>).ultramodernClientLoaded;
        require(path.join(outputPath, filename!));
        expect(
          (globalThis as Record<string, unknown>).ultramodernClientLoaded,
        ).toBe(true);
        outputs.push({ filename: filename! });
      }

      expect(outputs[0].filename).not.toBe(outputs[1].filename);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      if (previous === undefined) {
        delete process.env.ULTRAMODERN_SOURCE_REVISION;
      } else {
        process.env.ULTRAMODERN_SOURCE_REVISION = previous;
      }
    }
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
    expect(composed.server?.telemetry?.failLoudStartup).toBe(false);
    expect(composed.server?.ssr).toBe(false);
    expect(composed.bff?.requestId).toBe('custom-app');
  });

  it('keeps defaults for omitted and undefined values but honors false', () => {
    const omitted = presetUltramodern({});
    const undefinedOverride = presetUltramodern({
      output: { precompress: undefined },
      source: { reactCompiler: undefined },
      tools: { lightningcssLoader: undefined },
    });
    const falseOverride = presetUltramodern({
      output: { precompress: false },
      source: { reactCompiler: false },
      tools: { lightningcssLoader: false },
    });

    expect(omitted.output?.precompress).toBe(true);
    expect(omitted.source?.reactCompiler).toBe(true);
    expect(omitted.tools?.lightningcssLoader).toBe(true);
    expect(undefinedOverride.output?.precompress).toBe(true);
    expect(undefinedOverride.source?.reactCompiler).toBe(true);
    expect(undefinedOverride.tools?.lightningcssLoader).toBe(true);
    expect(falseOverride.output?.precompress).toBe(false);
    expect(falseOverride.source?.reactCompiler).toBe(false);
    expect(falseOverride.tools?.lightningcssLoader).toBe(false);
  });

  it('selects native CSS processing without weakening build defaults', async () => {
    const config = presetUltramodern({
      output: {
        splitRouteChunks: true,
      },
      tools: {
        autoprefixer: {
          overrideBrowserslist: ['defaults'],
        },
      },
    });
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        source: config.source,
        tools: config.tools,
      },
      cwd: path.join(__dirname, '..'),
    });
    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();
    const bundlerConfig = bundlerConfigs[0];
    const moduleRules = JSON.stringify(bundlerConfig.module?.rules);
    expect(config.output?.splitRouteChunks).toBe(true);
    expect(bundlerConfig.optimization?.splitChunks).toBeTruthy();
    expect(moduleRules).toContain('"loader":"builtin:lightningcss-loader"');
    expect(moduleRules).not.toContain('postcss-loader');
    expect(moduleRules).toContain('"reactCompiler":true');
  });

  it('keeps preset values when consumers provide empty objects or arrays', () => {
    type Config = {
      nested?: { enabled?: boolean };
      entries?: string[];
    };

    const merged = mergeConfig<Config, Config>([
      { nested: { enabled: true }, entries: ['preset'] },
      { nested: {}, entries: [] },
    ]);

    expect(merged).toEqual({
      nested: { enabled: true },
      entries: ['preset'],
    });
  });

  it('merges arrays preset-first with deep dedupe and function retention', () => {
    const sharedHook = () => undefined;
    type Config = {
      entries?: Array<{ name: string } | (() => undefined)>;
    };

    const merged = mergeConfig<Config, Config>([
      {
        entries: [{ name: 'shared' }, { name: 'preset' }, sharedHook],
      },
      {
        entries: [{ name: 'shared' }, { name: 'consumer' }, sharedHook],
      },
    ]);

    expect(merged.entries).toEqual([
      { name: 'shared' },
      { name: 'preset' },
      sharedHook,
      { name: 'consumer' },
      sharedHook,
    ]);
  });

  it('composes hooks in preset-before-consumer order', () => {
    const calls: string[] = [];
    const presetHook = () => calls.push('preset');
    const consumerHook = () => calls.push('consumer');
    type Config = {
      hook?: (() => number) | Array<() => number>;
    };

    const merged = mergeConfig<Config, Config>([
      { hook: presetHook },
      { hook: consumerHook },
    ]);
    const hooks = Array.isArray(merged.hook) ? merged.hook : [merged.hook!];
    hooks.forEach(hook => hook());

    expect(calls).toEqual(['preset', 'consumer']);
  });

  it('replaces removeConsole and baseUrl as whole values', () => {
    const merged = mergeConfig<AppUserConfig, AppUserConfig>([
      {
        source: { removeConsole: ['log', 'warn'] },
        server: { baseUrl: ['/preset', '/shared'] },
      },
      {
        source: { removeConsole: ['error'] },
        server: { baseUrl: ['/consumer'] },
      },
    ]);

    expect(merged.source?.removeConsole).toEqual(['error']);
    expect(merged.server?.baseUrl).toEqual(['/consumer']);
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
