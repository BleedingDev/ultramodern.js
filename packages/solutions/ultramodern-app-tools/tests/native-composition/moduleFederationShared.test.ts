import { createPluginManager } from '@modern-js/plugin';
import { presetUltramodern } from '@modern-js/ultramodern-app-tools';
import { createRsbuild, type RspackChain, rspack } from '@rsbuild/core';
import {
  ultramodernModuleFederationSharedPlugin,
  withReactJsxRuntimeShared,
} from '../../src/native-composition/module-federation-shared-plugin';

const jsxRuntimes = (requiredVersion?: string) => ({
  'react/jsx-dev-runtime': {
    ...(requiredVersion ? { requiredVersion } : {}),
    singleton: true,
    treeShaking: false,
  },
  'react/jsx-runtime': {
    ...(requiredVersion ? { requiredVersion } : {}),
    singleton: true,
    treeShaking: false,
  },
});

describe('Module Federation React JSX runtime sharing', () => {
  it('shares both JSX runtimes at the shared React version', () => {
    const react = { requiredVersion: '19.2.0', singleton: true };
    expect(withReactJsxRuntimeShared({ react })).toEqual({
      react,
      ...jsxRuntimes('19.2.0'),
    });
    expect(withReactJsxRuntimeShared({ react: '^19.2.0' })).toEqual({
      react: '^19.2.0',
      ...jsxRuntimes('^19.2.0'),
    });
    expect(withReactJsxRuntimeShared(['react'])).toEqual([
      'react',
      jsxRuntimes(),
    ]);
  });

  it('keeps explicit entries and leaves apps without shared React alone', () => {
    const shared = {
      react: { singleton: true },
      'react/jsx-runtime': { eager: true },
      'react/jsx-dev-runtime': { eager: true },
    };
    expect(withReactJsxRuntimeShared(shared)).toBe(shared);
    const withoutReact = { lodash: { singleton: true } };
    expect(withReactJsxRuntimeShared(withoutReact)).toBe(withoutReact);
    expect(withReactJsxRuntimeShared(undefined)).toBeUndefined();
  });

  it('runs after the federation plugins register their chain entries', () => {
    const manager = createPluginManager();
    manager.addPlugins([
      ultramodernModuleFederationSharedPlugin(),
      { name: '@modern-js/plugin-module-federation-ssr' },
      { name: '@modern-js/plugin-module-federation' },
    ]);
    expect(manager.getPlugins().at(-1)?.name).toBe(
      '@modern-js/ultramodern-module-federation-shared',
    );
  });

  it('rewrites the browser and server federation plugin options', async () => {
    let modifyBundlerChain: ((chain: RspackChain) => void) | undefined;
    ultramodernModuleFederationSharedPlugin().setup({
      modifyBundlerChain: (handler: typeof modifyBundlerChain) => {
        modifyBundlerChain = handler;
      },
    } as any);
    const react = { requiredVersion: '19.2.0', singleton: true };
    const rsbuild = await createRsbuild({
      rsbuildConfig: {
        source: { entry: { index: './src/index.js' } },
        tools: {
          bundlerChain: chain => {
            chain
              .plugin('plugin-module-federation')
              .use(rspack.container.ModuleFederationPlugin, [
                { name: 'host', shared: { react } },
              ]);
            chain.plugin('plugin-module-federation-server').use(
              class TreeShakingSharedPlugin {
                constructor(readonly options: unknown) {}
                apply() {}
              },
              [{ mfConfig: { name: 'host', shared: { react } } }],
            );
            modifyBundlerChain!(chain);
          },
        },
      },
    });
    const [config] = await rsbuild.initConfigs();
    const browser = config.plugins!.find(
      plugin => plugin instanceof rspack.container.ModuleFederationPlugin,
    ) as any;
    const server = config.plugins!.find(
      plugin => plugin?.constructor.name === 'TreeShakingSharedPlugin',
    ) as any;
    expect(browser._options.shared).toEqual({
      react,
      ...jsxRuntimes('19.2.0'),
    });
    expect(server.options.mfConfig.shared).toEqual({
      react,
      ...jsxRuntimes('19.2.0'),
    });
  });

  it('is contributed by presetUltramodern ahead of app plugins', () => {
    const appPlugin = { name: 'app-plugin' };
    expect(
      presetUltramodern({ plugins: [appPlugin] }).plugins?.map(
        plugin => plugin.name,
      ),
    ).toEqual([
      '@modern-js/ultramodern-module-federation-shared',
      'app-plugin',
    ]);
  });
});
