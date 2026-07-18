import fs from 'node:fs';
import path from 'node:path';
import { createRouteHeadModule } from './app-files';
import { relativeRootFor } from './naming';
import {
  createPublicHeadRobotsPolicy,
  createPublicSurfaceContentExpansionPolicy,
} from './policy';
import {
  createJsonLdHelperModule,
  createPublicRouteMetadata,
  createRouteAliasPage,
  createRouteMetadataModule,
  createRouteMetaFilePath,
  createRouteMetaModule,
  createRouteOwnedI18nPaths,
  createRoutePageFilePath,
  isConcretePublicPath,
  normalisePublicPath,
} from './routes';
import type {
  JsonValue,
  PublicRouteMetadata,
  PublicSurfaceSitemapFields,
  SupportedWorkspaceLanguage,
  WorkspaceApp,
} from './types';
import { supportedWorkspaceLanguages } from './types';

export const publicSurfaceManagedSourceAssetPaths = [
  'config/public/robots.txt',
  'config/public/sitemap.xml',
  'config/public/site.webmanifest',
] as const;
const publicSurfaceBaseOutputFiles = ['robots.txt'] as const;
const publicSurfacePublicRouteOutputFiles = [
  'sitemap.xml',
  'site.webmanifest',
] as const;

type PublicSurfaceRouteEntry = PublicRouteMetadata & {
  canonicalUrlPath: string;
  localeUrlPaths: Record<SupportedWorkspaceLanguage, string>;
} & PublicSurfaceSitemapFields;

export function createLocalisedPublicPath(
  pathname: string,
  language: SupportedWorkspaceLanguage,
): string {
  const publicPath = normalisePublicPath(pathname);
  return publicPath === '/' ? `/${language}` : `/${language}${publicPath}`;
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function createPublicSurfaceRouteEntries(
  app: WorkspaceApp,
): PublicSurfaceRouteEntry[] {
  return createPublicRouteMetadata(app)
    .map(route => {
      const localeUrlPaths = Object.fromEntries(
        supportedWorkspaceLanguages.map(language => [
          language,
          createLocalisedPublicPath(route.localisedPaths[language], language),
        ]),
      ) as Record<SupportedWorkspaceLanguage, string>;

      if (!Object.values(localeUrlPaths).every(isConcretePublicPath)) {
        return;
      }

      return {
        ...route,
        canonicalUrlPath: localeUrlPaths.en,
        localeUrlPaths,
      };
    })
    .filter((route): route is PublicSurfaceRouteEntry => route !== undefined)
    .sort(
      (left, right) =>
        left.canonicalUrlPath.localeCompare(right.canonicalUrlPath) ||
        left.id.localeCompare(right.id),
    );
}

function createPublicSurfaceUrlPaths(app: WorkspaceApp): string[] {
  return uniqueSorted(
    createPublicSurfaceRouteEntries(app).flatMap(route =>
      supportedWorkspaceLanguages.map(
        language => route.localeUrlPaths[language],
      ),
    ),
  );
}

function createPublicSurfaceOutputFiles(app: WorkspaceApp): string[] {
  return [
    ...publicSurfaceBaseOutputFiles,
    ...(createPublicRouteMetadata(app).length > 0
      ? publicSurfacePublicRouteOutputFiles
      : []),
  ];
}

type PublicSurfaceGenerationTarget = 'dist' | 'cloudflare-dist';

export function createPublicSurfaceGenerationCommand(
  app: WorkspaceApp,
  target: PublicSurfaceGenerationTarget,
  requirePublicOrigin = false,
): string {
  return `node ${relativeRootFor(
    app.directory,
  )}/scripts/generate-public-surface-assets.mts --app ${app.id} --target ${target}${
    requirePublicOrigin ? ' --require-public-origin' : ''
  }`;
}

/**
 * Tombstone sweep: generated apps never ship hand-authored source assets under
 * config/public, so reruns over an existing workspace remove any that crept
 * in. The same path list feeds the generated validate script's assertions.
 */
export function rewriteWorkspaceAssetsForApp(
  workspaceRoot: string,
  app: WorkspaceApp,
) {
  for (const relativePath of publicSurfaceManagedSourceAssetPaths) {
    fs.rmSync(path.join(workspaceRoot, app.directory, relativePath), {
      force: true,
    });
  }
}

function createPublicSurfaceContract(app: WorkspaceApp): JsonValue {
  const files = createPublicSurfaceOutputFiles(app);
  const contentExpansionPolicy = createPublicSurfaceContentExpansionPolicy();

  return {
    authoring: 'colocated-route-meta',
    artifactLifecycle: 'build-and-deploy-output',
    generatedManifest: './src/routes/ultramodern-route-metadata',
    source: 'route-owned-public-routes',
    metadataExport: './src/routes/ultramodern-route-metadata',
    generator: 'scripts/generate-public-surface-assets.mts',
    outputRoot: 'dist/public',
    cloudflareBuildOutputRoot: 'dist-cloudflare/public',
    privateRoutePolicy: 'omit-from-generated-public-surface',
    files,
    omittedByDefault: ['api-catalog.json', 'llms.txt', 'security.txt'],
    languages: [...supportedWorkspaceLanguages],
    contentExpansion: {
      authoring: 'route-owned-esm-provider',
      defaultProviderFile: contentExpansionPolicy.defaultProviderFile,
      entryExport: 'default-or-entries',
      paramsSource: 'params-or-localeParams',
      draftPolicy: contentExpansionPolicy.draftPolicy,
      indexablePolicy: contentExpansionPolicy.indexablePolicy,
      lifecycle: 'executed-during-public-surface-generation',
    },
    // The default scaffold ships private-only routes; users add
    // route-owned content sources when they opt routes into the public
    // surface (consumed by scripts/generate-public-surface-assets.mts).
    contentSources: [],
    publicRoutes: createPublicRouteMetadata(app),
    routeEntries: createPublicSurfaceRouteEntries(app),
    concreteUrlPaths: createPublicSurfaceUrlPaths(app),
  };
}

function createPublicHeadContract(): JsonValue {
  const robotsPolicy = createPublicHeadRobotsPolicy();

  return {
    authoring: 'colocated-route-meta',
    generator: './src/routes/ultramodern-route-head',
    renderer: '@modern-js/runtime/head Helmet',
    ssr: true,
    title: {
      required: true,
      source: 'route.titleKey',
    },
    description: {
      required: true,
      source: 'route.descriptionKey',
    },
    canonical: {
      publicIndexableOnly: true,
      source: 'localized canonical route URL',
    },
    alternates: {
      hreflang: [...supportedWorkspaceLanguages],
      xDefault: 'en',
    },
    openGraph: {
      publicIndexableOnly: true,
      required: ['og:title', 'og:description', 'og:url', 'og:type'],
    },
    twitter: {
      publicIndexableOnly: true,
      required: ['twitter:card', 'twitter:title', 'twitter:description'],
    },
    structuredData: {
      publicIndexableOnly: true,
      optional: true,
      source: 'route.jsonLd',
      inference: false,
      helperModule: './src/routes/ultramodern-jsonld',
      helperTypes: [
        'WebPage',
        'WebApplication',
        'SoftwareApplication',
        'BreadcrumbList',
        'FAQPage',
        'Organization',
      ],
      sanitizesHtmlOpenBracket: true,
    },
    privateRouteRobots: robotsPolicy.privateRouteRobots,
  };
}

type PublicWebGeneratedFile = {
  path: string;
  content: string;
};

type PublicWebAppArtifacts = {
  jsonLdHelperFile: PublicWebGeneratedFile;
  routeMetadataFile: PublicWebGeneratedFile;
  routeHeadFile: PublicWebGeneratedFile;
  routeMetaFiles: PublicWebGeneratedFile[];
  routeAliasFiles: PublicWebGeneratedFile[];
  publicHead: JsonValue;
  publicSurface: JsonValue;
};

export function createPublicWebAppArtifacts(
  app: WorkspaceApp,
): PublicWebAppArtifacts {
  const routeMetadata = createRouteOwnedI18nPaths(app);

  return {
    jsonLdHelperFile: {
      path: `${app.directory}/src/routes/ultramodern-jsonld.ts`,
      content: createJsonLdHelperModule(),
    },
    routeMetadataFile: {
      path: `${app.directory}/src/routes/ultramodern-route-metadata.ts`,
      content: createRouteMetadataModule(app),
    },
    routeHeadFile: {
      path: `${app.directory}/src/routes/ultramodern-route-head.tsx`,
      content: createRouteHeadModule(app),
    },
    routeMetaFiles: routeMetadata.map(route => ({
      path: createRouteMetaFilePath(app, route.canonicalPath),
      content: createRouteMetaModule(route),
    })),
    routeAliasFiles: routeMetadata
      .filter(route => route.canonicalPath !== '/' && app.kind !== 'shell')
      .map(route => ({
        path: createRoutePageFilePath(app, route.canonicalPath),
        content: createRouteAliasPage(route.canonicalPath),
      })),
    publicHead: createPublicHeadContract(),
    publicSurface: createPublicSurfaceContract(app),
  };
}
