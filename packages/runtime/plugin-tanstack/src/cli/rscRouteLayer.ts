// @effect-diagnostics nodeBuiltinImport:off
// Rsbuild invokes this compiler hook synchronously with native filesystem paths.
import path from 'node:path';
import type { AppNormalizedConfig } from '@modern-js/app-tools/cli-config';

type BuilderPlugin = NonNullable<AppNormalizedConfig['builderPlugins']>[number];
type ModifyRspackConfig = Extract<
  NonNullable<AppNormalizedConfig['tools']['rspack']>,
  (...args: never[]) => unknown
>;

export const TANSTACK_SERVER_ROUTES_FILE = 'tanstack-routes.server.js';

type RouteLayerContext = {
  entryNames: readonly string[];
  internalDirectory: string;
  rsc: AppNormalizedConfig['server']['rsc'];
};

function exactResource(...filenames: string[]) {
  const escaped = filenames.map(filename =>
    filename.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  );
  return new RegExp(`^(?:${escaped.join('|')})(?:\\?.*)?$`, 'u');
}

/** The HTML router consumes executable components, while route data stays in Flight. */
export function createTanstackRscRouteLayerPlugin(
  getContext: () => RouteLayerContext,
): BuilderPlugin {
  return {
    name: 'modern:tanstack:rsc-route-layer',
    setup(api) {
      api.modifyRspackConfig({
        order: 'post',
        handler(
          config: Parameters<ModifyRspackConfig>[0],
          { environment, rspack, target }: Parameters<ModifyRspackConfig>[1],
        ) {
          const { entryNames, internalDirectory, rsc } = getContext();
          if (rsc === false || rsc === undefined || entryNames.length === 0) {
            return;
          }
          const rscServerEnvironment =
            typeof rsc === 'object'
              ? (rsc.environments?.server ?? 'server')
              : 'server';
          if (
            target !== 'node' &&
            config.target !== 'node' &&
            environment.name !== rscServerEnvironment
          ) {
            return;
          }

          config.module ??= {};
          config.module.rules ??= [];
          config.plugins ??= [];
          for (const entryName of entryNames) {
            const routes = path.resolve(
              internalDirectory,
              entryName,
              'routes.js',
            );
            const serverRoutes = path.resolve(
              internalDirectory,
              entryName,
              TANSTACK_SERVER_ROUTES_FILE,
            );
            // runtime-global-context.js imports the browser route table in both
            // compilers. Select the complete, loader-isolated table for HTML.
            config.plugins.push(
              new rspack.NormalModuleReplacementPlugin(
                exactResource(routes),
                serverRoutes,
              ),
            );
            // Match both names: native replacement can occur after Rspack has
            // already selected rules and a layer for the original request.
            // Avoid inheriting an RSC issuer's layer. Native use-server-entry
            // processing returns client references in that layer, which ReactDOM
            // must never invoke. Isolated __rsc_route_data__ retains its native
            // explicit react-server-components rule and Flight serialization.
            config.module.rules.push({
              resource: exactResource(routes, serverRoutes),
              layer: 'server-side-rendering',
            });
          }
        },
      });
    },
  };
}
