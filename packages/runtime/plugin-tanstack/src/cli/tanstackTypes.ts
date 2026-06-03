// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import type { AppToolsContext } from '@modern-js/app-tools';
import type { NestedRouteForCli, PageRoute } from '@modern-js/types';
import { findExists, formatImportPath, fs, slash } from '@modern-js/utils';
import path from 'path';

const reservedWords =
  'break case class catch const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield enum await implements package protected static interface private public';
const builtins =
  'arguments Infinity NaN undefined null true false eval uneval isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape Object Function Boolean Symbol Error EvalError InternalError RangeError ReferenceError SyntaxError TypeError URIError Number Math Date String RegExp Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Float32Array Float64Array Map Set WeakMap WeakSet SIMD ArrayBuffer DataView JSON Promise Generator GeneratorFunction Reflect Proxy Intl';
const forbidList = new Set<string>(`${reservedWords} ${builtins}`.split(' '));

function makeLegalIdentifier(str: string) {
  const identifier = str
    .replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
    .replace(/[^$_a-zA-Z0-9]/g, '_');

  if (/\d/.test(identifier[0]) || forbidList.has(identifier)) {
    return `_${identifier}`;
  }
  return identifier || '_';
}

function getPathWithoutExt(filename: string) {
  const extname = path.extname(filename);
  return extname ? filename.slice(0, -extname.length) : filename;
}

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

export async function isTanstackRouterFrameworkEnabled(
  appContext: AppToolsContext,
): Promise<boolean> {
  const runtimeConfigBase = path.join(
    appContext.srcDirectory,
    appContext.runtimeConfigFile,
  );
  const runtimeConfigFile = findExists(
    JS_OR_TS_EXTS.map(ext => `${runtimeConfigBase}${ext}`),
  );
  if (!runtimeConfigFile) {
    return false;
  }

  try {
    const content = await fs.readFile(runtimeConfigFile, 'utf-8');
    // Heuristic: allow both single and double quotes, tolerate whitespace/newlines.
    return /framework\s*:\s*['"]tanstack['"]/.test(content);
  } catch {
    return false;
  }
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
  const searchContractImportMap = new Map<string, string>();
  const usedRouteVarNames = new Set<string>();
  let loaderIndex = 0;
  let validateSearchIndex = 0;
  let loaderDepsIndex = 0;
  let routeIndex = 0;

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
  modernTanstackRouterFastDefaults,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
} from '@modern-js/plugin-tanstack/runtime';

type ModernRouterContext = {
  request?: Request;
  requestContext?: unknown;
};

function isResponse(value: unknown): value is Response {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as any).status === 'number' &&
    typeof (value as any).headers === 'object'
  );
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
function isRedirectResponse(res: Response) {
  return redirectStatusCodes.has(res.status);
}

function throwTanstackRedirect(location: string) {
  const target = location.length > 0 ? location : '/';
  try {
    void new URL(target);
    throw redirect({ href: target });
  } catch {
    throw redirect({ to: target });
  }
}

function mapParamsForModernLoader(params: Record<string, string>, hasSplat: boolean) {
  if (!hasSplat) {
    return params;
  }

  const { _splat, ...rest } = params as any;
  if (typeof _splat !== 'undefined') {
    return { ...rest, '*': _splat };
  }
  return rest;
}

function createRouteStaticData(opts: {
  modernRouteId?: string;
  modernRouteAction?: unknown;
  modernRouteLoader?: unknown;
}) {
  const staticData: {
    modernRouteId?: string;
    modernRouteAction?: unknown;
    modernRouteLoader?: unknown;
  } = {};

  if (typeof opts.modernRouteId === 'string' && opts.modernRouteId.length > 0) {
    staticData.modernRouteId = opts.modernRouteId;
  }

  if (typeof opts.modernRouteLoader !== 'undefined') {
    staticData.modernRouteLoader = opts.modernRouteLoader;
  }

  if (typeof opts.modernRouteAction !== 'undefined') {
    staticData.modernRouteAction = opts.modernRouteAction;
  }

  return staticData;
}

function getLoaderSignal(ctx: any): AbortSignal {
  const abortSignal = ctx?.abortController?.signal;
  if (abortSignal instanceof AbortSignal) {
    return abortSignal;
  }
  if (ctx?.signal instanceof AbortSignal) {
    return ctx.signal;
  }
  return new AbortController().signal;
}

function getLoaderHref(ctx: any): string {
  if (typeof ctx?.location === 'string') {
    return ctx.location;
  }

  const publicHref = ctx?.location?.publicHref;
  if (typeof publicHref === 'string') {
    return publicHref;
  }

  const href = ctx?.location?.href;
  if (typeof href === 'string') {
    return href;
  }

  const urlHref = ctx?.location?.url?.href;
  return typeof urlHref === 'string' ? urlHref : '';
}

function getLoaderParams(ctx: any): Record<string, string> {
  return typeof ctx?.params === 'object' && ctx.params !== null ? ctx.params : {};
}

function handleModernLoaderResult<LoaderResult>(result: LoaderResult): LoaderResult {
  if (isResponse(result)) {
    if (isRedirectResponse(result)) {
      const location = result.headers.get('Location') ?? '/';
      throwTanstackRedirect(location);
    }
    if (result.status === 404) {
      throw notFound();
    }
  }

  return result;
}

function handleModernLoaderError(err: unknown): never {
  if (isResponse(err)) {
    if (isRedirectResponse(err)) {
      const location = err.headers.get('Location') ?? '/';
      throwTanstackRedirect(location);
    }
    if (err.status === 404) {
      throw notFound();
    }
  }

  throw err;
}

function modernLoaderToTanstack<TLoader extends (args: any) => any>(
  opts: { hasSplat: boolean },
  modernLoader: TLoader,
) {
  type LoaderResult = Awaited<ReturnType<TLoader>>;

  return (ctx: any): Promise<LoaderResult> => {
    try {
      const signal = getLoaderSignal(ctx);
      const baseRequest: Request | undefined =
        ctx?.context?.request instanceof Request ? ctx.context.request : undefined;

      const href = getLoaderHref(ctx);

      const request = baseRequest !== undefined
        ? new Request(baseRequest, { signal })
        : new Request(href, { signal });

      const params = mapParamsForModernLoader(getLoaderParams(ctx), opts.hasSplat);

      return Promise.resolve(
        (modernLoader as any)({
          request,
          params,
          context: ctx?.context?.requestContext,
        }),
      )
        .then((result: LoaderResult) => handleModernLoaderResult(result))
        .catch(handleModernLoaderError);
    } catch (err) {
      handleModernLoaderError(err);
    }
  };
}

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
