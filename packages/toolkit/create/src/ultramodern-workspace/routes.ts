import { appI18nNamespace } from './descriptors';
import { renderFileTemplate } from './fs-io';
import type {
  JsonValue,
  PublicRouteMetadata,
  RouteOwnedI18nPath,
  WorkspaceApp,
} from './types';
import { sortJsonValue } from './types';

const privateAppRoutePublicness = {
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

function isPublicIndexableRoute(route: RouteOwnedI18nPath): boolean {
  return route.public && route.indexable;
}

function createLocalisedUrlsMapFromRoutes(
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

export function createPublicRouteMetadataFromRoutes(
  routes: RouteOwnedI18nPath[],
): PublicRouteMetadata[] {
  return routes.filter(isPublicIndexableRoute).map(route => {
    const metadata: PublicRouteMetadata = {
      canonicalPath: route.canonicalPath,
      id: route.id,
      localisedPaths: route.localisedPaths,
      namespace: route.namespace,
      ownerAppId: route.ownerAppId,
      descriptionKey: route.descriptionKey,
      titleKey: route.titleKey,
    };

    if (route.jsonLd !== undefined) {
      metadata.jsonLd = route.jsonLd;
    }

    return metadata;
  });
}

export function createPublicRouteMetadata(
  app: WorkspaceApp,
): PublicRouteMetadata[] {
  return createPublicRouteMetadataFromRoutes(createRouteOwnedI18nPaths(app));
}

export function createJsonLdHelperModule(): string {
  return renderFileTemplate(
    'workspace/apps/shared/src/routes/ultramodern-jsonld.ts',
    {},
  );
}

export function createRouteMetadataModule(app: WorkspaceApp): string {
  const routes = sortJsonValue(createRouteOwnedI18nPaths(app));
  const localisedUrls = sortJsonValue(createLocalisedUrlsMap(app));
  const publicRoutes = sortJsonValue(createPublicRouteMetadata(app));
  const namespace = appI18nNamespace(app);

  return renderFileTemplate(
    'workspace/apps/shared/src/routes/ultramodern-route-metadata.ts',
    {
      value0: namespace,
      value1: JSON.stringify(routes, null, 2),
      value2: JSON.stringify(localisedUrls, null, 2),
      value3: JSON.stringify(publicRoutes, null, 2),
    },
  );
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

function isDynamicPublicPathSegment(segment: string): boolean {
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

function routePathDirectorySegments(routePath: string): string[] {
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
