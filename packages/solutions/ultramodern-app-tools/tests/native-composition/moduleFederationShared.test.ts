import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPluginManager } from '@modern-js/plugin';
import { presetUltramodern } from '@modern-js/ultramodern-app-tools';
import { createRsbuild, type RspackChain, rspack } from '@rsbuild/core';
import {
  resolveFrameworkSharedPackages,
  ultramodernModuleFederationSharedPlugin,
  withFrameworkShared,
  withReactJsxRuntimeShared,
} from '../../src/native-composition/module-federation-shared-plugin';

/** An app directory that installs only `@modern-js/runtime` at 9.9.9. */
const createAppDirectory = () => {
  const appDirectory = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'ultramodern-mf-shared-')),
  );
  const runtimeDirectory = path.join(
    appDirectory,
    'node_modules/@modern-js/runtime',
  );
  mkdirSync(runtimeDirectory, { recursive: true });
  writeFileSync(
    path.join(runtimeDirectory, 'package.json'),
    JSON.stringify({
      name: '@modern-js/runtime',
      version: '9.9.9',
      exports: {
        '.': './index.js',
        './context': { types: './context.d.ts', default: './context.js' },
        './package.json': './package.json',
        // The app aliases these to its own generated registry.
        './registry': { types: './registry.d.ts' },
        './registry/*': { types: './registry.d.ts' },
      },
    }),
  );
  return { appDirectory, runtimeDirectory };
};

const runtimeShare = {
  '@modern-js/runtime/context': {
    requiredVersion: '9.9.9',
    singleton: true,
    treeShaking: false,
  },
};

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

  it('shares the exported framework subpaths at the installed version', () => {
    const { appDirectory, runtimeDirectory } = createAppDirectory();
    try {
      const packages = resolveFrameworkSharedPackages(appDirectory);
      expect(packages).toEqual([
        expect.objectContaining({
          prefix: '@modern-js/runtime/',
          version: '9.9.9',
          requests: ['@modern-js/runtime/context'],
          directory: runtimeDirectory,
          contextsRequest: '@modern-js/runtime/context',
        }),
      ]);
      expect(withFrameworkShared({ react: '^19' }, packages)).toEqual({
        react: '^19',
        ...runtimeShare,
      });
      expect(withFrameworkShared(undefined, packages)).toEqual(runtimeShare);
      const explicit = { '@modern-js/runtime/context': { eager: true } };
      expect(withFrameworkShared(explicit, packages)).toBe(explicit);
    } finally {
      rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('rewrites the browser and server federation plugin options', async () => {
    const { appDirectory } = createAppDirectory();
    let modifyBundlerChain: ((chain: RspackChain) => void) | undefined;
    ultramodernModuleFederationSharedPlugin().setup({
      getAppContext: () => ({ appDirectory }),
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
    rmSync(appDirectory, { recursive: true, force: true });
    expect(browser._options.shared).toEqual({
      react,
      ...jsxRuntimes('19.2.0'),
      ...runtimeShare,
    });
    expect(server.options.mfConfig.shared).toEqual({
      react,
      ...jsxRuntimes('19.2.0'),
      ...runtimeShare,
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
