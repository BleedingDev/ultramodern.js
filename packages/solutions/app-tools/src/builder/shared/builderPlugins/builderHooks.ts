import type { Hooks } from '@modern-js/plugin/cli';
import type { RsbuildPlugin } from '@rsbuild/core';

export const builderPluginAdapterHooks = <
  Options extends {
    appContext: {
      _internalContext: {
        pluginAPI?: {
          getHooks(): Readonly<
            Pick<
              Hooks<{}, {}, {}, {}>,
              | 'modifyBundlerChain'
              | 'modifyRsbuildConfig'
              | 'modifyRspackConfig'
            >
          >;
        };
      };
    };
  },
>(
  options: Options,
): RsbuildPlugin => ({
  name: 'builder-plugin-support-modern-hooks',
  setup(api) {
    const _internalContext = options.appContext._internalContext;
    const hooks = _internalContext.pluginAPI?.getHooks();
    api.modifyBundlerChain(async (chain, utils) => {
      await hooks?.modifyBundlerChain.call(chain, utils);
    });
    api.modifyRsbuildConfig(async (config, utils) => {
      await hooks?.modifyRsbuildConfig.call(config, utils);
    });
    api.modifyRspackConfig(async (config, utils) => {
      await hooks?.modifyRspackConfig.call(config, utils);
    });
  },
});
