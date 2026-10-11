import { describe, expect, test } from '@rstest/core';
import {
  applyPolicyDefaults,
  createPolicyDefaultsPlugin,
  POLICY_DEFAULTS_PLUGIN_NAME,
  type PolicyDefaultsComposition,
  type PolicyDefaultsOptions,
  RENDERER_EXTENSIONS_PACKAGE,
  SERVER_EXTENSIONS_PLUGIN_NAME,
  ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
} from '../src/policy-defaults';

type RuntimeDescriptor = { name?: string; path: string; config?: unknown };
type ServerDescriptor = { name: string };

const collect = (
  options?: PolicyDefaultsOptions,
  composition?: PolicyDefaultsComposition,
) => {
  const runtimeHooks: Array<
    (input: { entrypoint: unknown; plugins: RuntimeDescriptor[] }) => {
      plugins: RuntimeDescriptor[];
    }
  > = [];
  const serverHooks: Array<
    (input: { plugins: ServerDescriptor[] }) => { plugins: ServerDescriptor[] }
  > = [];
  const configHooks: Array<(config: any) => any> = [];

  applyPolicyDefaults(
    {
      _internalRuntimePlugins: (fn: any) => runtimeHooks.push(fn),
      _internalServerPlugins: (fn: any) => serverHooks.push(fn),
      modifyResolvedConfig: (fn: any) => configHooks.push(fn),
    } as any,
    options,
    composition,
  );

  const runRuntime = (plugins: RuntimeDescriptor[] = []) =>
    runtimeHooks.reduce(
      (acc, hook) =>
        hook({ entrypoint: { entryName: 'main' }, plugins: acc }).plugins,
      plugins,
    );
  const runServer = (plugins: ServerDescriptor[] = []) =>
    serverHooks.reduce((acc, hook) => hook({ plugins: acc }).plugins, plugins);
  const runConfig = (config: any = {}) =>
    configHooks.reduce((acc, hook) => hook(acc), config);

  return { runRuntime, runServer, runConfig, configHooks };
};

describe('fork policy defaults', () => {
  test('a plain appTools app gets the fork renderer policy', () => {
    const plugins = collect().runRuntime();

    expect(plugins).toEqual([
      {
        name: 'rendererHead',
        path: RENDERER_EXTENSIONS_PACKAGE,
        config: {},
      },
    ]);
  });

  test('a plain appTools app gets the fork server policy', () => {
    expect(collect().runServer()).toEqual([
      { name: SERVER_EXTENSIONS_PLUGIN_NAME },
    ]);
  });

  test('an explicit composition is never registered twice', () => {
    const existing = {
      name: 'rendererHead',
      path: RENDERER_EXTENSIONS_PACKAGE,
      config: {},
    };
    expect(collect().runRuntime([existing])).toEqual([existing]);
    expect(
      collect().runServer([{ name: SERVER_EXTENSIONS_PLUGIN_NAME }]),
    ).toEqual([{ name: SERVER_EXTENSIONS_PLUGIN_NAME }]);
  });

  test('consumer descriptors are preserved', () => {
    const consumer = { name: 'consumer', path: './consumer', config: {} };
    expect(collect().runRuntime([consumer])[0]).toBe(consumer);
  });

  test('explicit composition selects its own CLI and server plugin identities', () => {
    const composition = {
      pluginName: '@modern-js/ultramodern-app-tools/policy-defaults',
      serverPluginName: ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
    };
    expect(createPolicyDefaultsPlugin().name).toBe(POLICY_DEFAULTS_PLUGIN_NAME);
    expect(createPolicyDefaultsPlugin({}, composition).name).toBe(
      composition.pluginName,
    );
    expect(collect({}, composition).runServer()).toEqual([
      { name: composition.serverPluginName },
    ]);
  });

  test.each([
    SERVER_EXTENSIONS_PLUGIN_NAME,
    ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
  ])('explicit composition preserves an existing server policy at %s', name => {
    const descriptor = { name, options: { consumer: true } };
    const plugins = collect(
      {},
      {
        serverPluginName: ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
      },
    ).runServer([descriptor]);
    expect(plugins).toEqual([descriptor]);
    expect(plugins[0]).toBe(descriptor);
    expect(descriptor).toEqual({ name, options: { consumer: true } });
  });

  test('plain appTools preserves an explicitly composed UltraModern server policy', () => {
    const descriptor = {
      name: ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
      options: { consumer: true },
    };
    const plugins = collect().runServer([descriptor]);
    expect(plugins).toEqual([descriptor]);
    expect(plugins[0]).toBe(descriptor);
  });

  test('each policy can be opted out of explicitly', () => {
    expect(collect({ rendererExtensions: false }).runRuntime()).toEqual([]);
    expect(collect({ serverExtensions: false }).runServer()).toEqual([]);
  });

  test('the renderer package resolves from app-tools, not from the app', () => {
    // The generated `runtime-register.js` lives in the app, which does not
    // declare the renderer package. A fallback module directory keeps the
    // bare specifier resolvable under an isolated linker.
    const { runConfig, configHooks } = collect();
    expect(configHooks.length).toBe(1);

    const config = runConfig({ builderPlugins: [] });
    expect(config.builderPlugins).toHaveLength(1);
    expect(config.builderPlugins[0].name).toBe(
      'ultramodern:runtime-package-resolution',
    );
  });

  test('opting out of the renderer also drops the resolution fallback', () => {
    expect(collect({ rendererExtensions: false }).configHooks).toHaveLength(0);
  });

  test('additional resolution packages cannot override the renderer opt out', () => {
    const composition = { runtimePackages: [RENDERER_EXTENSIONS_PACKAGE] };
    const { runRuntime, configHooks } = collect(
      { rendererExtensions: false },
      composition,
    );
    expect(runRuntime()).toEqual([]);
    expect(configHooks).toHaveLength(0);
  });
});
