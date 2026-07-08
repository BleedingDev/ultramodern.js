// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import path from 'node:path';
import type {
  AppNormalizedConfig,
  AppTools,
  AppToolsContext,
} from '@modern-js/app-tools';
import { makeLegalIdentifier } from '@modern-js/runtime/cli';
import type { NestedRouteForCli, PageRoute } from '@modern-js/types';

import {
  createRouteStaticDataSnippet,
  isIndexRoute,
  isPathlessLayout,
  normalizeRelativeImport,
  pickModernLoaderModule,
  pickRouteSearchContractModules,
  quote,
  resolveFileNoExt,
  toTanstackPath,
} from './shared';

type RouteForCli = NestedRouteForCli | PageRoute;

type RouteExtras = {
  id?: string;
  type?: unknown;
  isRoot?: unknown;
  children?: RouteForCli[];
  action?: unknown;
  path?: string;
  _component?: unknown;
};

export async function generateTanstackRouterTypesSourceForEntry(opts: {
  appContext: AppToolsContext;
  entryName: string;
  generatedDirName?: string;
  routes: RouteForCli[];
}): Promise<{
  routerGenTs: string;
}> {
  const {
    appContext,
    entryName,
    generatedDirName = 'modern-tanstack',
    routes,
  } = opts;
  const outDir = path.join(
    appContext.srcDirectory,
    generatedDirName,
    entryName,
  );

  const rootModern = routes.find(r => {
    const extras = r as RouteExtras;
    return r && extras.type === 'nested' && extras.isRoot;
  }) as NestedRouteForCli | undefined;

  const rootExtras = rootModern as RouteExtras | undefined;
  const topLevel = rootModern ? rootExtras?.children || [] : routes;

  const imports: string[] = [];
  const statements: string[] = [];

  const loaderImportMap = new Map<string, string>();
  const componentImportMap = new Map<string, Promise<string | null>>();
  const searchContractImportMap = new Map<string, string>();
  const usedRouteVarNames = new Set<string>();
  let loaderIndex = 0;
  let componentIndex = 0;
  let validateSearchIndex = 0;
  let loaderDepsIndex = 0;
  let routeIndex = 0;

  const getImportNameForComponent = (
    componentPath: unknown,
  ): Promise<string | null> => {
    if (typeof componentPath !== 'string' || componentPath.length === 0) {
      return Promise.resolve(null);
    }

    // Cache the in-flight promise: sibling routes sharing a component module
    // are generated concurrently and must reuse one import.
    let pendingImportName = componentImportMap.get(componentPath);
    if (!pendingImportName) {
      pendingImportName = (async () => {
        // Resolve through the same machinery as loaders: the raw `_component`
        // value carries the internal `@_modern_js_src` alias, which the app's
        // tsconfig does not map — the generated file must use relative
        // imports.
        const resolvedNoExt = await resolveRouteModuleNoExt(componentPath);
        if (!resolvedNoExt) {
          return null;
        }

        const relImport = normalizeRelativeImport(
          path.relative(outDir, resolvedNoExt),
        );

        const componentName = `component_${componentIndex++}`;
        imports.push(`import ${componentName} from ${quote(relImport)};`);
        return componentName;
      })();
      componentImportMap.set(componentPath, pendingImportName);
    }

    return pendingImportName;
  };

  const resolveRouteModuleNoExt = async (aliasedNoExtPath: string) => {
    const prefix = `${appContext.internalSrcAlias}/`;
    let absNoExt: string;
    if (aliasedNoExtPath.startsWith(prefix)) {
      const rel = aliasedNoExtPath.slice(prefix.length);
      absNoExt = path.join(appContext.srcDirectory, rel);
    } else if (path.isAbsolute(aliasedNoExtPath)) {
      absNoExt = aliasedNoExtPath;
    } else {
      // Unknown format; treat as already relative to src.
      absNoExt = path.join(appContext.srcDirectory, aliasedNoExtPath);
    }

    return resolveFileNoExt(absNoExt);
  };

  const getImportNamesForLoader = async (
    aliasedNoExtPath: string,
    inline: boolean,
    hasAction: boolean,
  ) => {
    const key = `${
      inline ? 'inline' : 'default'
    }:${hasAction ? 'action' : 'loader'}:${aliasedNoExtPath}`;
    const existing = loaderImportMap.get(key);
    if (existing) {
      return {
        loaderName: existing,
        actionName: hasAction ? existing.replace(/^loader_/, 'action_') : null,
      };
    }

    const resolvedNoExt = await resolveRouteModuleNoExt(aliasedNoExtPath);
    if (!resolvedNoExt) {
      return null;
    }

    const relImport = normalizeRelativeImport(
      path.relative(outDir, resolvedNoExt),
    );

    const importName = `loader_${loaderIndex++}`;
    const actionName = hasAction
      ? importName.replace(/^loader_/, 'action_')
      : null;
    if (inline) {
      const specifiers = [`loader as ${importName}`];
      if (actionName) {
        specifiers.push(`action as ${actionName}`);
      }
      imports.push(
        `import { ${specifiers.join(', ')} } from ${quote(relImport)};`,
      );
    } else {
      imports.push(`import ${importName} from ${quote(relImport)};`);
    }

    loaderImportMap.set(key, importName);
    return { loaderName: importName, actionName };
  };

  const getImportNameForSearchContract = async (
    aliasedNoExtPath: string,
    exportName: 'validateSearch' | 'loaderDeps',
  ) => {
    const key = `${exportName}:${aliasedNoExtPath}`;
    const existing = searchContractImportMap.get(key);
    if (existing) {
      return existing;
    }

    const resolvedNoExt = await resolveRouteModuleNoExt(aliasedNoExtPath);
    if (!resolvedNoExt) {
      return null;
    }

    const relImport = normalizeRelativeImport(
      path.relative(outDir, resolvedNoExt),
    );
    const importName =
      exportName === 'validateSearch'
        ? `validateSearch_${validateSearchIndex++}`
        : `loaderDeps_${loaderDepsIndex++}`;
    imports.push(
      `import { ${exportName} as ${importName} } from ${quote(relImport)};`,
    );
    searchContractImportMap.set(key, importName);
    return importName;
  };

  const reserveRouteVarName = (preferred: string) => {
    let candidate = preferred;
    let suffix = 1;
    while (usedRouteVarNames.has(candidate)) {
      candidate = `${preferred}_${suffix++}`;
    }
    usedRouteVarNames.add(candidate);
    return candidate;
  };

  const createRouteVarName = (route: NestedRouteForCli | PageRoute) => {
    const id = (route as RouteExtras).id;
    const base = id ? makeLegalIdentifier(id) : `r_${routeIndex++}`;
    return reserveRouteVarName(`route_${base}`);
  };

  const buildRoute = async (opts: {
    parentVar: string;
    route: NestedRouteForCli | PageRoute;
  }): Promise<string> => {
    const { parentVar, route } = opts;

    const varName = createRouteVarName(route);
    const routeExtras = route as RouteExtras;

    const loaderInfo = pickModernLoaderModule(route);
    const routeAction = routeExtras.action;
    const loaderImports = loaderInfo
      ? await getImportNamesForLoader(
          loaderInfo.loaderPath,
          loaderInfo.inline,
          Boolean(loaderInfo.inline && routeAction === loaderInfo.loaderPath),
        )
      : null;
    const loaderName = loaderImports?.loaderName || null;
    const actionName = loaderImports?.actionName || null;
    const searchContractInfo = pickRouteSearchContractModules(route);
    const validateSearchName = searchContractInfo.validateSearchPath
      ? await getImportNameForSearchContract(
          searchContractInfo.validateSearchPath,
          'validateSearch',
        )
      : null;
    const loaderDepsName = searchContractInfo.loaderDepsPath
      ? await getImportNameForSearchContract(
          searchContractInfo.loaderDepsPath,
          'loaderDeps',
        )
      : null;

    const rawPath = routeExtras.path;
    const hasSplat = typeof rawPath === 'string' && rawPath.includes('*');

    const routeOpts: string[] = [`getParentRoute: () => ${parentVar},`];

    const componentName = await getImportNameForComponent(
      routeExtras._component,
    );
    if (componentName) {
      routeOpts.push(`component: ${componentName},`);
    }

    if (isPathlessLayout(route)) {
      const id = routeExtras.id;
      routeOpts.push(`id: ${quote(id || 'pathless')},`);
    } else {
      const p = isIndexRoute(route) ? '/' : toTanstackPath(rawPath || '');
      routeOpts.push(`path: ${quote(p)},`);
    }

    if (loaderName) {
      routeOpts.push(
        `loader: modernLoaderToTanstack({ hasSplat: ${hasSplat} }, ${loaderName}),`,
      );
    }
    if (validateSearchName) {
      routeOpts.push(`validateSearch: ${validateSearchName},`);
    }
    if (loaderDepsName) {
      routeOpts.push(`loaderDeps: ${loaderDepsName},`);
    }

    const staticDataSnippet = createRouteStaticDataSnippet({
      modernRouteId: routeExtras.id,
      loaderName,
      actionName,
    });
    if (staticDataSnippet) {
      routeOpts.push(staticDataSnippet);
    }

    const children = routeExtras.children;
    const hasChildren = Boolean(children && children.length > 0);
    const routeCtorVarName = hasChildren
      ? reserveRouteVarName(`${varName}__base`)
      : varName;

    statements.push(
      `const ${routeCtorVarName} = createRoute({\n  ${routeOpts.join('\n  ')}\n});`,
    );

    if (children && children.length > 0) {
      const childVars: string[] = [];
      for (const child of children) {
        childVars.push(
          await buildRoute({ parentVar: routeCtorVarName, route: child }),
        );
      }
      statements.push(
        `const ${varName} = ${routeCtorVarName}.addChildren([${childVars.join(', ')}]);`,
      );
    }

    return varName;
  };

  const rootLoaderInfo = rootModern ? pickModernLoaderModule(rootModern) : null;
  const rootAction = rootExtras?.action;
  const rootLoaderImports = rootLoaderInfo?.loaderPath
    ? await getImportNamesForLoader(
        rootLoaderInfo.loaderPath,
        rootLoaderInfo.inline,
        Boolean(
          rootLoaderInfo.inline && rootAction === rootLoaderInfo.loaderPath,
        ),
      )
    : null;
  const rootLoaderName = rootLoaderImports?.loaderName || null;
  const rootActionName = rootLoaderImports?.actionName || null;
  const rootSearchContractInfo = rootModern
    ? pickRouteSearchContractModules(rootModern)
    : null;
  const rootValidateSearchName = rootSearchContractInfo?.validateSearchPath
    ? await getImportNameForSearchContract(
        rootSearchContractInfo.validateSearchPath,
        'validateSearch',
      )
    : null;
  const rootLoaderDepsName = rootSearchContractInfo?.loaderDepsPath
    ? await getImportNameForSearchContract(
        rootSearchContractInfo.loaderDepsPath,
        'loaderDeps',
      )
    : null;

  const topLevelVars: string[] = [];
  for (const route of topLevel) {
    topLevelVars.push(await buildRoute({ parentVar: 'rootRoute', route }));
  }

  const rootOpts: string[] = [];

  const rootComponentName = await getImportNameForComponent(
    rootExtras?._component,
  );
  if (rootComponentName) {
    rootOpts.push(`component: ${rootComponentName},`);
  }

  if (rootLoaderName) {
    rootOpts.push(
      `loader: modernLoaderToTanstack({ hasSplat: false }, ${rootLoaderName}),`,
    );
  }
  if (rootValidateSearchName) {
    rootOpts.push(`validateSearch: ${rootValidateSearchName},`);
  }
  if (rootLoaderDepsName) {
    rootOpts.push(`loaderDeps: ${rootLoaderDepsName},`);
  }

  const routerGenTs = `/* eslint-disable */
// This file is auto-generated by Modern.js. Do not edit manually.

import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createRouteStaticData,
  type ModernRouterContext,
  modernLoaderToTanstack,
  modernTanstackRouterFastDefaults,
} from '@modern-js/plugin-tanstack/runtime';

${imports.join('\n')}

export const rootRoute = createRootRouteWithContext<ModernRouterContext>()({
  ${rootOpts.join('\n  ')}
  ${
    createRouteStaticDataSnippet({
      modernRouteId: rootExtras?.id,
      loaderName: rootLoaderName,
      actionName: rootActionName,
    }) || ''
  }
});

${statements.join('\n\n')}

export const routeTree = rootRoute.addChildren([${topLevelVars.join(', ')}]);

export const router = createRouter({
  ...modernTanstackRouterFastDefaults,
  routeTree,
  history: createMemoryHistory({
    initialEntries: ['/'],
  }),
  context: {} as ModernRouterContext,
});
`;

  return { routerGenTs };
}
