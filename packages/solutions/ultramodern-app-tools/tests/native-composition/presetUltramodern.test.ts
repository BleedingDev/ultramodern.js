import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPresetUltramodernConfig } from '@modern-js/ultramodern-app-tools';
import { rspack } from '@rsbuild/core';

describe('presetUltramodern config', () => {
  it('keeps React Router optional and uses the consumer copy before a nested DOM dependency', () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'modern-optional-router-')),
    );
    const configure = createPresetUltramodernConfig().tools!
      .bundlerChain as Function;
    const aliases = new Map<string, string>();
    const chain = {
      get: () => root,
      resolve: { alias: aliases },
      plugins: new Set(),
    };
    const run = () =>
      configure(chain, {
        isProd: true,
        CHAIN_ID: { PLUGIN: { TS_CHECKER: 'checker' } },
      });
    const install = (directory: string, name: string) => {
      const target = path.join(directory, 'node_modules', name);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(
        path.join(target, 'package.json'),
        JSON.stringify({ name }),
      );
      return target;
    };
    try {
      run();
      expect(aliases.size).toBe(0);
      const dom = install(root, 'react-router-dom');
      const nested = install(dom, 'react-router');
      run();
      expect(aliases.get('react-router$')).toBe(
        path.join(nested, 'dist/production/index.mjs'),
      );
      const direct = install(root, 'react-router');
      run();
      expect(aliases.get('react-router$')).toBe(
        path.join(direct, 'dist/production/index.mjs'),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
});
