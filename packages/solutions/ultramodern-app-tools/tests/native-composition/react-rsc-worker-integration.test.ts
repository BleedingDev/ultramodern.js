import path from 'node:path';
import type {
  AppNormalizedConfig,
  AppTools,
  AppUserConfig,
} from '@modern-js/app-tools/cli-config';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { getRscPlugins } from '../../../../cli/builder/src/plugins/rscConfig';
import {
  createReactRscWorkerBuilderPlugin,
  createReactRscWorkerIntegrationPlugin,
  resolveReactWorkerRscOptions,
} from '../../src/native-composition/react-rsc-worker-integration';

function normalizedConfig(config: AppUserConfig): AppNormalizedConfig {
  return {
    resolve: {},
    server: {},
    source: {},
    output: {},
    experiments: {},
    bff: {},
    dev: {},
    deploy: {},
    html: {},
    tools: {},
    security: {},
    testing: {},
    builderPlugins: [],
    performance: {},
    environments: {},
    splitChunks: {},
    plugins: [],
    ...config,
    _raw: config,
  };
}

async function resolveCliConfig(config: AppNormalizedConfig) {
  const manager = createPluginManager<CLIPluginAPI<AppTools>>();
  manager.addPlugins([createReactRscWorkerIntegrationPlugin()]);
  const plugins = manager.getPlugins();
  const context = await createContext<AppTools>({
    appContext: initAppContext<AppTools>({
      packageName: 'react-worker-config-proof',
      configFile: false,
      command: 'build',
      appDirectory: __dirname,
      metaName: 'modern-js',
      plugins,
    }),
    config: config._raw,
    normalizedConfig: config,
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  context.pluginAPI = api;
  for (const plugin of plugins) await plugin.setup?.(api);
  return api.getHooks().modifyResolvedConfig.call(config);
}

describe('React worker integration in actual CLI hooks', () => {
  it('normalizes public server.rsc true and preserves server settings and existing plugins', async () => {
    const existing: RsbuildPlugin = { name: 'existing-plugin', setup() {} };
    const config = normalizedConfig({
      server: { rsc: true, ssr: true, port: 3010 },
      deploy: { target: 'cloudflare' },
      builderPlugins: [existing],
    });
    const resolved = await resolveCliConfig(config);
    expect(resolved.server).toEqual({
      rsc: {
        environments: {
          server: SERVICE_WORKER_ENVIRONMENT_NAME,
          client: 'client',
        },
      },
      ssr: true,
      port: 3010,
    });
    expect(resolved.builderPlugins).toHaveLength(2);
    expect(resolved.builderPlugins[0]).toBe(existing);
    expect(resolved.builderPlugins[1]).toMatchObject({
      name: 'ultramodern:react:rsc-worker',
    });
    expect(config.server.rsc).toBe(true);
    expect(config.builderPlugins).toEqual([existing]);
  });

  it.each([
    { server: { rsc: false }, deploy: { target: 'cloudflare' as const } },
    { server: {}, deploy: { target: 'cloudflare' as const } },
    { server: { rsc: true }, deploy: { target: 'node' as const } },
  ])('leaves disabled RSC and other deployment targets untouched', async config => {
    const normalized = normalizedConfig(config);
    expect(await resolveCliConfig(normalized)).toBe(normalized);
  });

  it('accepts a public native environment mapping and rejects conflicts before builder creation', async () => {
    const mapped: AppUserConfig = {
      server: {
        rsc: { environments: { server: SERVICE_WORKER_ENVIRONMENT_NAME } },
      },
      deploy: { target: 'cloudflare' },
    };
    expect(
      (await resolveCliConfig(normalizedConfig(mapped))).server.rsc,
    ).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    const conflicting: AppUserConfig = {
      server: { rsc: { environments: { server: 'server' } } },
      deploy: { target: 'cloudflare' },
    };
    await expect(
      resolveCliConfig(normalizedConfig(conflicting)),
    ).rejects.toThrow(
      `environments.server to be ${SERVICE_WORKER_ENVIRONMENT_NAME}`,
    );
  });
});

describe('Cloudflare React RSC options', () => {
  it('derives the existing native worker and client environments from true', () => {
    expect(resolveReactWorkerRscOptions(true)).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    expect(resolveReactWorkerRscOptions(false)).toBeUndefined();
    expect(resolveReactWorkerRscOptions(undefined)).toBeUndefined();
  });

  it('preserves supplied options and completes a valid partial mapping without mutation', () => {
    const options = Object.freeze({
      environments: Object.freeze({ server: SERVICE_WORKER_ENVIRONMENT_NAME }),
    });
    expect(resolveReactWorkerRscOptions(options)).toEqual({
      environments: {
        server: SERVICE_WORKER_ENVIRONMENT_NAME,
        client: 'client',
      },
    });
    expect(options.environments).toEqual({
      server: SERVICE_WORKER_ENVIRONMENT_NAME,
    });
  });

  it.each([
    { environments: { server: 'server' } },
    { environments: { server: '' } },
    { environments: { client: 'browser' } },
    { environments: { client: 1 } },
    { environments: { worker: 'workerSSR' } },
    { environments: null },
    { environments: [] },
    null,
    'true',
  ])('rejects conflicting or invalid native options %j', options => {
    expect(() => resolveReactWorkerRscOptions(options)).toThrow(TypeError);
  });

  it('rejects conflicting inherited native mappings as the native plugin reads them', () => {
    const environments = Object.create({ server: 'server' });
    expect(() => resolveReactWorkerRscOptions({ environments })).toThrow(
      `environments.server to be ${SERVICE_WORKER_ENVIRONMENT_NAME}`,
    );
  });
});

function rules(config: Rspack.Configuration) {
  return (config.module?.rules ?? []).filter(
    (rule): rule is Rspack.RuleSetRule =>
      typeof rule === 'object' && rule !== null,
  );
}

async function inspectNativeRsc(workerIntegration: boolean) {
  const options = resolveReactWorkerRscOptions(true);
  if (!options) throw new Error('Enabled RSC did not resolve its environments');
  const nativePlugins = await getRscPlugins(
    true,
    path.join(__dirname, 'internal'),
    options.environments,
  );
  const entry = path.join(__dirname, 'react-rsc-worker-integration.test.ts');
  const rsbuild = await createRsbuild({
    cwd: __dirname,
    rsbuildConfig: {
      mode: 'production',
      output: { cleanDistPath: false },
      tools: { htmlPlugin: false },
      environments: {
        client: {
          source: { entry: { main: entry } },
          output: { target: 'web' },
        },
        [SERVICE_WORKER_ENVIRONMENT_NAME]: {
          source: { entry: { main: entry } },
          output: { target: 'web', module: true },
        },
      },
      plugins: [
        ...nativePlugins,
        ...(workerIntegration ? [createReactRscWorkerBuilderPlugin()] : []),
      ],
    },
  });
  const configs = await rsbuild.initConfigs();
  return { configs, normalized: rsbuild.getNormalizedConfig() };
}

describe('actual native RSC configuration without compilation', () => {
  it('demonstrates the native RSC global default changes the worker target to node', async () => {
    const { normalized } = await inspectNativeRsc(false);
    expect(
      normalized.environments[SERVICE_WORKER_ENVIRONMENT_NAME]?.output.target,
    ).toBe('node');
  });

  it('restores only the worker target and ESM output while keeping native RSC plugins and layers', async () => {
    const { configs, normalized } = await inspectNativeRsc(true);
    expect(Object.keys(normalized.environments).sort()).toEqual(
      ['client', SERVICE_WORKER_ENVIRONMENT_NAME].sort(),
    );
    expect(
      normalized.environments[SERVICE_WORKER_ENVIRONMENT_NAME]?.output,
    ).toMatchObject({ target: 'web', module: true });
    expect(normalized.environments.client?.output).toMatchObject({
      target: 'web',
      module: false,
    });
    const worker = configs.find(
      config => config.name === SERVICE_WORKER_ENVIRONMENT_NAME,
    );
    const client = configs.find(config => config.name === 'client');
    if (!worker || !client)
      throw new Error('Native RSC environments are missing');
    expect(worker.target).not.toContain('node');
    expect(worker.output).toMatchObject({ module: true });
    expect(worker.entry).toMatchObject({
      main: { layer: rspack.experiments.rsc.Layers.ssr },
    });
    expect(
      worker.plugins?.some(
        plugin => plugin?.constructor.name === 'ServerPlugin',
      ),
    ).toBe(true);
    expect(
      client.plugins?.some(
        plugin => plugin?.constructor.name === 'ClientPlugin',
      ),
    ).toBe(true);
    expect(rules(worker)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layer: rspack.experiments.rsc.Layers.rsc }),
        expect.objectContaining({ layer: 'rsc-common' }),
      ]),
    );
    expect(worker.resolve?.alias).toMatchObject({
      '@modern-js/render/rsc$': '@modern-js/render/rsc-worker',
    });
    expect(
      rules(worker).some(rule =>
        Array.isArray(rule.use)
          ? rule.use.some(
              use =>
                typeof use === 'object' &&
                use !== null &&
                'loader' in use &&
                String(use.loader).includes('rsc-server-entry-loader'),
            )
          : false,
      ),
    ).toBe(true);
    expect(JSON.stringify(worker.entry)).not.toContain(
      '__MODERN_JS_ENTRY_NAME',
    );
    expect(JSON.stringify(client.entry)).toContain('__MODERN_JS_ENTRY_NAME');
  });
});
