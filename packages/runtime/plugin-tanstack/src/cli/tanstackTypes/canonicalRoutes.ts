// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { NestedRouteForCli, PageRoute } from '@modern-js/types';
import { MAIN_ENTRY_NAME } from '@modern-js/utils';

import { toTanstackPath } from './shared';

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
