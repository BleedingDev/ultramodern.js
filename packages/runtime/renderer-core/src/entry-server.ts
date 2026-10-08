import {
  type DataOutcome,
  handleDataRequest,
  invokeRouteData,
  normalizeDataResult,
} from './data';
import type { DocumentAsset, DocumentInlineData } from './document';
import type { NativeFederationBinding } from './federation';
import { assertRendererIdentity, type RendererIdentity } from './identity';
import {
  type NativeEntryI18n,
  type NativeI18nInstance,
  type NativeI18nView,
  type NativeRequestLanguage,
  nativeI18nView,
} from './localization';
import {
  isRoutedApplication,
  matchApplicationRouteIds,
  type NativeApplicationModule,
  type NativeRoutedApplication,
  type NativeRouteMatch,
  type NativeRouteMatcher,
  type NativeRouterOptions,
  selectApplicationDataRoute,
} from './router';
import type { NativeRequestContext, NativeServerManifest } from './server';
import type { RequestSession } from './session';

export type * from './localization';
export type {
  NativeApplicationModule,
  NativeRoutedApplication,
  NativeRouterOptions,
} from './router';

/** What a generated server entry passes to its renderer. */
export interface NativeServerEntryOptions<
  Instance extends NativeI18nInstance = NativeI18nInstance,
  LocalisedUrls = unknown,
> {
  readonly identity: RendererIdentity;
  readonly federation?: NativeFederationBinding;
  /** The generated application module, imported per request. */
  readonly app: () => Promise<NativeApplicationModule>;
  readonly i18n?: NativeEntryI18n<Instance, LocalisedUrls>;
  /** The document mount element id; the client entry must use the same. */
  readonly rootId?: string;
}

/** The renderer-neutral part of one response document. */
export interface NativeServerDocument {
  readonly documentId: string;
  readonly rootId: string;
  readonly nonce?: string;
  readonly assets?: readonly DocumentAsset[];
  readonly lang?: string;
  readonly inlineData?: readonly DocumentInlineData[];
}

export interface NativeServerRoutesInput<
  Router,
  Document,
  Instance,
  LocalisedUrls,
> {
  /** The request bound to the session signal; data loaders observe it. */
  readonly request: Request;
  readonly context: NativeRequestContext;
  readonly router: Router;
  /** Blocking data outcomes, recorded while the router loads. */
  readonly outcomes: readonly DataOutcome[];
  readonly document: Document;
  /** Request-private values the router must never serialize. */
  readonly forbiddenValues: readonly object[];
  readonly i18n?: NativeI18nView<Instance, LocalisedUrls>;
}

/** The renderer's own request scope, manifest, router and document. */
export interface NativeServerAdapter<
  Router extends NativeRouteMatcher<unknown, NativeRouteMatch>,
  Document extends NativeServerDocument,
  Instance extends NativeI18nInstance,
  LocalisedUrls,
> {
  /** Validate the compiler manifest and complete the document. */
  document(
    base: NativeServerDocument,
    nativeManifest: unknown,
    identity: Readonly<RendererIdentity>,
  ): Document;
  /** Run one request inside the renderer's native request scope. */
  run<Result>(
    session: RequestSession,
    callback: () => Promise<Result>,
  ): Promise<Result>;
  /** Commit a terminal data or redirect response. */
  respond(session: RequestSession, response: Response): Response;
  createRouter(
    application: NativeRoutedApplication,
    options: NativeRouterOptions,
  ): Router;
  renderCSR(
    context: NativeRequestContext,
    document: Document,
  ): Response | Promise<Response>;
  renderComponent(
    context: NativeRequestContext,
    component: unknown,
    document: Document,
    i18n?: NativeI18nView<Instance, LocalisedUrls>,
  ): Promise<Response>;
  /** Load the router, resolve its HTTP outcome and render the document. */
  renderRoutes(
    input: NativeServerRoutesInput<Router, Document, Instance, LocalisedUrls>,
  ): Promise<Response>;
}

export type NativeServerEntry = Required<NativeServerManifest>;

function serverRouteLoader(
  application: NativeRoutedApplication,
): NativeRouterOptions['loadRoute'] {
  return async (route, input) => {
    const loader = application.dataModules[route.id]?.loader;
    if (!loader) return { kind: 'success', value: undefined, status: 200 };
    return invokeRouteData(loader, input);
  };
}

/** `vary` names the request headers a detected document language came from. */
function resolveDocumentPolicy(
  session: RequestSession,
  vary?: readonly string[],
): void {
  if (!session.responsePolicy)
    session.resolveResponse({
      kind: 'document',
      status: 200,
      headers: [
        ['content-type', 'text/html; charset=utf-8'],
        ...(vary?.length ? [['vary', vary.join(', ')] as const] : []),
      ],
      cache: { mode: 'no-store' },
    });
}

const detectedVary = (language: NativeRequestLanguage | undefined) =>
  language?.kind === 'language' ? language.vary : undefined;

/**
 * Create the native transport handlers of a generated server entry: identity
 * and session ownership, CSR and SSR documents, localized redirects, route
 * matching and the data endpoint. The renderer adapter owns its request
 * scope, router and document.
 */
export function createNativeServerEntry<
  Router extends NativeRouteMatcher<unknown, NativeRouteMatch>,
  Document extends NativeServerDocument,
  Instance extends NativeI18nInstance,
  LocalisedUrls,
>(
  options: NativeServerEntryOptions<Instance, LocalisedUrls>,
  adapter: NativeServerAdapter<Router, Document, Instance, LocalisedUrls>,
): NativeServerEntry {
  const rendererIdentity = Object.freeze({ ...options.identity });
  const { i18n } = options;

  const own = (request: Request, context: NativeRequestContext) => {
    assertRendererIdentity(context.entry, rendererIdentity);
    assertRendererIdentity(context.session.identity, rendererIdentity);
    if (request !== context.session.request)
      throw new Error('Native request/session ownership mismatch');
  };

  const prepare = (request: Request, context: NativeRequestContext) => {
    own(request, context);
    return adapter.document(
      {
        documentId: crypto.randomUUID(),
        rootId: options.rootId ?? 'root',
        ...(context.nonce === undefined ? {} : { nonce: context.nonce }),
        ...(context.assets === undefined ? {} : { assets: context.assets }),
      },
      context.nativeManifest,
      rendererIdentity,
    );
  };

  const routedApplication = async (): Promise<NativeRoutedApplication> => {
    const application = await options.app();
    if (!isRoutedApplication(application))
      throw new Error(
        'unsupported-renderer-capability: ssrByRouteIds requires native route matching.',
      );
    return application;
  };

  const nativeCSRRequestHandler = (
    request: Request,
    context: NativeRequestContext,
  ) =>
    adapter.run(context.session, async () => {
      const document = prepare(request, context);
      if (!i18n) {
        resolveDocumentPolicy(context.session);
        return adapter.renderCSR(context, document);
      }
      const language = i18n.resolveRequest(request);
      if (language.kind === 'redirect')
        return adapter.respond(
          context.session,
          i18n.redirect(language.location),
        );
      resolveDocumentPolicy(context.session, detectedVary(language));
      return adapter.renderCSR(context, {
        ...document,
        lang: language.language,
        inlineData: [i18n.handoff(language.language)],
      });
    });

  const nativeMatchRouteIds = (
    request: Request,
    context: NativeRequestContext,
  ) =>
    adapter.run(context.session, async () => {
      own(request, context);
      const application = await routedApplication();
      const router = adapter.createRouter(application, {
        identity: rendererIdentity,
        loadRoute: serverRouteLoader(application),
        request,
        context: context.session.platform.bindings,
        session: context.session,
        ...(i18n
          ? {
              rewrite: i18n.rewrite(
                () => i18n.resolveRequest(request).language,
              ),
            }
          : {}),
      });
      return matchApplicationRouteIds(router, new URL(request.url));
    });

  const nativeRequestHandler = (
    request: Request,
    context: NativeRequestContext,
  ) =>
    adapter.run(context.session, async () => {
      const document = prepare(request, context);
      const { session } = context;
      const application = await options.app();
      const routed = isRoutedApplication(application);
      const nativeRequest = routed
        ? new Request(request, { signal: session.signal })
        : request;
      // One isolated instance per request; the URL decides its language.
      const language = i18n?.resolveRequest(nativeRequest);
      if (!routed && i18n && language?.kind === 'redirect')
        return adapter.respond(session, i18n.redirect(language.location));
      // Data requests and redirects never read translations, so the instance
      // is created only once a document is about to render.
      const localize = async (
        inlineData: readonly DocumentInlineData[] = [],
      ) => {
        if (!i18n || !language) return { document, localization: undefined };
        const instance = await i18n.create(language.language);
        return {
          document: {
            ...document,
            lang: instance.language,
            inlineData: [
              ...inlineData,
              i18n.handoff(instance.language, instance),
            ],
          },
          localization: nativeI18nView(i18n, instance),
        };
      };
      if (!routed) {
        const localized = await localize(document.inlineData);
        resolveDocumentPolicy(session, detectedVary(language));
        return adapter.renderComponent(
          context,
          application.default,
          localized.document,
          localized.localization,
        );
      }
      const bindings = session.platform.bindings;
      const outcomes: DataOutcome[] = [];
      // Loaders settle in any order, but later metadata wins singleton
      // fields, so outcomes stay in matched parent-to-leaf route order.
      const outcomeRanks: number[] = [];
      let routeOrder: readonly string[] | undefined;
      const addOutcome = (rank: number, outcome: DataOutcome) => {
        const at = outcomeRanks.findIndex(other => other > rank);
        const index = at < 0 ? outcomes.length : at;
        outcomes.splice(index, 0, outcome);
        outcomeRanks.splice(index, 0, rank);
      };
      const router = adapter.createRouter(application, {
        identity: rendererIdentity,
        loadRoute: serverRouteLoader(application),
        request: nativeRequest,
        context: bindings,
        onOutcome: (routeId, outcome) => {
          if ('response' in outcome) {
            routeOrder ??= matchApplicationRouteIds(
              router,
              new URL(nativeRequest.url),
            );
            const rank = routeOrder.indexOf(routeId);
            addOutcome(rank < 0 ? Number.POSITIVE_INFINITY : rank, outcome);
          } else if (outcome.completion) {
            const completion = outcome.completion;
            void completion.catch(error => session.fail(error));
            session.registerCleanup(() => completion);
          }
        },
        session,
        ...(context.nonce === undefined ? {} : { nonce: context.nonce }),
        ...(i18n && language
          ? { rewrite: i18n.rewrite(() => language.language) }
          : {}),
      });
      const dataResponse = await handleDataRequest({
        request: nativeRequest,
        identity: rendererIdentity,
        context: bindings,
        privateValues: [context, session, session.platform, bindings],
        selectRoute: (dataRequest, routeId, operation) =>
          selectApplicationDataRoute(
            router,
            dataRequest,
            routeId,
            operation,
            application.dataModules,
          ),
      });
      if (dataResponse) return adapter.respond(session, dataResponse);
      if (i18n && language?.kind === 'redirect')
        return adapter.respond(session, i18n.redirect(language.location));
      // A header-detected language makes the document depend on those headers:
      // the header-only outcome adds `Vary` and keeps it out of public caches.
      const vary = detectedVary(language);
      if (vary?.length)
        addOutcome(
          Number.POSITIVE_INFINITY,
          await normalizeDataResult(
            new Response(null, { headers: { vary: vary.join(', ') } }),
          ),
        );
      const localized = await localize();
      return adapter.renderRoutes({
        request: nativeRequest,
        context,
        router,
        outcomes,
        document: localized.document,
        forbiddenValues: [
          context,
          session,
          session.platform,
          bindings,
          nativeRequest,
        ],
        ...(localized.localization ? { i18n: localized.localization } : {}),
      });
    });

  return {
    rendererIdentity,
    nativeRequestHandler,
    nativeCSRRequestHandler,
    nativeMatchRouteIds,
  };
}
