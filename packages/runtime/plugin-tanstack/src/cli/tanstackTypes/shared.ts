// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { getPathWithoutExt } from '@modern-js/runtime/cli';
import type { NestedRouteForCli, PageRoute } from '@modern-js/types';
import { findExists, formatImportPath, slash } from '@modern-js/utils';

import { createRouteStaticData } from '../../shared/routeStaticData';

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

export { toTanstackPath } from '../../runtime/routeTree/paths';

export async function resolveFileNoExt(inputNoExtPath: string) {
  const file = findExists(JS_OR_TS_EXTS.map(ext => `${inputNoExtPath}${ext}`));
  return file ? getPathWithoutExt(file) : null;
}

export function quote(str: string) {
  return JSON.stringify(str);
}

export function normalizeRelativeImport(p: string) {
  const normalized = formatImportPath(slash(p));
  if (normalized.startsWith('.')) {
    return normalized;
  }
  return `./${normalized}`;
}

type RouteExtras = {
  data?: unknown;
  loader?: unknown;
  validateSearch?: unknown;
  loaderDeps?: unknown;
  type?: unknown;
  index?: unknown;
  path?: unknown;
};

export function pickModernLoaderModule(route: NestedRouteForCli | PageRoute) {
  const extras = route as RouteExtras;
  const loaderPath = extras.data || extras.loader;
  if (!loaderPath || typeof loaderPath !== 'string') {
    return null;
  }

  const inline = Boolean(extras.data);
  return { loaderPath, inline };
}

export function pickRouteSearchContractModules(
  route: NestedRouteForCli | PageRoute,
) {
  const extras = route as RouteExtras;
  const validateSearchPath = extras.validateSearch;
  const loaderDepsPath = extras.loaderDeps;

  return {
    validateSearchPath:
      typeof validateSearchPath === 'string' ? validateSearchPath : null,
    loaderDepsPath: typeof loaderDepsPath === 'string' ? loaderDepsPath : null,
  };
}

export function isPathlessLayout(route: NestedRouteForCli | PageRoute) {
  const extras = route as RouteExtras;
  return (
    extras.type === 'nested' &&
    typeof extras.index !== 'boolean' &&
    typeof extras.path === 'undefined'
  );
}

export function isIndexRoute(route: NestedRouteForCli | PageRoute) {
  const extras = route as RouteExtras;
  return extras.type === 'nested' && Boolean(extras.index);
}

export function createRouteStaticDataSnippet(opts: {
  modernRouteId?: string;
  loaderName?: string | null;
  actionName?: string | null;
}) {
  const staticData = createRouteStaticData({
    modernRouteId: opts.modernRouteId && quote(opts.modernRouteId),
    modernRouteLoader: opts.loaderName,
    modernRouteAction: opts.actionName,
  });
  const entries = Object.entries(staticData);
  return entries.length > 0
    ? `staticData: createRouteStaticData({\n    ${entries
        .map(([key, value]) => `${key}: ${value},`)
        .join('\n    ')}\n  }),`
    : null;
}
