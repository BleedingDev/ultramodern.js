import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { RendererIdentity } from '@modern-js/renderer-core';
import type {
  NativeCompilerArtifacts,
  NativeRendererAdapter,
} from '@modern-js/renderer-core/adapter';
import {
  DATA_CONTENT_TYPE,
  DATA_STREAM_CONTENT_TYPE,
  DIRECT_PARAM,
  LOADER_ID_PARAM,
  PRERENDERED_DOCUMENT_META,
  type StaticDataPayload,
  staticDataPayloadPath,
} from '@modern-js/renderer-core/data';
import {
  dispatchNativeNodeRequest,
  type NativeServerManifest,
  validateNativeClientAssetManifest,
} from '@modern-js/renderer-core/server';
import {
  localiseTargetPathname,
  shouldSkipLocaleRedirect,
} from '@modern-js/runtime-extensions/localised-urls';
import type {
  ServerRoute,
  SSGConfig,
  SSGMultiEntryOptions,
  SSGRouteOptions,
  SSGSingleEntryOptions,
} from '@modern-js/types';
import {
  logger,
  ROUTE_SPEC_FILE,
  SERVER_BUNDLE_DIRECTORY,
} from '@modern-js/utils';
import { readRendererBuildManifest } from './native-build-manifest';
import type { NativeI18nConfig } from './native-i18n';
import {
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';
import { nativeInfrastructurePluginName } from './renderer-registration';

/** Structural route fields read from the native file-system route hook. */
export interface PrerenderRouteNode {
  id?: string;
  path?: string;
  index?: boolean;
  file?: string;
  _component?: string;
  component?: string;
  data?: string;
  children?: PrerenderRouteNode[];
}

export interface PrerenderRoute {
  entryName: string;
  /** The analyzed server route that owns this document. */
  base: ServerRoute;
  urlPath: string;
  /** Output file relative to the application's dist directory. */
  output: string;
  headers: Record<string, string>;
}

type ResolvedEntryOptions = Record<string, SSGSingleEntryOptions>;

const MAX_CONCURRENT_PRERENDERS = 10;

function joinUrl(base: string, route: string): string {
  const joined = `${base}/${route}`.replace(/\/+/gu, '/');
  return joined.length > 1 ? joined.replace(/\/$/u, '') : joined;
}

export function isDynamicUrl(url: string): boolean {
  return url.includes(':') || url.endsWith('*');
}

/** Visible document paths for one entry, as plugin-ssg derives agreed routes. */
export function flattenPrerenderRoutes(
  routes: readonly PrerenderRouteNode[],
): string[] {
  const paths = new Set<string>();
  const visit = (route: PrerenderRouteNode, parent: string | undefined) => {
    const own = route.path ?? '';
    const routePath = (
      parent === undefined ? own : `${parent}/${own}`.replace(/\/+/gu, '/')
    ).replace(/(.)\/$/u, '$1');
    const view = route.file ?? route._component ?? route.component;
    // The Set dedupes `/`; a page-only entry's root index sits under a
    // fileless root and is still a document.
    if (view) paths.add(routePath || '/');
    for (const child of route.children ?? []) visit(child, routePath);
  };
  for (const route of routes) visit(route, undefined);
  return [...paths];
}

/** Route IDs whose server loader can contribute data to a document. */
export function collectLoaderRouteIds(
  routes: readonly PrerenderRouteNode[],
): string[] {
  return routes.flatMap(route => [
    ...(route.data && route.id ? [route.id] : []),
    ...collectLoaderRouteIds(route.children ?? []),
  ]);
}

/** Normalize output.ssg / output.ssgByEntries into per-entry (or per-path) options. */
export function resolveEntrySsgOptions(options: {
  ssg: SSGConfig | SSGConfig[] | undefined;
  ssgByEntries?: SSGMultiEntryOptions;
  entryNames: readonly string[];
  pageRoutes: readonly ServerRoute[];
  baseUrl?: string | string[];
}): ResolvedEntryOptions | undefined {
  const { entryNames, pageRoutes, baseUrl, ssgByEntries } = options;
  const byBaseUrl = (
    entryName: string,
    factory: (
      entryName: string,
      context: { baseUrl?: string | string[] },
    ) => SSGSingleEntryOptions,
    result: ResolvedEntryOptions,
  ) => {
    if (!Array.isArray(baseUrl)) {
      result[entryName] = factory(entryName, { baseUrl });
      return;
    }
    for (const url of baseUrl)
      for (const route of pageRoutes)
        if (route.entryName === entryName && route.urlPath.startsWith(url))
          result[route.urlPath] = factory(entryName, { baseUrl: url });
  };
  if (ssgByEntries && Object.keys(ssgByEntries).length > 0) {
    const result: ResolvedEntryOptions = {};
    for (const [key, value] of Object.entries(ssgByEntries))
      if (typeof value !== 'function') result[key] = value;
    for (const entryName of entryNames) {
      const configured = ssgByEntries[entryName];
      if (typeof configured === 'function')
        byBaseUrl(entryName, configured, result);
    }
    return result;
  }
  const ssg = Array.isArray(options.ssg) ? options.ssg.at(-1) : options.ssg;
  if (!ssg) return undefined;
  const result: ResolvedEntryOptions = {};
  for (const entryName of entryNames) {
    if (typeof ssg === 'function') byBaseUrl(entryName, ssg, result);
    else result[entryName] = ssg;
  }
  return result;
}

function makeRoute(
  base: ServerRoute,
  route: SSGRouteOptions,
  headers: Record<string, string> = {},
): PrerenderRoute {
  const url = typeof route === 'string' ? route : route.url;
  const output =
    typeof route === 'object' && route.output
      ? path.normalize(route.output)
      : path.join(base.entryPath, `..${url === '/' ? '' : url}`);
  return {
    entryName: base.entryName!,
    base,
    urlPath: joinUrl(base.urlPath, url),
    output: path.extname(output) ? output : path.join(output, 'index.html'),
    headers: {
      ...headers,
      ...(typeof route === 'object' ? route.headers : undefined),
    },
  };
}

/**
 * Select documents with plugin-ssg semantics: file-system routes default to
 * every static path, explicit routes may name dynamic parameters, and a
 * server-rendered origin route cannot also be prerendered.
 */
export function resolvePrerenderRoutes(options: {
  pageRoutes: readonly ServerRoute[];
  entryOptions: ResolvedEntryOptions;
  routeTrees: ReadonlyMap<string, readonly PrerenderRouteNode[]>;
}): PrerenderRoute[] {
  const selected: PrerenderRoute[] = [];
  for (const pageRoute of options.pageRoutes) {
    const entryName = pageRoute.entryName!;
    const configured =
      options.entryOptions[entryName] ??
      options.entryOptions[pageRoute.urlPath];
    if (!configured) continue;
    const { routes = [], headers = {} } = configured === true ? {} : configured;
    const tree = options.routeTrees.get(entryName);
    if (routes.length > 0) {
      for (const route of routes)
        selected.push(makeRoute(pageRoute, route, headers));
    } else if (tree) {
      for (const routePath of flattenPrerenderRoutes(tree))
        if (!isDynamicUrl(routePath))
          selected.push(makeRoute(pageRoute, routePath, headers));
    } else if (configured === true) {
      selected.push(makeRoute(pageRoute, '/', headers));
    }
  }
  for (const route of selected) {
    if (!route.base.isSSR) continue;
    const origin = options.pageRoutes.some(
      pageRoute =>
        pageRoute.urlPath === route.urlPath &&
        pageRoute.entryName === route.entryName,
    );
    if (origin)
      throw new Error(
        `Static site generation cannot be combined with SSR for the same route: url ${route.urlPath}, entry ${route.entryName}. Disable server.ssr for this entry or remove it from output.ssg.`,
      );
    logger.warn(
      `Prerendered route ${route.urlPath} inherits SSR from entry ${route.entryName}; its static document replaces SSR on static hosts.`,
    );
  }
  return selected;
}

function defaultOutput(base: ServerRoute, url: string): string {
  return path.join(base.entryPath, `..${url === '/' ? '' : url}`, 'index.html');
}

/**
 * Native i18n redirects unprefixed page URLs, so each selected canonical
 * document renders once per configured language at its localized URL.
 * Routes that already carry a language prefix, and ignored redirect routes,
 * render as selected. A custom output gains a language directory.
 */
export function localizePrerenderRoutes(
  routes: readonly PrerenderRoute[],
  i18n:
    | Pick<
        NativeI18nConfig,
        'languages' | 'ignoreRedirectRoutes' | 'localisedUrls'
      >
    | undefined,
): PrerenderRoute[] {
  if (!i18n) return [...routes];
  const { languages, ignoreRedirectRoutes, localisedUrls } = i18n;
  return routes.flatMap(route => {
    const canonical = relativeRoutePath(route);
    const first = canonical.split('/').filter(Boolean)[0]?.toLowerCase();
    if (
      (first && languages.some(language => language.toLowerCase() === first)) ||
      shouldSkipLocaleRedirect(canonical, languages, ignoreRedirectRoutes)
    )
      return [route];
    const customOutput = route.output !== defaultOutput(route.base, canonical);
    return languages.map(language => {
      const localized = localiseTargetPathname(
        canonical,
        language,
        languages,
        localisedUrls,
      );
      return {
        ...route,
        urlPath: joinUrl(route.base.urlPath, localized),
        output: customOutput
          ? path.join(
              path.dirname(route.output),
              language,
              path.basename(route.output),
            )
          : defaultOutput(route.base, localized),
      };
    });
  });
}

/** Mark the document so the data client replays static loader payloads. */
export function markPrerenderedDocument(html: string): string {
  const marker = `<meta name="${PRERENDERED_DOCUMENT_META}" content="static-data">`;
  const close = html.search(/<\/head\s*>/iu);
  if (close < 0)
    throw new Error('A prerendered native document requires a <head> element');
  return `${html.slice(0, close)}${marker}${html.slice(close)}`;
}

function relativeRoutePath(route: PrerenderRoute): string {
  const base = route.base.urlPath === '/' ? '' : route.base.urlPath;
  const relative = route.urlPath.slice(base.length);
  return relative.startsWith('/') ? relative : `/${relative}`;
}

async function writeOutput(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

interface PrerenderEntry {
  identity: RendererIdentity;
  manifest: NativeServerManifest<{ loaderContext: Map<string, unknown> }>;
  assets: ReturnType<typeof validateNativeClientAssetManifest>;
  nativeManifest: unknown;
  hydrationBuildId?: string;
}

async function dispatch(entry: PrerenderEntry, request: Request) {
  return dispatchNativeNodeRequest(request, {
    identity: entry.identity,
    loadManifest: async () => entry.manifest,
    context: {
      assets: entry.assets,
      nativeManifest: entry.nativeManifest,
      bindings: { loaderContext: new Map<string, unknown>() },
      serverConfig: { ssr: true, forceCSR: false },
    },
    hydrationBuildId: entry.hydrationBuildId,
  });
}

/** Render one document and its search-free loader payloads through the built handler. */
export async function prerenderRoute(options: {
  route: PrerenderRoute;
  entry: PrerenderEntry;
  loaderRouteIds: readonly string[];
  distDirectory: string;
  dispatch?: typeof dispatch;
}): Promise<void> {
  const { route, entry, distDirectory } = options;
  const render = options.dispatch ?? dispatch;
  const url = new URL(route.urlPath, 'http://localhost');
  const response = await render(
    entry,
    new Request(url, {
      headers: {
        ...route.headers,
        accept: 'text/html',
        'x-modern-ssg-render': 'true',
      },
    }),
  );
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status !== 200 || !contentType.startsWith('text/html')) {
    await response.body?.cancel();
    throw new Error(
      `Prerendering ${route.urlPath} returned HTTP ${response.status} (${contentType || 'no content type'}); static documents require a 200 HTML response`,
    );
  }
  await writeOutput(
    path.join(distDirectory, route.output),
    markPrerenderedDocument(await response.text()),
  );
  const documentDirectory = path.join(
    distDirectory,
    path.dirname(route.base.entryPath),
  );
  for (const routeId of options.loaderRouteIds) {
    const dataUrl = new URL(url);
    dataUrl.searchParams.set(LOADER_ID_PARAM, routeId);
    dataUrl.searchParams.set(DIRECT_PARAM, 'true');
    const data = await render(
      entry,
      new Request(dataUrl, { headers: route.headers }),
    );
    const type = data.headers.get('content-type')?.split(';')[0]?.trim();
    // The handler answers 403 for loaders that do not match this document.
    if (type !== DATA_CONTENT_TYPE && type !== DATA_STREAM_CONTENT_TYPE) {
      await data.body?.cancel();
      continue;
    }
    // Payloads live under the document URL's directory, which a file-style
    // URL such as /guide.html does not have.
    if (path.posix.extname(relativeRoutePath(route))) {
      await data.body?.cancel();
      throw new Error(
        `Prerendered route ${route.urlPath} has loader data, so it needs a directory-style URL (for example ${route.urlPath.replace(/\.[^./]+$/u, '')} instead of ${route.urlPath})`,
      );
    }
    const payload: StaticDataPayload = {
      status: data.status,
      contentType: type,
      body: await data.text(),
    };
    await writeOutput(
      path.join(
        documentDirectory,
        ...staticDataPayloadPath(relativeRoutePath(route), routeId).split('/'),
      ),
      JSON.stringify(payload),
    );
  }
}

async function loadPrerenderEntry(options: {
  distDirectory: string;
  entryName: string;
  identity: RendererIdentity;
  assetManifest: unknown;
  compilerArtifacts: NativeCompilerArtifacts;
}): Promise<PrerenderEntry> {
  const { distDirectory, entryName, identity, compilerArtifacts } = options;
  const assets = validateNativeClientAssetManifest(
    options.assetManifest,
    identity,
  );
  const validated = await compilerArtifacts.validateClientManifest(
    JSON.parse(
      await fs.readFile(
        path.join(
          distDirectory,
          compilerArtifacts.clientManifestFile(entryName),
        ),
        'utf8',
      ),
    ),
    identity,
    {},
  );
  // The infrastructure plugin imported this exact URL when it validated the build.
  const module = await import(
    `${pathToFileURL(path.join(distDirectory, SERVER_BUNDLE_DIRECTORY, `${entryName}.js`)).href}?build=${identity.buildId}`
  );
  const manifest = module.rendererIdentity ? module : module.default;
  if (typeof manifest?.nativeRequestHandler !== 'function')
    throw new Error(
      `Native server entry ${entryName} has no request handler to prerender`,
    );
  return {
    identity,
    manifest,
    assets,
    nativeManifest: validated.nativeManifest,
    hydrationBuildId: validated.hydrationBuildId,
  };
}

/** Prerender output.ssg documents after the native build has been validated. */
export function nativePrerenderPlugin(
  adapter: NativeRendererAdapter,
  i18n?: NativeI18nConfig,
  /** Final per-entry route trees, shared by the infrastructure plugin. */
  finalRouteTrees?: ReadonlyMap<string, readonly unknown[]>,
): CliPlugin<AppTools> {
  const renderer = adapter.name;
  return {
    name: '@modern-js/ultramodern-native-prerender',
    pre: [nativeInfrastructurePluginName(renderer)],
    post: [
      '@modern-js/renderer-build-artifact-stamp',
      '@modern-js/ultramodern-release-envelope',
    ],
    setup(api) {
      // Without the shared final trees, fall back to this hook's view, which
      // later route modifiers can still change.
      const captured = new Map<string, readonly PrerenderRouteNode[]>();
      if (!finalRouteTrees)
        api.modifyFileSystemRoutes(({ entrypoint, routes }) => {
          captured.set(
            entrypoint.entryName,
            routes as unknown as PrerenderRouteNode[],
          );
          return { entrypoint, routes };
        });
      const routeTrees = (finalRouteTrees ?? captured) as ReadonlyMap<
        string,
        readonly PrerenderRouteNode[]
      >;
      api.onAfterBuild(async ({ stats }) => {
        const appContext = api.getAppContext();
        if (appContext.command === 'dev' || appContext.apiOnly) return;
        if (stats && 'hasErrors' in stats && stats.hasErrors()) return;
        const config = api.getNormalizedConfig();
        const { distDirectory } = appContext;
        const specification: { routes: ServerRoute[] } = JSON.parse(
          await fs.readFile(path.join(distDirectory, ROUTE_SPEC_FILE), 'utf8'),
        );
        const pageRoutes = specification.routes.filter(
          route => route.entryName && !route.isApi,
        );
        const entryOptions = resolveEntrySsgOptions({
          ssg: config.output.ssg as SSGConfig | undefined,
          ssgByEntries: config.output.ssgByEntries as
            | SSGMultiEntryOptions
            | undefined,
          entryNames: appContext.entrypoints.map(entry => entry.entryName),
          pageRoutes,
          baseUrl: config.server?.baseUrl,
        });
        if (!entryOptions) return;
        const routes = localizePrerenderRoutes(
          resolvePrerenderRoutes({ pageRoutes, entryOptions, routeTrees }),
          i18n,
        );
        if (!routes.length) return;
        const build = await readRendererBuildManifest(
          distDirectory,
          resolveRendererProfile(renderer),
          { routerFrameworks: resolveRendererRouterFrameworks(renderer) },
        );
        const assetManifest = JSON.parse(
          await fs.readFile(
            path.join(distDirectory, 'renderer-assets.json'),
            'utf8',
          ),
        );
        const entries = new Map<string, Promise<PrerenderEntry>>();
        const loadEntry = (entryName: string) => {
          const identity = build.entries[entryName];
          if (!identity)
            throw new Error(
              `Prerendered entry ${entryName} has no native build identity`,
            );
          let entry = entries.get(entryName);
          if (!entry) {
            entry = loadPrerenderEntry({
              distDirectory,
              entryName,
              identity,
              assetManifest,
              compilerArtifacts: adapter.artifacts,
            });
            entries.set(entryName, entry);
          }
          return entry;
        };
        for (
          let index = 0;
          index < routes.length;
          index += MAX_CONCURRENT_PRERENDERS
        )
          await Promise.all(
            routes
              .slice(index, index + MAX_CONCURRENT_PRERENDERS)
              .map(async route =>
                prerenderRoute({
                  route,
                  entry: await loadEntry(route.entryName),
                  loaderRouteIds: collectLoaderRouteIds(
                    routeTrees.get(route.entryName) ?? [],
                  ),
                  distDirectory,
                }),
              ),
          );
        logger.info(
          `Prerendered ${routes.length} native ${renderer} document${routes.length === 1 ? '' : 's'}`,
        );
      });
    },
  };
}
