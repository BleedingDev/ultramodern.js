import { appI18nNamespace } from './descriptors';
import type {
  JsonValue,
  PublicRouteMetadata,
  RouteOwnedI18nPath,
  WorkspaceApp,
} from './types';
import { sortJsonValue } from './types';

export const privateAppRoutePublicness = {
  indexable: false,
  public: false,
  publicSurface: 'private-app-screen',
} as const;

export function createRouteOwnedI18nPaths(
  app: WorkspaceApp,
): RouteOwnedI18nPath[] {
  const namespace = appI18nNamespace(app);
  const base = {
    descriptionKey: `${namespace}.seo.description`,
    mfBoundaryId: app.mfName,
    namespace,
    ownerAppId: app.id,
    ...privateAppRoutePublicness,
  };

  if (app.kind === 'shell') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'shell-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'shell.title',
      },
    ];
  }

  if (app.domain === 'workspace') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'workspace-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'workspace.title',
      },
      {
        ...base,
        canonicalPath: '/workspaces',
        id: 'workspace-listing',
        localisedPaths: {
          cs: '/pracovni-prostory',
          en: '/workspaces',
        },
        titleKey: 'workspace.routes.workspaces',
      },
      {
        ...base,
        canonicalPath: '/directory',
        id: 'workspace-directory',
        localisedPaths: {
          cs: '/adresar',
          en: '/directory',
        },
        titleKey: 'workspace.routes.directory',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'workspace-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'workspace.routes.unavailable',
      },
    ];
  }

  if (app.domain === 'records') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'records-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'records.title',
      },
      {
        ...base,
        canonicalPath: '/workspaces',
        id: 'records-workspace-parent',
        localisedPaths: {
          cs: '/pracovni-prostory',
          en: '/workspaces',
        },
        titleKey: 'records.routes.workspaces',
      },
      {
        ...base,
        canonicalPath: '/records/:slug',
        id: 'records-detail',
        localisedPaths: {
          cs: '/zaznamy/:slug',
          en: '/records/:slug',
        },
        titleKey: 'records.routes.recordDetail',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'records-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'records.routes.unavailable',
      },
    ];
  }

  if (app.domain === 'actions') {
    return [
      {
        ...base,
        canonicalPath: '/',
        id: 'actions-home',
        localisedPaths: {
          cs: '/',
          en: '/',
        },
        titleKey: 'actions.title',
      },
      {
        ...base,
        canonicalPath: '/actions',
        id: 'actions-queue',
        localisedPaths: {
          cs: '/akce',
          en: '/actions',
        },
        titleKey: 'actions.routes.actions',
      },
      {
        ...base,
        canonicalPath: '/actions/review',
        id: 'actions-review',
        localisedPaths: {
          cs: '/akce/revize',
          en: '/actions/review',
        },
        titleKey: 'actions.routes.review',
      },
      {
        ...base,
        canonicalPath: '/actions/done',
        id: 'actions-done-parent',
        localisedPaths: {
          cs: '/akce/hotovo',
          en: '/actions/done',
        },
        titleKey: 'actions.routes.done',
      },
      {
        ...base,
        canonicalPath: '/actions/done/:actionId?',
        id: 'actions-done',
        localisedPaths: {
          cs: '/akce/hotovo/:actionId?',
          en: '/actions/done/:actionId?',
        },
        titleKey: 'actions.routes.done',
      },
      {
        ...base,
        canonicalPath: '/unavailable',
        id: 'actions-unavailable',
        localisedPaths: {
          cs: '/nedostupne',
          en: '/unavailable',
        },
        titleKey: 'actions.routes.unavailable',
      },
    ];
  }

  return [
    {
      ...base,
      canonicalPath: '/',
      id: `${app.id}-home`,
      localisedPaths: {
        cs: '/',
        en: '/',
      },
      titleKey: `${namespace}.title`,
    },
  ];
}

export function isPublicIndexableRoute(route: RouteOwnedI18nPath): boolean {
  return route.public && route.indexable;
}

export function createLocalisedUrlsMapFromRoutes(
  routes: RouteOwnedI18nPath[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    routes.flatMap(route => {
      if (route.canonicalPath === '/') {
        return [];
      }

      return Array.from(
        new Set([route.canonicalPath, ...Object.values(route.localisedPaths)]),
      ).map(pathname => [pathname, route.localisedPaths] as const);
    }),
  );
}

export function createLocalisedUrlsMap(
  app: WorkspaceApp,
): Record<string, JsonValue> {
  return createLocalisedUrlsMapFromRoutes(createRouteOwnedI18nPaths(app));
}

export function createPublicRouteMetadata(
  app: WorkspaceApp,
): PublicRouteMetadata[] {
  return createRouteOwnedI18nPaths(app)
    .filter(isPublicIndexableRoute)
    .map(route => ({
      canonicalPath: route.canonicalPath,
      id: route.id,
      localisedPaths: route.localisedPaths,
      namespace: route.namespace,
      ownerAppId: route.ownerAppId,
      descriptionKey: route.descriptionKey,
      titleKey: route.titleKey,
    }));
}

export function createRouteMetadataModule(app: WorkspaceApp): string {
  const routes = sortJsonValue(createRouteOwnedI18nPaths(app));
  const localisedUrls = sortJsonValue(createLocalisedUrlsMap(app));
  const publicRoutes = sortJsonValue(createPublicRouteMetadata(app));
  const namespace = appI18nNamespace(app);

  return `// @generated by @modern-js/create.
// Author route metadata in colocated src/routes/**/route.meta.ts files.
// This compatibility manifest is regenerated from route-owned metadata.

export const ultramodernRouteNamespace = '${namespace}' as const;

export const ultramodernRouteMetadata = ${JSON.stringify(routes, null, 2)} as const;

export const ultramodernLocalisedUrls = ${JSON.stringify(localisedUrls, null, 2)} as const;

export const ultramodernPublicRoutes = ${JSON.stringify(publicRoutes, null, 2)} as const;

export const ultramodernRouteConfig = {
  authoring: 'colocated-route-meta',
  generatedManifest: true,
  localisedUrls: ultramodernLocalisedUrls,
  namespace: ultramodernRouteNamespace,
  publicRoutes: ultramodernPublicRoutes,
  routes: ultramodernRouteMetadata,
  source: 'route-owned',
} as const;
`;
}

export function createRouteMetaModule(route: RouteOwnedI18nPath): string {
  return `const routeMeta = ${JSON.stringify(sortJsonValue(route), null, 2)} as const;

export default routeMeta;
export { routeMeta };
`;
}

export function normalisePublicPath(pathname: string): string {
  const normalised = pathname
    .trim()
    .replaceAll(/\/+/gu, '/')
    .replace(/\/+$/u, '');
  return normalised.length > 0 && normalised.startsWith('/')
    ? normalised
    : `/${normalised}`;
}

export function splitPublicPathSegments(pathname: string): string[] {
  return normalisePublicPath(pathname).split('/').filter(Boolean);
}

export function routePathParamName(segment: string): string | undefined {
  if (segment.startsWith(':')) {
    return segment.slice(1).replace(/[?*+]$/u, '');
  }

  if (segment.startsWith('[') && segment.endsWith(']')) {
    return segment
      .slice(1, -1)
      .replace(/^\.\.\./u, '')
      .replace(/\$$/u, '');
  }

  return undefined;
}

export function isDynamicPublicPathSegment(segment: string): boolean {
  return (
    routePathParamName(segment) !== undefined ||
    segment.includes('*') ||
    segment.startsWith('[')
  );
}

export function isConcretePublicPath(pathname: string): boolean {
  return !splitPublicPathSegments(pathname).some(isDynamicPublicPathSegment);
}

export function routeSegmentToDirectory(segment: string): string {
  const paramName = routePathParamName(segment);
  if (paramName && segment.startsWith(':')) {
    return segment.endsWith('?') ? `[${paramName}$]` : `[${paramName}]`;
  }
  return segment;
}

export function routePathDirectorySegments(routePath: string): string[] {
  return splitPublicPathSegments(routePath).map(routeSegmentToDirectory);
}

export function createRoutePageFilePath(
  app: WorkspaceApp,
  canonicalPath: string,
) {
  const segments = routePathDirectorySegments(canonicalPath);

  return `${app.directory}/src/routes/[lang]/${[...segments, 'page.tsx'].join(
    '/',
  )}`;
}

export function createRouteMetaFilePath(
  app: WorkspaceApp,
  canonicalPath: string,
) {
  const segments = routePathDirectorySegments(canonicalPath);

  return `${app.directory}/src/routes/[lang]/${[
    ...segments,
    'route.meta.ts',
  ].join('/')}`;
}

export function createRouteAliasPage(canonicalPath: string): string {
  const depth = canonicalPath.split('/').filter(Boolean).length;
  const rootPageImport = `${'../'.repeat(depth)}page`;

  return `export { default } from '${rootPageImport}';
`;
}
