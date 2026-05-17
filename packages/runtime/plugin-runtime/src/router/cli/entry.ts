// @effect-diagnostics nodeBuiltinImport:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import type { Entrypoint } from '@modern-js/types';
import { fs } from '@modern-js/utils';
import path from 'path';
import { hasApp } from '../../cli/entry';
import { NESTED_ROUTES_DIR } from './constants';

export const ROUTES_DIR_META_KEY = '__modernRoutesDir';
export const ROUTES_OWNER_META_KEY = '__modernRoutesOwner';
export const BUILT_IN_ROUTES_OWNER = '@modern-js/plugin-router';

export type EntrypointWithRoutesMeta = Entrypoint & {
  [ROUTES_DIR_META_KEY]?: string;
  [ROUTES_OWNER_META_KEY]?: string;
};

export const getEntrypointRoutesDir = (entrypoint: {
  [ROUTES_DIR_META_KEY]?: string;
  nestedRoutesEntry?: string;
}) => {
  if (entrypoint[ROUTES_DIR_META_KEY]) {
    return entrypoint[ROUTES_DIR_META_KEY];
  }

  if (entrypoint.nestedRoutesEntry) {
    return path.basename(entrypoint.nestedRoutesEntry);
  }

  return null;
};

export const getEntrypointRoutesOwner = (entrypoint: {
  [ROUTES_OWNER_META_KEY]?: string;
}) => {
  return entrypoint[ROUTES_OWNER_META_KEY] || null;
};

export const hasNestedRoutes = (dir: string, routesDir = NESTED_ROUTES_DIR) =>
  fs.existsSync(path.join(dir, routesDir));

export const isRouteEntry = (dir: string, routesDir = NESTED_ROUTES_DIR) => {
  if (hasNestedRoutes(dir, routesDir)) {
    return path.join(dir, routesDir);
  }
  return false;
};

export const modifyEntrypoints = (
  entrypoints: Entrypoint[],
  routesDir = NESTED_ROUTES_DIR,
  routesOwner?: string,
) => {
  return entrypoints.map(entrypoint => {
    const entrypointWithMeta = entrypoint as EntrypointWithRoutesMeta;

    if (!entrypoint.isAutoMount) {
      return entrypointWithMeta;
    }
    if (entrypoint?.isCustomSourceEntry) {
      if (entrypoint.fileSystemRoutes) {
        entrypointWithMeta.nestedRoutesEntry =
          entrypoint.absoluteEntryDir || entrypoint.entry;
        entrypointWithMeta[ROUTES_DIR_META_KEY] = routesDir;
        if (routesOwner) {
          entrypointWithMeta[ROUTES_OWNER_META_KEY] = routesOwner;
        }
      }
      return entrypointWithMeta;
    }
    const isHasApp = hasApp(entrypoint.absoluteEntryDir!);
    if (isHasApp) {
      return entrypointWithMeta;
    }
    const isHasNestedRoutes = hasNestedRoutes(
      entrypoint.absoluteEntryDir!,
      routesDir,
    );
    if (isHasNestedRoutes) {
      entrypointWithMeta.nestedRoutesEntry = path.join(
        entrypoint.absoluteEntryDir!,
        routesDir,
      );
      entrypointWithMeta[ROUTES_DIR_META_KEY] = routesDir;
      if (routesOwner) {
        entrypointWithMeta[ROUTES_OWNER_META_KEY] = routesOwner;
      }
    }
    return entrypointWithMeta;
  });
};
