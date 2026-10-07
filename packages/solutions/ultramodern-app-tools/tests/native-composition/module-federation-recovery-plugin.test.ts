import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import type { CLIPluginAPI } from '@modern-js/plugin';
import {
  createRsbuild,
  type RsbuildPlugin,
  type RspackChain,
} from '@rsbuild/core';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  resolveManifestRecoveryRuntimePlugin,
  ultramodernModuleFederationRecoveryPlugin,
} from '../../src/renderers/react/module-federation-recovery-plugin';

type ChainModifier = Parameters<
  CLIPluginAPI<AppTools>['modifyBundlerChain']
>[0];
type RuntimePlugin = string | [string, Record<string, unknown>];
type FederationConfig = {
  name: string;
  filename: string;
  remotes: Record<string, string>;
  exposes: Record<string, string>;
  runtimePlugins: RuntimePlugin[];
  shared: Record<string, unknown>;
};
type NativeSSRModule = {
  CHAIN_MF_PLUGIN_ID: string;
  moduleFederationSSRPlugin: (options: {
    userConfig: { ssr: boolean };
    secondarySharedTreeShaking: boolean;
    csrConfig: FederationConfig;
    ssrConfig: FederationConfig;
    assetFileNames: Record<string, unknown>;
    assetResources: Record<string, unknown>;
  }) => CliPlugin<AppTools>;
};

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const nativeAppDirectory = path.join(
  repositoryRoot,
  'tests/integration/routes-tanstack-mf/mf-remote',
);
const applicationRequire = createRequire(
  path.join(nativeAppDirectory, 'package.json'),
);
const nativeSSRFile = applicationRequire.resolve(
  '@module-federation/modern-js-v3/ssr-plugin',
);
const nativeRequire = createRequire(nativeSSRFile);
const nativeSSR = nativeRequire(nativeSSRFile) as NativeSSRModule;
const nativeConstructors = nativeRequire('@module-federation/enhanced/rspack');
const nativeNodeManifest = nativeRequire(
  '@module-federation/node/package.json',
);
const nativeNodeDirectory = path.dirname(
  nativeRequire.resolve('@module-federation/node/package.json'),
);
const nativeRuntimePaths = {
  require: nativeRequire.resolve('@module-federation/node/runtimePlugin'),
  import: nativeRequire.resolve(
    path.join(
      nativeNodeDirectory,
      nativeNodeManifest.exports['./runtimePlugin'].import.default,
    ),
  ),
};
const ownedRoots: string[] = [];
const priorSSREnvironment = process.env.MF_SSR_PRJ;

afterEach(() => {
  for (const root of ownedRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  if (priorSSREnvironment === undefined) delete process.env.MF_SSR_PRJ;
  else process.env.MF_SSR_PRJ = priorSSREnvironment;
});

function owningSourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mf-recovery-'));
  ownedRoots.push(root);
  const appDirectory = path.join(root, 'app');
  const ownerDirectory = path.join(root, 'owner');
  fs.mkdirSync(appDirectory, { recursive: true });
  fs.mkdirSync(path.join(ownerDirectory, 'node_modules/@modern-js'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'isolated-mf-app',
      dependencies: { '@fixture/ultramodern-app-tools': '1.0.0' },
    }),
  );
  fs.writeFileSync(
    path.join(ownerDirectory, 'package.json'),
    JSON.stringify({
      name: '@fixture/ultramodern-app-tools',
      type: 'module',
      dependencies: { '@modern-js/federation-runtime': 'workspace:*' },
    }),
  );
  fs.symlinkSync(
    path.join(repositoryRoot, 'packages/runtime/federation-runtime'),
    path.join(ownerDirectory, 'node_modules/@modern-js/federation-runtime'),
    'dir',
  );
  fs.mkdirSync(path.join(appDirectory, 'node_modules/@fixture'), {
    recursive: true,
  });
  fs.symlinkSync(
    ownerDirectory,
    path.join(appDirectory, 'node_modules/@fixture/ultramodern-app-tools'),
    'dir',
  );
  // Execute the unchanged owning source in a genuine isolated dependency context.
  // Native Node strips its types; this fixture never substitutes a runtime plugin.
  const sourceFile = path.join(
    ownerDirectory,
    'module-federation-recovery-plugin.ts',
  );
  fs.copyFileSync(
    path.resolve(
      __dirname,
      '../../src/renderers/react/module-federation-recovery-plugin.ts',
    ),
    sourceFile,
  );
  const ownerRequire = createRequire(path.join(ownerDirectory, 'package.json'));
  const source = ownerRequire(sourceFile) as {
    ultramodernModuleFederationRecoveryPlugin: typeof ultramodernModuleFederationRecoveryPlugin;
    resolveManifestRecoveryRuntimePlugin: typeof resolveManifestRecoveryRuntimePlugin;
  };
  return {
    root,
    appDirectory,
    ownerDirectory,
    sourceFile,
    source,
    ownerRequire,
  };
}

async function captureRecoveryModifier(
  factory: typeof ultramodernModuleFederationRecoveryPlugin,
  appDirectory: string,
) {
  let modifier: ChainModifier | undefined;
  await factory().setup?.({
    modifyBundlerChain: (callback: ChainModifier) => {
      modifier = callback;
    },
    getAppContext: () => ({ appDirectory }),
  } as unknown as CLIPluginAPI<AppTools>);
  if (!modifier)
    throw new Error('Recovery bundler-chain hook was not registered');
  return modifier;
}

async function captureNativeModifier(
  ssrConfig: FederationConfig,
  secondarySharedTreeShaking: boolean,
) {
  let modifier: ChainModifier | undefined;
  const plugin = nativeSSR.moduleFederationSSRPlugin({
    userConfig: { ssr: true },
    secondarySharedTreeShaking,
    csrConfig: { ...ssrConfig, name: 'fixture-browser' },
    ssrConfig,
    assetFileNames: {},
    assetResources: {},
  });
  await plugin.setup?.({
    getConfig: () => ({ server: { ssr: true } }),
    modifyBundlerChain: (callback: ChainModifier) => {
      modifier = callback;
    },
    _internalRuntimePlugins: rstest.fn(),
    _internalServerPlugins: rstest.fn(),
    config: rstest.fn(),
    onAfterBuild: rstest.fn(),
    onDevCompileDone: rstest.fn(),
  } as unknown as CLIPluginAPI<AppTools>);
  if (!modifier)
    throw new Error('Native SSR bundler-chain hook was not registered');
  return modifier;
}

async function configureActualChain(
  root: string,
  target: 'node' | 'web',
  modifiers: readonly ChainModifier[],
) {
  let observed: RspackChain | undefined;
  const bridge: RsbuildPlugin = {
    name: 'test:actual-native-mf-chain',
    setup(api) {
      api.modifyBundlerChain(async (chain, utils) => {
        for (const modifier of modifiers) await modifier(chain, utils as never);
        observed = chain;
      });
    },
  };
  const entry = path.join(root, 'entry.js');
  fs.writeFileSync(entry, 'export const fixture = true;');
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      mode: 'production',
      source: { entry: { main: entry } },
      output: { target, distPath: { root: path.join(root, 'output') } },
      html: { htmlPlugin: false },
      plugins: [bridge],
    },
  });
  const configs = await rsbuild.initConfigs();
  if (!observed)
    throw new Error('Rsbuild did not supply its native Rspack chain');
  return { chain: observed, configs };
}

function federationConfig(runtimePlugins: RuntimePlugin[]): FederationConfig {
  return {
    name: 'fixture-server',
    filename: 'remoteEntry.js',
    remotes: {},
    exposes: {},
    shared: {},
    runtimePlugins,
  };
}

describe('fork recovery at the actual native MF server boundary', () => {
  it('resolves and loads the real emitted runtime from its isolated owner while the app has no direct dependency', () => {
    const fixture = owningSourceFixture();
    const environment = { ...process.env };
    delete environment.NODE_PATH;
    const receipt = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `
      const { createRequire } = require('node:module');
      const { pathToFileURL } = require('node:url');
      const applicationRequire = createRequire(process.argv[1]);
      const ownerRequire = createRequire(process.argv[2]);
      const source = ownerRequire(process.argv[2]);
      let applicationResolution;
      try {
        applicationRequire.resolve('@modern-js/federation-runtime/manifest-recovery-runtime-plugin');
        applicationResolution = 'unexpected-success';
      } catch (error) {
        applicationResolution = error.code;
      }
      const recovery = source.resolveManifestRecoveryRuntimePlugin(pathToFileURL(process.argv[2]).href);
      const runtime = ownerRequire(recovery).default();
      process.stdout.write(JSON.stringify({ applicationResolution, recovery, pluginName: runtime.name }));
    `,
          path.join(fixture.appDirectory, 'package.json'),
          fixture.sourceFile,
        ],
        {
          cwd: fixture.appDirectory,
          env: environment,
          encoding: 'utf8',
        },
      ),
    );
    expect(receipt.applicationResolution).toBe('MODULE_NOT_FOUND');
    const actual = resolveManifestRecoveryRuntimePlugin(
      pathToFileURL(fixture.sourceFile).href,
    );
    expect(actual).toBe(
      fixture.ownerRequire.resolve(
        '@modern-js/federation-runtime/manifest-recovery-runtime-plugin',
      ),
    );
    expect(path.isAbsolute(actual)).toBe(true);
    expect(receipt.recovery).toBe(actual);
    expect(receipt.pluginName).toBe('modern-js-manifest-recovery-plugin');
    const runtime = fixture.ownerRequire(actual);
    const plugin = runtime.default();
    expect(plugin.name).toBe('modern-js-manifest-recovery-plugin');
    expect(plugin.errorLoadRemote).toBeTypeOf('function');
  });

  it.each([
    { secondary: false, format: 'require' as const },
    { secondary: false, format: 'import' as const },
    { secondary: true, format: 'require' as const },
    { secondary: true, format: 'import' as const },
  ])(
    'preserves actual native options and inserts recovery before the $format node runtime with secondary=$secondary',
    async ({ secondary, format }) => {
      const fixture = owningSourceFixture();
      const recovery = fixture.source.resolveManifestRecoveryRuntimePlugin(
        pathToFileURL(fixture.sourceFile).href,
      );
      const userPlugin: RuntimePlugin = [
        '/consumer/runtime-plugin.js',
        { retries: 7 },
      ];
      const runtimePlugins: RuntimePlugin[] = [
        userPlugin,
        '/native/shared-strategy.js',
        nativeRuntimePaths[format],
        '/native/fetch-runtime.js',
      ];
      const ssrConfig = federationConfig(runtimePlugins);
      const native = await captureNativeModifier(ssrConfig, secondary);
      const repair = await captureRecoveryModifier(
        fixture.source.ultramodernModuleFederationRecoveryPlugin,
        nativeAppDirectory,
      );
      const { chain, configs } = await configureActualChain(
        fixture.root,
        'node',
        [native, repair],
      );
      const nativePlugin = chain.plugin(nativeSSR.CHAIN_MF_PLUGIN_ID);
      expect(nativePlugin.get('plugin')).toBe(
        secondary
          ? nativeConstructors.TreeShakingSharedPlugin
          : nativeConstructors.ModuleFederationPlugin,
      );
      const args = nativePlugin.get('args');
      expect(secondary ? args[0].mfConfig : args[0]).toBe(ssrConfig);
      if (secondary) expect(args[0].secondary).toBe(true);
      expect(ssrConfig.runtimePlugins).toEqual([
        userPlugin,
        '/native/shared-strategy.js',
        recovery,
        nativeRuntimePaths[format],
        '/native/fetch-runtime.js',
      ]);
      expect(ssrConfig.runtimePlugins[0]).toBe(userPlugin);
      expect(runtimePlugins).toEqual([
        userPlugin,
        '/native/shared-strategy.js',
        nativeRuntimePaths[format],
        '/native/fetch-runtime.js',
      ]);
      expect(ssrConfig.shared).toEqual({});
      expect(
        configs[0].plugins!.some(
          plugin =>
            plugin?.constructor ===
            (secondary
              ? nativeConstructors.TreeShakingSharedPlugin
              : nativeConstructors.ModuleFederationPlugin),
        ),
      ).toBe(true);
    },
  );

  it.each([false, true])(
    'keeps an existing recovery tuple and its position with secondary=%s',
    async secondary => {
      const fixture = owningSourceFixture();
      const recovery = fixture.source.resolveManifestRecoveryRuntimePlugin(
        pathToFileURL(fixture.sourceFile).href,
      );
      const existing: RuntimePlugin = [
        recovery,
        { attempts: 2, timeoutMs: 321 },
      ];
      const runtimePlugins: RuntimePlugin[] = [
        '/consumer/runtime.js',
        nativeRuntimePaths.require,
        existing,
        '/native/fetch-runtime.js',
      ];
      const ssrConfig = federationConfig(runtimePlugins);
      const native = await captureNativeModifier(ssrConfig, secondary);
      const repair = await captureRecoveryModifier(
        fixture.source.ultramodernModuleFederationRecoveryPlugin,
        nativeAppDirectory,
      );
      await configureActualChain(fixture.root, 'node', [
        native,
        repair,
        repair,
      ]);
      expect(ssrConfig.runtimePlugins).toBe(runtimePlugins);
      expect(ssrConfig.runtimePlugins[2]).toBe(existing);
      expect(ssrConfig.runtimePlugins).toEqual([
        '/consumer/runtime.js',
        nativeRuntimePaths.require,
        [recovery, { attempts: 2, timeoutMs: 321 }],
        '/native/fetch-runtime.js',
      ]);
    },
  );

  it.each(['node', 'web'] as const)(
    'does not access optional integration dependencies without a native server plugin on %s',
    async target => {
      const fixture = owningSourceFixture();
      let repair: ChainModifier | undefined;
      const getAppContext = rstest.fn(() => {
        throw new Error('Optional MF dependency access');
      });
      await ultramodernModuleFederationRecoveryPlugin().setup?.({
        modifyBundlerChain: (callback: ChainModifier) => {
          repair = callback;
        },
        getAppContext,
      } as unknown as CLIPluginAPI<AppTools>);
      const { chain } = await configureActualChain(fixture.root, target, [
        repair!,
      ]);
      expect(chain.plugins.has(nativeSSR.CHAIN_MF_PLUGIN_ID)).toBe(false);
      expect(getAppContext).not.toHaveBeenCalled();
    },
  );

  it('leaves the actual native SSR web branch unchanged', async () => {
    const fixture = owningSourceFixture();
    const runtimePlugins: RuntimePlugin[] = ['/consumer/browser-runtime.js'];
    const ssrConfig = federationConfig(runtimePlugins);
    const native = await captureNativeModifier(ssrConfig, false);
    const repair = await captureRecoveryModifier(
      fixture.source.ultramodernModuleFederationRecoveryPlugin,
      '/app-with-no-mf-dependencies',
    );
    const { chain } = await configureActualChain(fixture.root, 'web', [
      native,
      repair,
    ]);
    expect(chain.plugins.has(nativeSSR.CHAIN_MF_PLUGIN_ID)).toBe(false);
    expect(ssrConfig.runtimePlugins).toBe(runtimePlugins);
  });
});
