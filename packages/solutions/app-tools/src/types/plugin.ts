import type { ResolvedDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import type {
  AppContext,
  AsyncHook,
  InternalContext,
  PluginHook,
  PluginHookTap,
  TransformFunction,
} from '@modern-js/plugin';
import type { Hooks } from '@modern-js/plugin/cli';
import type { BffRuntimeFramework } from '@modern-js/plugin/server';
import type {
  Entrypoint,
  HtmlPartials,
  HtmlTemplates,
  HttpMethodDecider,
  NestedRouteForCli,
  PageRoute,
  RouteLegacy,
  ServerPlugin,
  ServerRoute,
} from '@modern-js/types';
import type { EagerRouteComponentFilesByEntry } from '@modern-js/utils';
import type { EnvironmentConfig } from '@rsbuild/core';
import type { getHookRunners } from '../compat/hooks';
import type { AppTools } from '.';
import type { AppToolsNormalizedConfig, AppToolsUserConfig } from './config';

export interface BffCompilation {
  readonly appDirectory: string;
  readonly apiDirectory: string;
  readonly sourceDirectories: readonly string[];
  readonly outputDirectories: readonly string[];
  readonly distDirectory: string;
  readonly tsconfigPath?: string;
  readonly moduleType: AppToolsContext['moduleType'];
}

export interface BffGeneration {
  readonly appDirectory: string;
  readonly apiDirectory: string;
  readonly lambdaDirectory: string;
  readonly existLambda: boolean;
  readonly apiFiles: readonly string[];
  readonly relativeDistPath: string;
  readonly prefix: string;
  readonly port?: number;
  readonly requestId: string;
  readonly requestCreator?: string;
  readonly httpMethodDecider?: HttpMethodDecider;
}

export interface BffClientArtifact {
  /** Canonical relative source path under generation.apiDirectory. */
  readonly sourcePath: string;
  readonly code: string;
  readonly declaration: string;
}

export interface BffClientArtifacts {
  readonly generation: BffGeneration;
  additionalArtifacts: BffClientArtifact[];
}

export interface BffGeneratedModule {
  readonly code: string;
  readonly declaration: string;
}

export interface BffGeneratedEntries {
  readonly generation: BffGeneration;
  plugin: BffGeneratedModule;
  runtime: BffGeneratedModule | null;
  /** Direct dependencies required by the emitted SDK modules. */
  packageDependencies: Record<string, string>;
}

export type BeforeBffCompileFn = (
  context: BffCompilation,
) => void | Promise<void>;
export type AfterBffCompileFn = (
  context: BffCompilation,
) => void | Promise<void>;
export type ModifyBffClientArtifactsFn = TransformFunction<BffClientArtifacts>;
export type ModifyBffGeneratedEntriesFn =
  TransformFunction<BffGeneratedEntries>;

export type AfterPrepareFn = () => Promise<void> | void;
export type CheckEntryPointFn = TransformFunction<{
  path: string;
  entry: false | string;
}>;
export type ModifyEntrypointsFn = TransformFunction<{
  entrypoints: Entrypoint[];
}>;
export type ModifyBuilderEnvironmentsFn = TransformFunction<{
  environments: Record<string, EnvironmentConfig>;
}>;
export type ModifyFileSystemRoutesFn = TransformFunction<{
  entrypoint: Entrypoint;
  routes: RouteLegacy[] | (NestedRouteForCli | PageRoute)[];
}>;
export type DeplpoyFn = () => Promise<void> | void;
export type GenerateEntryCodeFn = (params: {
  entrypoints: Entrypoint[];
}) => Promise<void> | void;
export type BeforeGenerateRoutesFn = TransformFunction<{
  entrypoint: Entrypoint;
  code: string;
}>;
export type BeforePrintInstructionsFn = TransformFunction<{
  instructions: string;
}>;
export type AddRuntimeExportsFn = () => Promise<void> | void;

export interface AppToolsExtendAPI {
  onAfterPrepare: PluginHookTap<AfterPrepareFn>;
  deploy: PluginHookTap<DeplpoyFn>;

  checkEntryPoint: PluginHookTap<CheckEntryPointFn>;
  modifyEntrypoints: PluginHookTap<ModifyEntrypointsFn>;
  modifyBuilderEnvironments: PluginHookTap<ModifyBuilderEnvironmentsFn>;
  modifyFileSystemRoutes: PluginHookTap<ModifyFileSystemRoutesFn>;

  generateEntryCode: PluginHookTap<GenerateEntryCodeFn>;
  onBeforeGenerateRoutes: PluginHookTap<BeforeGenerateRoutesFn>;
  /**
   * @deprecated
   */
  onBeforePrintInstructions: PluginHookTap<BeforePrintInstructionsFn>;
  /**
   * @deprecated use getAppContext instead
   */
  useAppContext: () => AppToolsContext;
  /**
   * @deprecated use getConfig instead
   */
  useConfigContext: () => AppToolsUserConfig;
  /**
   * @deprecated use getNormalizedConfig instead
   */
  useResolvedConfigContext: () => AppToolsNormalizedConfig<AppToolsUserConfig>;
  /**
   * @deprecated use api.xx instead
   */
  useHookRunners: () => ReturnType<typeof getHookRunners>;
}

export interface AppToolsExtendHooks
  extends Record<string, PluginHook<(...args: any[]) => any>> {
  onBeforeBffCompile: AsyncHook<BeforeBffCompileFn>;
  onAfterBffCompile: AsyncHook<AfterBffCompileFn>;
  modifyBffClientArtifacts: AsyncHook<ModifyBffClientArtifactsFn>;
  modifyBffGeneratedEntries: AsyncHook<ModifyBffGeneratedEntriesFn>;
  onAfterPrepare: AsyncHook<AfterPrepareFn>;
  deploy: AsyncHook<DeplpoyFn>;
  checkEntryPoint: AsyncHook<CheckEntryPointFn>;
  modifyEntrypoints: AsyncHook<ModifyEntrypointsFn>;
  modifyBuilderEnvironments: AsyncHook<ModifyBuilderEnvironmentsFn>;
  modifyFileSystemRoutes: AsyncHook<ModifyFileSystemRoutesFn>;
  generateEntryCode: AsyncHook<GenerateEntryCodeFn>;
  onBeforeGenerateRoutes: AsyncHook<BeforeGenerateRoutesFn>;
  /**
   * @deprecated
   */
  onBeforePrintInstructions: AsyncHook<BeforePrintInstructionsFn>;
}

export interface AppToolsExtendContext {
  metaName: string;
  internalDirectory: string;
  sharedDirectory: string;
  internalDirAlias: string;
  internalSrcAlias: string;
  apiDirectory: string;
  lambdaDirectory: string;
  runtimeConfigFile: string;
  serverPlugins: ServerPlugin[];
  moduleType: 'module' | 'commonjs';
  /** Exact generated files excluded from server compilation. */
  serverCompileExcludedFiles?: string[];
  /** Information for entry points */
  entrypoints: Entrypoint[];
  /** Selected entry points */
  checkedEntries: string[];
  /** Information for server routes */
  serverRoutes: ServerRoute[];
  /** Whether to use api only mode */
  apiOnly: boolean;
  deployTarget: ResolvedDeployTarget;
  _internalContext: InternalContext<AppTools>;
  /**
   * Information for HTML templates by entry
   * @private
   */
  partialsByEntrypoint?: Record<string, HtmlPartials>;
  /**
   * Information for HTML templates
   * @private
   */
  htmlTemplates: HtmlTemplates;
  /**
   * @deprecated compat old plugin, default is app tools
   */
  toolsType?: string;
  /**
   * Identification for bff runtime framework
   * @private
   */
  bffRuntimeFramework?: BffRuntimeFramework;
  /**
   * Route component files collected from the FINAL file-system routes (after all
   * `modifyFileSystemRoutes` consumers ran), keyed by entry name. Populated by
   * the router plugin during route generation and consumed (currently by stream
   * SSR lazy compilation) to force route component chunks eager.
   *
   * Published via the app context (`api.updateAppContext`) by the router plugin,
   * then read fresh when assembling the builder options and threaded into
   * `BuilderOptions.eagerRouteComponentFilesByEntry`; the SSR builder plugin
   * reads it from those options (not from the context directly).
   * @private
   */
  eagerRouteComponentFilesByEntry?: EagerRouteComponentFilesByEntry;
}

export type AppToolsContext = AppContext<AppTools> & AppToolsExtendContext;

export type AppToolsHooks = Hooks<
  AppToolsUserConfig,
  AppToolsNormalizedConfig,
  {},
  {}
> &
  AppToolsExtendHooks;
