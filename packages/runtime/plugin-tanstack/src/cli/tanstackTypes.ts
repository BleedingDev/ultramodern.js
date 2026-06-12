// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import type { AppToolsContext } from '@modern-js/app-tools';
import { getPathWithoutExt, makeLegalIdentifier } from '@modern-js/runtime/cli';
import type { NestedRouteForCli, PageRoute } from '@modern-js/types';
import { findExists, formatImportPath, slash } from '@modern-js/utils';
import path from 'path';

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

function toTanstackPath(pathname: string): string {
  return pathname
    .split('/')
    .map(segment => {
      if (!segment) {
        return segment;
      }
      if (segment === '*') {
        return '$';
      }
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (name.endsWith('?')) {
          return `{-$${name.slice(0, -1)}}`;
        }
        return `$${name}`;
      }
      return segment;
    })
    .join('/');
}

async function resolveFileNoExt(inputNoExtPath: string) {
  const file = findExists(JS_OR_TS_EXTS.map(ext => `${inputNoExtPath}${ext}`));
  return file ? getPathWithoutExt(file) : null;
}

function quote(str: string) {
  return JSON.stringify(str);
}

function normalizeRelativeImport(p: string) {
  const normalized = formatImportPath(slash(p));
  if (normalized.startsWith('.')) {
    return normalized;
  }
  return `./${normalized}`;
}

function pickModernLoaderModule(route: NestedRouteForCli | PageRoute) {
  const loaderPath = (route as any).data || (route as any).loader;
  if (!loaderPath || typeof loaderPath !== 'string') {
    return null;
  }

  const inline = Boolean((route as any).data);
  return { loaderPath, inline };
}

function pickRouteSearchContractModules(route: NestedRouteForCli | PageRoute) {
  const validateSearchPath = (route as any).validateSearch;
  const loaderDepsPath = (route as any).loaderDeps;

  return {
    validateSearchPath:
      typeof validateSearchPath === 'string' ? validateSearchPath : null,
    loaderDepsPath: typeof loaderDepsPath === 'string' ? loaderDepsPath : null,
  };
}

function isPathlessLayout(route: NestedRouteForCli | PageRoute) {
  return (
    (route as any).type === 'nested' &&
    typeof (route as any).index !== 'boolean' &&
    typeof (route as any).path === 'undefined'
  );
}

function isIndexRoute(route: NestedRouteForCli | PageRoute) {
  return (route as any).type === 'nested' && Boolean((route as any).index);
}

function createRouteStaticDataSnippet(opts: {
  modernRouteId?: string;
  loaderName?: string | null;
  actionName?: string | null;
}) {
  const staticDataLines: string[] = [];

  if (opts.modernRouteId) {
    staticDataLines.push(`modernRouteId: ${quote(opts.modernRouteId)},`);
  }

  if (opts.loaderName) {
    staticDataLines.push(`modernRouteLoader: ${opts.loaderName},`);
  }

  if (opts.actionName) {
    staticDataLines.push(`modernRouteAction: ${opts.actionName},`);
  }

  if (!staticDataLines.length) {
    return null;
  }

  return `staticData: createRouteStaticData({\n    ${staticDataLines.join(
    '\n    ',
  )}\n  }),`;
}

const LOCALE_PARAM_SEGMENTS = new Set([
  ':lang',
  ':locale',
  ':language',
  '$lang',
  '$locale',
  '$language',
]);

type CanonicalAwareRoute = (NestedRouteForCli | PageRoute) & {
  modernCanonicalPath?: string;
  index?: boolean;
  isRoot?: boolean;
  children?: CanonicalAwareRoute[];
};

function paramsTypeForCanonicalPath(canonicalPath: string): string {
  const fields: string[] = [];

  for (const segment of canonicalPath.split('/')) {
    if (!segment) {
      continue;
    }
    if (segment === '*' || segment === '$') {
      fields.push(`'_splat'?: string`);
      continue;
    }
    if (segment.startsWith('{-$') && segment.endsWith('}')) {
      fields.push(`${JSON.stringify(segment.slice(3, -1))}?: string`);
      continue;
    }
    if (segment.startsWith('$')) {
      fields.push(`${JSON.stringify(segment.slice(1))}: string`);
      continue;
    }
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const name = segment.slice(1, optional ? undefined : segment.length);
      fields.push(
        `${JSON.stringify(optional ? name.slice(0, -1) : name)}${
          optional ? '?' : ''
        }: string`,
      );
    }
  }

  return fields.length > 0
    ? `{ ${fields.join('; ')} }`
    : 'Record<string, never>';
}

export type CollectCanonicalRoutesOptions = {
  /**
   * Whether a leading `:lang`/`:locale`/`:language` route param may be
   * treated as an i18n locale prefix. This MUST only be enabled when
   * `@modern-js/plugin-i18n` is actually installed: the emitted
   * `declare module '@modern-js/plugin-i18n/runtime'` augmentation breaks
   * typechecking (TS2664) for apps that hand-roll a `/:lang/` param without
   * the plugin. Routes carrying `modernCanonicalPath` metadata are always
   * honored — only plugin-i18n produces them.
   */
  localeParamHeuristic?: boolean;
};

/**
 * Derive the canonical (language-agnostic) route map for an entry: the
 * leading locale param is stripped and localized physical variants (routes
 * carrying `modernCanonicalPath` metadata from `@modern-js/plugin-i18n`)
 * collapse to their canonical pattern. Returns `null` when the entry has no
 * i18n routing surface (no locale param and no localized variants), so plain
 * TanStack apps never get a `@modern-js/plugin-i18n` module augmentation.
 */
export function collectCanonicalRoutesForEntry(
  routes: (NestedRouteForCli | PageRoute)[],
  options: CollectCanonicalRoutesOptions = {},
): Record<string, string> | null {
  const { localeParamHeuristic = true } = options;
  const canonicalParams = new Map<string, string>();
  let hasI18nSurface = false;

  const normalizeJoined = (joined: string): string => {
    const collapsed = joined.replace(/\/+/g, '/');
    const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
    return withLeading.length > 1
      ? withLeading.replace(/\/+$/, '')
      : withLeading;
  };

  const record = (canonicalPath: string) => {
    const normalized = normalizeJoined(canonicalPath || '/');
    const key = toTanstackPath(normalized);
    if (!canonicalParams.has(key)) {
      canonicalParams.set(key, paramsTypeForCanonicalPath(normalized));
    }
  };

  const visit = (route: CanonicalAwareRoute, parentPath: string) => {
    let currentPath = parentPath;

    if (typeof route.modernCanonicalPath === 'string') {
      hasI18nSurface = true;
      currentPath = normalizeJoined(route.modernCanonicalPath);
    } else if (typeof route.path === 'string' && route.path.length > 0) {
      const segments = route.path
        .replace(/\[(.+?)\]/g, ':$1')
        .split('/')
        .filter(Boolean);
      if (
        localeParamHeuristic &&
        parentPath === '' &&
        LOCALE_PARAM_SEGMENTS.has(segments[0])
      ) {
        hasI18nSurface = true;
        segments.shift();
      }
      currentPath = segments.length
        ? normalizeJoined(`${parentPath}/${segments.join('/')}`)
        : parentPath;
    }

    const children = route.children;
    if (children && children.length > 0) {
      for (const child of children) {
        visit(child, currentPath);
      }
      return;
    }

    // Leaf page or index route: a navigable target.
    record(currentPath || '/');
  };

  const rootModern = routes.find(
    route => (route as CanonicalAwareRoute).isRoot,
  ) as CanonicalAwareRoute | undefined;
  const topLevel = rootModern ? (rootModern.children ?? []) : routes;

  for (const route of topLevel) {
    visit(route as CanonicalAwareRoute, '');
  }

  if (!hasI18nSurface || canonicalParams.size === 0) {
    return null;
  }

  return Object.fromEntries(
    [...canonicalParams.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

export async function generateTanstackRouterTypesSourceForEntry(opts: {
  appContext: AppToolsContext;
  entryName: string;
  generatedDirName?: string;
  routes: (NestedRouteForCli | PageRoute)[];
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

  const rootModern = routes.find(
    r => r && (r as any).type === 'nested' && (r as any).isRoot,
  ) as NestedRouteForCli | undefined;

  const topLevel = rootModern
    ? ((rootModern as any).children as Array<NestedRouteForCli | PageRoute>) ||
      []
    : routes;

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
    const id = (route as any).id as string | undefined;
    const base = id ? makeLegalIdentifier(id) : `r_${routeIndex++}`;
    return reserveRouteVarName(`route_${base}`);
  };

  const buildRoute = async (opts: {
    parentVar: string;
    route: NestedRouteForCli | PageRoute;
  }): Promise<string> => {
    const { parentVar, route } = opts;

    const varName = createRouteVarName(route);

    const loaderInfo = pickModernLoaderModule(route);
    const routeAction = (route as any).action;
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

    const rawPath = (route as any).path as string | undefined;
    const hasSplat = typeof rawPath === 'string' && rawPath.includes('*');

    const routeOpts: string[] = [`getParentRoute: () => ${parentVar},`];

    const componentName = await getImportNameForComponent(
      (route as any)._component,
    );
    if (componentName) {
      routeOpts.push(`component: ${componentName},`);
    }

    if (isPathlessLayout(route)) {
      const id = (route as any).id as string | undefined;
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
      modernRouteId: (route as any).id as string | undefined,
      loaderName,
      actionName,
    });
    if (staticDataSnippet) {
      routeOpts.push(staticDataSnippet);
    }

    const children = (route as any).children as
      | Array<NestedRouteForCli | PageRoute>
      | undefined;
    const hasChildren = Boolean(children && children.length > 0);
    const routeCtorVarName = hasChildren
      ? reserveRouteVarName(`${varName}__base`)
      : varName;

    statements.push(
      `const ${routeCtorVarName} = createRoute({\n  ${routeOpts.join('\n  ')}\n});`,
    );

    if (children && children.length > 0) {
      const childVars = await Promise.all(
        children.map(child =>
          buildRoute({ parentVar: routeCtorVarName, route: child }),
        ),
      );
      statements.push(
        `const ${varName} = ${routeCtorVarName}.addChildren([${childVars.join(', ')}]);`,
      );
    }

    return varName;
  };

  const rootLoaderInfo = rootModern ? pickModernLoaderModule(rootModern) : null;
  const rootAction = (rootModern as any)?.action;
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

  const topLevelVars = await Promise.all(
    topLevel.map(route => buildRoute({ parentVar: 'rootRoute', route })),
  );

  const rootOpts: string[] = [];

  const rootComponentName = await getImportNameForComponent(
    (rootModern as any)?._component,
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
      modernRouteId: (rootModern as any)?.id as string | undefined,
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
