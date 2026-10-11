import type {
  OnAfterBuildFn,
  OnAfterCreateCompilerFn,
  OnBeforeBuildFn,
  OnBeforeCreateCompilerFn,
  OnDevCompileDoneFn,
} from '@rsbuild/core';
import { createAsyncHook, createCollectAsyncHook } from '../hooks';
import type {
  AddCommandFn,
  AddWatchFilesFn,
  ConfigFn,
  InternalRuntimePluginsFn,
  InternalServerPluginsFn,
  ModifyBundlerChainFn,
  ModifyConfigFn,
  ModifyHtmlPartialsFn,
  ModifyResolvedConfigFn,
  ModifyRsbuildConfigFn,
  ModifyRspackConfigFn,
  ModifyServerRoutesFn,
  OnAfterDeployFn,
  OnAfterDevFn,
  OnBeforeDeployFn,
  OnBeforeDevFn,
  OnBeforeExitFn,
  OnBeforeRestartFn,
  OnFileChangedFn,
  OnPrepareFn,
  RuntimePluginConfig,
  ServerPluginConfig,
} from '../types/cli/hooks';
import type { AsyncHook, CollectAsyncHook } from '../types/hooks';
import type { DeepPartial } from '../types/utils';

export type {
  AddCommandFn,
  AddWatchFilesFn,
  ConfigFn,
  InternalRuntimePluginsFn,
  InternalServerPluginsFn,
  ModifyBundlerChainFn,
  ModifyConfigFn,
  ModifyHtmlPartialsFn,
  ModifyResolvedConfigFn,
  ModifyRsbuildConfigFn,
  ModifyRspackConfigFn,
  ModifyServerRoutesFn,
  OnAfterBuildFn,
  OnAfterCreateCompilerFn,
  OnAfterDeployFn,
  OnAfterDevFn,
  OnBeforeBuildFn,
  OnBeforeCreateCompilerFn,
  OnBeforeDeployFn,
  OnBeforeDevFn,
  OnBeforeExitFn,
  OnBeforeRestartFn,
  OnDevCompileDoneFn,
  OnFileChangedFn,
  OnPrepareFn,
  RuntimePluginConfig,
  ServerPluginConfig,
};

export function initHooks<
  Config,
  NormalizedConfig,
  ExtendBuildUtils,
  ExtendConfigUtils,
>(): Hooks<Config, NormalizedConfig, ExtendBuildUtils, ExtendConfigUtils> {
  return {
    /**
     * add config for this cli plugin
     */
    config: createCollectAsyncHook<ConfigFn<DeepPartial<Config>>>(),
    /**
     * @private
     * modify config for this cli plugin
     */
    modifyConfig: createAsyncHook<ModifyConfigFn<Config, ExtendConfigUtils>>(),
    /**
     * modify final config
     */
    modifyResolvedConfig:
      createAsyncHook<
        ModifyResolvedConfigFn<NormalizedConfig, ExtendConfigUtils>
      >(),

    modifyRsbuildConfig:
      createAsyncHook<ModifyRsbuildConfigFn<ExtendBuildUtils>>(),
    modifyBundlerChain:
      createAsyncHook<ModifyBundlerChainFn<ExtendBuildUtils>>(),
    modifyRspackConfig:
      createAsyncHook<ModifyRspackConfigFn<ExtendBuildUtils>>(),
    modifyHtmlPartials: createAsyncHook<ModifyHtmlPartialsFn>(),

    addCommand: createAsyncHook<AddCommandFn>(),
    addWatchFiles: createCollectAsyncHook<AddWatchFilesFn>(),

    onPrepare: createAsyncHook<OnPrepareFn>(),
    onFileChanged: createAsyncHook<OnFileChangedFn>(),
    onBeforeRestart: createAsyncHook<OnBeforeRestartFn>(),
    onBeforeCreateCompiler: createAsyncHook<OnBeforeCreateCompilerFn>(),
    onAfterCreateCompiler: createAsyncHook<OnAfterCreateCompilerFn>(),
    onDevCompileDone: createAsyncHook<OnDevCompileDoneFn>(),
    onBeforeBuild: createAsyncHook<OnBeforeBuildFn>(),
    onAfterBuild: createAsyncHook<OnAfterBuildFn>(),
    onBeforeDev: createAsyncHook<OnBeforeDevFn>(),
    onAfterDev: createAsyncHook<OnAfterDevFn>(),
    onBeforeDeploy: createAsyncHook<OnBeforeDeployFn>(),
    onAfterDeploy: createAsyncHook<OnAfterDeployFn>(),
    onBeforeExit: createAsyncHook<OnBeforeExitFn>(),
    _internalRuntimePlugins: createAsyncHook<InternalRuntimePluginsFn>(),
    _internalServerPlugins: createAsyncHook<InternalServerPluginsFn>(),
    modifyServerRoutes: createAsyncHook<ModifyServerRoutesFn>(),
  };
}

export type Hooks<
  Config,
  NormalizedConfig,
  ExtendBuildUtils,
  ExtendConfigUtils,
> = {
  config: CollectAsyncHook<ConfigFn<DeepPartial<Config>>>;
  modifyConfig: AsyncHook<ModifyConfigFn<Config, ExtendConfigUtils>>;
  modifyResolvedConfig: AsyncHook<
    ModifyResolvedConfigFn<NormalizedConfig, ExtendConfigUtils>
  >;
  modifyRsbuildConfig: AsyncHook<ModifyRsbuildConfigFn<ExtendBuildUtils>>;
  modifyBundlerChain: AsyncHook<ModifyBundlerChainFn<ExtendBuildUtils>>;
  modifyRspackConfig: AsyncHook<ModifyRspackConfigFn<ExtendBuildUtils>>;
  modifyHtmlPartials: AsyncHook<ModifyHtmlPartialsFn>;
  addCommand: AsyncHook<AddCommandFn>;
  addWatchFiles: CollectAsyncHook<AddWatchFilesFn>;
  onPrepare: AsyncHook<OnPrepareFn>;
  onFileChanged: AsyncHook<OnFileChangedFn>;
  onBeforeRestart: AsyncHook<OnBeforeRestartFn>;
  onBeforeCreateCompiler: AsyncHook<OnBeforeCreateCompilerFn>;
  onAfterCreateCompiler: AsyncHook<OnAfterCreateCompilerFn>;
  onDevCompileDone: AsyncHook<OnDevCompileDoneFn>;
  onBeforeBuild: AsyncHook<OnBeforeBuildFn>;
  onAfterBuild: AsyncHook<OnAfterBuildFn>;
  onBeforeDev: AsyncHook<OnBeforeDevFn>;
  onAfterDev: AsyncHook<OnAfterDevFn>;
  onBeforeDeploy: AsyncHook<OnBeforeDeployFn>;
  onAfterDeploy: AsyncHook<OnAfterDeployFn>;
  onBeforeExit: AsyncHook<OnBeforeExitFn>;
  _internalRuntimePlugins: AsyncHook<InternalRuntimePluginsFn>;
  _internalServerPlugins: AsyncHook<InternalServerPluginsFn>;
  modifyServerRoutes: AsyncHook<ModifyServerRoutesFn>;
};
