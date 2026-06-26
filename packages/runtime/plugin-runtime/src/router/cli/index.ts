// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import type {
  NestedRouteForCli,
  PageRoute,
  ServerRoute,
} from '@modern-js/types';
import {
  filterRoutesForServer,
  NESTED_ROUTE_SPEC_FILE,
} from '@modern-js/utils';
import { NESTED_ROUTES_DIR } from './constants';
import {
  BUILT_IN_ROUTES_OWNER,
  getEntrypointRoutesDir,
  getEntrypointRoutesOwner,
  isRouteEntry,
  ROUTES_OWNER_META_KEY,
} from './entry';
import {
  handleFileChange,
  handleGeneratorEntryCode,
  handleModifyEntrypoints,
} from './handler';
import { updateNestedRoutesSpec } from './nestedRoutesSpec';

export {
  BUILT_IN_ROUTES_OWNER,
  getEntrypointRoutesDir,
  getEntrypointRoutesOwner,
  isRouteEntry,
} from './entry';
export {
  handleFileChange,
  handleGeneratorEntryCode,
  handleModifyEntrypoints,
} from './handler';
export { updateNestedRoutesSpec } from './nestedRoutesSpec';

type RouteEntrypointLike = {
  entry?: string;
  pageRoutesEntry?: string;
  nestedRoutesEntry?: string;
  [ROUTES_OWNER_META_KEY]?: string;
};

function isBuiltInRouteEntrypoint(entrypoint: RouteEntrypointLike) {
  const entrypointRoutesOwner = getEntrypointRoutesOwner(entrypoint);
  if (entrypointRoutesOwner) {
    return entrypointRoutesOwner === BUILT_IN_ROUTES_OWNER;
  }

  if (entrypoint.pageRoutesEntry) {
    return true;
  }

  const entrypointRoutesDir = getEntrypointRoutesDir(entrypoint);
  if (entrypointRoutesDir) {
    return entrypointRoutesDir === NESTED_ROUTES_DIR;
  }

  return Boolean(entrypoint.entry && isRouteEntry(entrypoint.entry));
}

function isPluginOwnedRouteEntrypoint(entrypoint: RouteEntrypointLike) {
  const entrypointRoutesOwner = getEntrypointRoutesOwner(entrypoint);
  if (entrypointRoutesOwner) {
    return entrypointRoutesOwner !== BUILT_IN_ROUTES_OWNER;
  }

  const entrypointRoutesDir = getEntrypointRoutesDir(entrypoint);
  return Boolean(
    entrypointRoutesDir && entrypointRoutesDir !== NESTED_ROUTES_DIR,
  );
}

export const routerPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-router',
  required: ['@modern-js/runtime'],
  setup: api => {
    const nestedRoutesForServer: Record<string, unknown> = {};

    const { metaName } = api.getAppContext();

    api.addCommand(({ program }) => {
      program
        .command('routes')
        .description('generate routes inspect report')
        .action(async () => {
          const { generateRoutesInspectReport } = await import(
            './code/inspect'
          );
          await generateRoutesInspectReport(api);
        });
    });

    api._internalRuntimePlugins(({ entrypoint, plugins }) => {
      const { serverRoutes, metaName } = api.getAppContext();
      const normalizedConfig = api.getNormalizedConfig() as any;
      const hasUserRouterConfig =
        normalizedConfig.router &&
        Object.keys(normalizedConfig.router).length > 0;
      const serverBase = serverRoutes
        .filter(
          (route: ServerRoute) => route.entryName === entrypoint.entryName,
        )
        .map(route => route.urlPath)
        .sort((a, b) => (a.length - b.length > 0 ? -1 : 1));

      // No source sniffing here: custom (non-file-route) entrypoints get the
      // built-in router either through an explicit `router` config flag or
      // because an installed router-provider plugin (e.g.
      // @modern-js/plugin-tanstack) injects the framework-resolving router
      // plugin for them itself.
      const shouldInstallBuiltInRouter =
        isBuiltInRouteEntrypoint(entrypoint) ||
        (!isPluginOwnedRouteEntrypoint(entrypoint) && hasUserRouterConfig);

      if (shouldInstallBuiltInRouter) {
        plugins.push({
          name: 'router',
          path: `@${metaName}/runtime/router/internal`,
          config: { serverBase },
        });
      }

      return { entrypoint, plugins };
    });
    api.checkEntryPoint(({ path, entry }) => {
      return { path, entry: entry || isRouteEntry(path) };
    });
    api.config(() => {
      return {
        source: {
          include: [
            // react-router v6+ no longer supports IE 11
            // so we need to compile these packages to ensure the compatibility
            // https://github.com/remix-run/react-router/commit/f6df0697e1b2064a2b3a12e8b39577326fdd945b
            /[\\/]node_modules[\\/]react-router[\\/]/,
            path.resolve(__dirname, '../runtime').replace('cjs', 'esm'),
          ],
        },
      };
    });
    api.modifyEntrypoints(async ({ entrypoints }) => {
      const newEntryPoints = await handleModifyEntrypoints(entrypoints);
      return { entrypoints: newEntryPoints };
    });
    api.generateEntryCode(async ({ entrypoints }) => {
      const builtInEntrypoints = entrypoints.filter(isBuiltInRouteEntrypoint);
      if (builtInEntrypoints.length > 0) {
        await handleGeneratorEntryCode(api, builtInEntrypoints);
      }
    });
    api.onFileChanged(async e => {
      await handleFileChange(api, e, {
        includeEntry: isBuiltInRouteEntrypoint,
      });
    });

    api.modifyFileSystemRoutes(({ entrypoint, routes }) => {
      if (isBuiltInRouteEntrypoint(entrypoint)) {
        nestedRoutesForServer[entrypoint.entryName] = filterRoutesForServer(
          routes as (NestedRouteForCli | PageRoute)[],
        );
      }

      return {
        entrypoint,
        routes,
      };
    });

    api.onBeforeGenerateRoutes(async ({ entrypoint, code }) => {
      if (isBuiltInRouteEntrypoint(entrypoint)) {
        const { distDirectory } = api.getAppContext();
        const nestedRoutesSpecPath = path.resolve(
          distDirectory,
          NESTED_ROUTE_SPEC_FILE,
        );
        await updateNestedRoutesSpec(
          nestedRoutesSpecPath,
          nestedRoutesForServer,
        );
      }

      return {
        entrypoint,
        code,
      };
    });
  },
});

export default routerPlugin;
