import type { ResolvedDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import type { AppContext, Hooks } from '@modern-js/plugin/cli';
import type { NestedRouteForCli, PageRoute } from '@modern-js/types/cli';
import type {
  AppTools,
  AppToolsNormalizedConfig,
  AppToolsUserConfig,
} from './config';
import type {
  AppToolsExtendAPIBase,
  AppToolsExtendContextBase,
  AppToolsExtendHooksBase,
  ModifyFileSystemRoutesFn as BaseModifyFileSystemRoutesFn,
} from './plugin-base';

export * from './plugin-base';

export type ModifyFileSystemRoutesFn = BaseModifyFileSystemRoutesFn<
  NestedRouteForCli | PageRoute
>;
export interface AppToolsExtendAPI
  extends AppToolsExtendAPIBase<AppTools, NestedRouteForCli | PageRoute> {}
export interface AppToolsExtendHooks
  extends AppToolsExtendHooksBase<NestedRouteForCli | PageRoute> {}
export interface AppToolsExtendContext
  extends AppToolsExtendContextBase<AppTools> {
  deployTarget: ResolvedDeployTarget;
}
export type AppToolsContext = AppContext<AppTools> & AppToolsExtendContext;
export type AppToolsHooks = Hooks<
  AppToolsUserConfig,
  AppToolsNormalizedConfig,
  {},
  {}
> &
  AppToolsExtendHooks;
