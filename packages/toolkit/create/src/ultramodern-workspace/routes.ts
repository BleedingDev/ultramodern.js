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
  return `export type JsonLdPrimitive = string | number | boolean | null;
export type JsonLdValue =
  | JsonLdPrimitive
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue };
export type JsonLdObject = Readonly<Record<string, JsonLdValue>>;
export type RouteJsonLd = JsonLdObject | readonly JsonLdObject[];

const schemaContext = 'https://schema.org' as const;

type SchemaObject<TType extends string> = JsonLdObject & {
  readonly '@context': typeof schemaContext;
  readonly '@type': TType;
};

type ThingReference =
  | string
  | {
      readonly '@id'?: string;
      readonly '@type'?: string;
      readonly name?: string;
      readonly url?: string;
    };

const withSchemaContext = <TType extends string, TInput extends object>(
  type: TType,
  input: TInput,
): SchemaObject<TType> & TInput => ({
  '@context': schemaContext,
  '@type': type,
  ...input,
});

export const defineRouteJsonLd = <TJsonLd extends RouteJsonLd>(
  jsonLd: TJsonLd,
): TJsonLd => jsonLd;

export interface WebPageJsonLdInput {
  readonly name: string;
  readonly url: string;
  readonly description?: string;
  readonly inLanguage?: string | readonly string[];
  readonly isPartOf?: ThingReference;
}

export const webPageJsonLd = (input: WebPageJsonLdInput) =>
  withSchemaContext('WebPage', input);

export interface WebApplicationJsonLdInput {
  readonly name: string;
  readonly url: string;
  readonly applicationCategory?: string;
  readonly browserRequirements?: string;
  readonly description?: string;
  readonly operatingSystem?: string;
}

export const webApplicationJsonLd = (input: WebApplicationJsonLdInput) =>
  withSchemaContext('WebApplication', input);

export interface SoftwareApplicationJsonLdInput {
  readonly name: string;
  readonly url: string;
  readonly applicationCategory?: string;
  readonly applicationSubCategory?: string;
  readonly description?: string;
  readonly offers?: ThingReference;
  readonly operatingSystem?: string;
}

export const softwareApplicationJsonLd = (
  input: SoftwareApplicationJsonLdInput,
) => withSchemaContext('SoftwareApplication', input);

export interface OrganizationJsonLdInput {
  readonly name: string;
  readonly url?: string;
  readonly logo?: string;
  readonly sameAs?: readonly string[];
}

export const organizationJsonLd = (input: OrganizationJsonLdInput) =>
  withSchemaContext('Organization', input);

export interface BreadcrumbListItemInput {
  readonly name: string;
  readonly item: string;
}

export const breadcrumbListJsonLd = (
  items: readonly BreadcrumbListItemInput[],
) =>
  withSchemaContext('BreadcrumbList', {
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      item: entry.item,
      name: entry.name,
      position: index + 1,
    })),
  });

export interface FAQPageQuestionInput {
  readonly name: string;
  readonly acceptedAnswer: {
    readonly text: string;
  };
}

export const faqPageJsonLd = (questions: readonly FAQPageQuestionInput[]) =>
  withSchemaContext('FAQPage', {
    mainEntity: questions.map(question => ({
      '@type': 'Question',
      acceptedAnswer: {
        '@type': 'Answer',
        text: question.acceptedAnswer.text,
      },
      name: question.name,
    })),
  });
`;
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
