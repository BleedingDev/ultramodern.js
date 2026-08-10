// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off processEnv:off processEnvInEffect:off
import path from 'node:path';
import type {
  AppNormalizedConfig,
  AppTools,
  AppToolsContext,
  CliPlugin,
} from '@modern-js/app-tools';
import type { CLIPluginAPI } from '@modern-js/plugin';
import type {
  Entrypoint,
  NestedRouteForCli,
  PageRoute,
  ServerRoute,
} from '@modern-js/types';
import {
  filterRoutesForServer,
  fs,
  NESTED_ROUTE_SPEC_FILE,
} from '@modern-js/utils';
import { writeTanstackRouterTypesForEntries } from './artifacts';
import {
  createTanstackRsbuildRouteSplittingProfile,
  type TanstackRouteCodeSplittingOption,
} from './routeSplitting';

export {
  generateTanstackRouteArtifacts,
  writeTanstackRegisterFile,
  writeTanstackRouterTypesForEntries,
} from './artifacts';
export type {
  TanstackRouteCodeSplittingOption,
  TanstackRsbuildRouteSplittingProfile,
} from './routeSplitting';
export {
  createTanstackRsbuildRouteSplittingProfile,
  resolveTanstackRouteCodeSplittingEnabled,
} from './routeSplitting';
export {
  type CollectCanonicalRoutesOptions,
  collectCanonicalRoutesForEntry,
  generateTanstackRouterTypesSourceForEntry,
} from './tanstackTypes';

const DEFAULT_ROUTES_DIR = 'routes';
const DEFAULT_GENERATED_DIR_NAME = 'modern-tanstack';
const ENTRYPOINTS_KEY = '@modern-js/plugin-tanstack';

export type TanstackRouterPluginOptions = {
  routesDir?: string;
  generatedDirName?: string;
  routeCodeSplitting?: TanstackRouteCodeSplittingOption;
};

type RuntimeRouterCliHelpers = {
  getEntrypointRoutesDir: (entrypoint: Entrypoint) => string | null;
  getEntrypointRoutesOwner: (entrypoint: Entrypoint) => string | null;
  handleFileChange: (
    api: CLIPluginAPI<AppTools>,
    event: unknown,
    options?: {
      includeEntry?: (entrypoint: Entrypoint) => boolean;
      regenerate?: (params: {
        api: CLIPluginAPI<AppTools>;
        appContext: ReturnType<CLIPluginAPI<AppTools>['getAppContext']>;
        resolvedConfig: AppNormalizedConfig;
        entrypoints: Entrypoint[];
      }) => Promise<void>;
      entrypointsKey?: string;
    },
  ) => Promise<void>;
  handleGeneratorEntryCode: (
    api: CLIPluginAPI<AppTools>,
    entrypoints: Entrypoint[],
    options?: {
      entrypointsKey?: string;
      hydrateRscClientRoutes?: boolean;
      includeRouteServerLoadersInSsrEntry?: boolean;
      isolateRouteDataInRscLayer?: boolean;
      serverRoutesFileName?: string;
    },
  ) => Promise<Record<string, (NestedRouteForCli | PageRoute)[]>>;
  handleModifyEntrypoints: (
    entrypoints: Entrypoint[],
    routesDir?: string,
    options?: {
      routesOwner?: string;
    },
  ) => Promise<Entrypoint[]>;
  isRouteEntry: (dir: string, routesDir?: string) => string | false;
  updateNestedRoutesSpec: (
    specPath: string,
    nextRoutes: Record<string, unknown>,
  ) => Promise<void>;
};

let runtimeRouterCli: RuntimeRouterCliHelpers | undefined;

function getRuntimeRouterCli(): RuntimeRouterCliHelpers {
  if (runtimeRouterCli) {
    return runtimeRouterCli;
  }

  const cli =
    require('@modern-js/runtime/cli') as Partial<RuntimeRouterCliHelpers>;
  if (
    cli.handleGeneratorEntryCode &&
    cli.getEntrypointRoutesDir &&
    cli.getEntrypointRoutesOwner &&
    cli.updateNestedRoutesSpec
  ) {
    runtimeRouterCli = cli as RuntimeRouterCliHelpers;
    return runtimeRouterCli;
  }

  throw new Error(
    '@modern-js/plugin-tanstack requires @modern-js/runtime/cli router helper exports.',
  );
}

export function tanstackRouterPlugin(
  options: TanstackRouterPluginOptions = {},
): CliPlugin<AppTools> {
  const routesDir = options.routesDir || DEFAULT_ROUTES_DIR;
  const generatedDirName =
    options.generatedDirName || DEFAULT_GENERATED_DIR_NAME;
  const routeSplittingProfile =
    createTanstackRsbuildRouteSplittingProfile(options);

  return {
    name: '@modern-js/plugin-tanstack',
    required: ['@modern-js/runtime'],
    setup: api => {
      const nestedRoutesForServer: Record<string, unknown> = {};

      const isTanstackEntrypoint = (entrypoint: Entrypoint) => {
        const { getEntrypointRoutesDir } = getRuntimeRouterCli();
        return getEntrypointRoutesDir(entrypoint) === routesDir;
      };

      // Entrypoints claimed by another file-route convention — the built-in
      // pages/ or routes/ entries of @modern-js/runtime's router plugin, or
      // an entry tagged by a different routes-owner plugin. Their router
      // runtime plugin must be left untouched: redirecting it through our
      // wrapper would value-import the TanStack runtime into bundles that
      // never use it, and pushing a second `router` plugin can install two
      // routers for one entry.
      const isForeignRouteEntrypoint = (entrypoint: Entrypoint) => {
        const { getEntrypointRoutesDir, getEntrypointRoutesOwner } =
          getRuntimeRouterCli();
        if (getEntrypointRoutesOwner(entrypoint)) {
          // Owned by some routes-owner plugin. TanStack-owned entries were
          // already claimed by the isTanstackEntrypoint branch, so any owner
          // seen here is foreign.
          return true;
        }
        if (entrypoint.pageRoutesEntry) {
          return true;
        }
        return getEntrypointRoutesDir(entrypoint) !== null;
      };

      const isI18nPluginInstalled = () => {
        const { plugins } = api.getAppContext() as {
          plugins?: Array<{ name?: string }>;
        };
        return Boolean(
          plugins?.some(plugin => plugin?.name === '@modern-js/plugin-i18n'),
        );
      };

      api._internalRuntimePlugins(({ entrypoint, plugins }) => {
        const { metaName, serverRoutes } = api.getAppContext();
        const serverBase = serverRoutes
          .filter(
            (route: ServerRoute) => route.entryName === entrypoint.entryName,
          )
          .map(route => route.urlPath)
          .sort((a, b) => (a.length - b.length > 0 ? -1 : 1));

        if (isTanstackEntrypoint(entrypoint as Entrypoint)) {
          plugins.push({
            name: 'tanstackRouter',
            path: `@${metaName}/plugin-tanstack/runtime`,
            config: { serverBase },
          });

          return { entrypoint, plugins };
        }

        // Entries owned by the built-in router (classic routes/ or pages/
        // conventions) or by another routes-owner plugin keep their own
        // router runtime plugin untouched.
        if (isForeignRouteEntrypoint(entrypoint as Entrypoint)) {
          return { entrypoint, plugins };
        }

        // True custom entry without any file-route convention (`createRoutes`
        // apps, hand-rolled App entries, ...): having this plugin installed
        // is the explicit signal that the app routes through the
        // router-provider registry — no source sniffing of modern.runtime.ts.
        // Inject the framework-resolving router plugin of @modern-js/runtime
        // through our own runtime/router module, so the TanStack provider
        // registration is value-imported together with it and can never be
        // tree-shaken away from the entry.
        const routerWrapperPath = `@${metaName}/plugin-tanstack/runtime/router`;
        const existingRouterPlugin = plugins.find(
          plugin => plugin.name === 'router',
        );
        if (existingRouterPlugin) {
          existingRouterPlugin.path = routerWrapperPath;
        } else {
          plugins.push({
            name: 'router',
            path: routerWrapperPath,
            config: { serverBase },
          });
        }

        return { entrypoint, plugins };
      });

      api.checkEntryPoint(({ path: entryPath, entry }) => ({
        path: entryPath,
        entry:
          entry || getRuntimeRouterCli().isRouteEntry(entryPath, routesDir),
      }));

      api.config(() => ({
        ...routeSplittingProfile.defaultConfig,
        source: {
          include: [
            // TanStack Router and its runtime deps ship modern syntax and
            // must be down-leveled for the app's browser targets.
            /[\\/]node_modules[\\/]@tanstack[\\/]react-router[\\/]/,
            /[\\/]node_modules[\\/]@tanstack[\\/]router-core[\\/]/,
            /[\\/]node_modules[\\/]@tanstack[\\/]react-store[\\/]/,
            // This package's own dist runtime, too. `__dirname` is
            // dist/{cjs,esm-node}/cli (or src/cli in tests), so the package
            // dist root is two levels up. Resolution-based — no string
            // surgery: the old `.replace('cjs', 'esm')` corrupted workspace
            // paths containing 'cjs' and, under the ESM CLI condition, never
            // matched the dist/esm runtime that browsers actually bundle.
            path.resolve(__dirname, '..', '..'),
          ],
        },
      }));

      api.modifyEntrypoints(async ({ entrypoints }) => {
        const { handleModifyEntrypoints } = getRuntimeRouterCli();
        return {
          entrypoints: await handleModifyEntrypoints(entrypoints, routesDir, {
            routesOwner: ENTRYPOINTS_KEY,
          }),
        };
      });

      api.generateEntryCode(async ({ entrypoints }) => {
        const tanstackEntrypoints = entrypoints.filter(isTanstackEntrypoint);

        if (tanstackEntrypoints.length === 0) {
          return;
        }

        const { handleGeneratorEntryCode } = getRuntimeRouterCli();
        const routesByEntry = await handleGeneratorEntryCode(
          api,
          tanstackEntrypoints,
          {
            entrypointsKey: ENTRYPOINTS_KEY,
            hydrateRscClientRoutes: true,
            includeRouteServerLoadersInSsrEntry: false,
            isolateRouteDataInRscLayer: true,
            serverRoutesFileName: 'tanstack-routes.server.js',
          },
        );

        await writeTanstackRouterTypesForEntries({
          appContext: api.getAppContext(),
          generatedDirName,
          routesByEntry,
          i18nPluginInstalled: isI18nPluginInstalled(),
        });
      });

      api.onFileChanged(async event => {
        const { handleFileChange } = getRuntimeRouterCli();
        await handleFileChange(api, event, {
          entrypointsKey: ENTRYPOINTS_KEY,
          includeEntry: entrypoint => {
            const { getEntrypointRoutesDir } = getRuntimeRouterCli();
            return getEntrypointRoutesDir(entrypoint) === routesDir;
          },
          regenerate: async ({ api, entrypoints }) => {
            const { handleGeneratorEntryCode } = getRuntimeRouterCli();
            const routesByEntry = await handleGeneratorEntryCode(
              api,
              entrypoints,
              {
                entrypointsKey: ENTRYPOINTS_KEY,
                hydrateRscClientRoutes: true,
                includeRouteServerLoadersInSsrEntry: false,
                isolateRouteDataInRscLayer: true,
                serverRoutesFileName: 'tanstack-routes.server.js',
              },
            );

            await writeTanstackRouterTypesForEntries({
              appContext: api.getAppContext(),
              generatedDirName,
              routesByEntry,
              i18nPluginInstalled: isI18nPluginInstalled(),
            });
          },
        });
      });

      api.modifyFileSystemRoutes(async ({ entrypoint, routes }) => {
        if (isTanstackEntrypoint(entrypoint)) {
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
        if (isTanstackEntrypoint(entrypoint)) {
          const { distDirectory } = api.getAppContext();
          const nestedRoutesSpecPath = path.resolve(
            distDirectory,
            NESTED_ROUTE_SPEC_FILE,
          );
          const { updateNestedRoutesSpec } = getRuntimeRouterCli();
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
  };
}

export default tanstackRouterPlugin;
