import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  emitNativeEntryApplication,
  type NativeApplicationSourceOptions,
  resolveNativeEntryIdentity,
  writeNativeEntryModules,
} from '../../native-composition/native-entry';
import { findNativeFederationConfig } from '../../native-composition/native-federation-files';
import type { NativeEntryGenerator } from '../../native-composition/native-infrastructure';
import { emitSolidNativeRouteModule } from './routes';

const i18nClientApplication = `import { ApplicationRouter } from "@modern-js/renderer-solid/router";
import { I18nProvider } from "@modern-js/renderer-solid/i18n";
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createNativeRouter } from './routes.client';
import { clientI18nHandoff, createI18n, i18nProviderInstance, i18nRouterRewrite, i18nRouting, syncI18nWithRouter } from './i18n';
export async function loadApplication(identity: RendererIdentity, hydrating: boolean) {
  // The server's language and bundles arrive in the document: no flash, no refetch.
  const handoff = clientI18nHandoff();
  const i18n = await createI18n(handoff.language, handoff.resources);
  const router = createNativeRouter({ identity, rewrite: i18nRouterRewrite(() => i18n.language) });
  syncI18nWithRouter(router, i18n);
  if (!hydrating) await router.load();
  return { view: () => <I18nProvider instance={i18nProviderInstance(i18n)} languages={i18nRouting.languages} localisedUrls={i18nRouting.localisedUrls}><ApplicationRouter router={router} /></I18nProvider> };
}
`;

function applicationSource({
  mode,
  routed,
  source,
  i18n,
}: NativeApplicationSourceOptions): string {
  if (routed && i18n && mode === 'client') return i18nClientApplication;
  if (routed) {
    return mode === 'client'
      ? `import { ApplicationRouter } from "@modern-js/renderer-solid/router";
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createNativeRouter } from './routes.client';
export async function loadApplication(identity: RendererIdentity, hydrating: boolean) {
  const router = createNativeRouter({ identity });
  if (!hydrating) await router.load();
  return { view: () => <ApplicationRouter router={router} /> };
}
`
      : "export { createNativeRouter, dataModules } from './routes.server';\n";
  }
  return mode === 'server'
    ? `import App from ${JSON.stringify(source)};\nexport default function view() { return <App />; }\n`
    : `import App from ${JSON.stringify(source)};\nimport type { RendererIdentity } from '@modern-js/renderer-core/identity';\nexport async function loadApplication(_identity: RendererIdentity, _hydrating: boolean) { return { view: () => <App /> }; }\n`;
}

function clientSource(identity: RendererIdentity): string {
  return `import { mountApplication, hydrateApplication, readSolidDocumentBootstrap as readDocumentBootstrap } from '@modern-js/renderer-solid/client';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
const mountElement = document.getElementById('root');
if (!mountElement) throw new Error('The native application mount element is missing');
const root: HTMLElement = mountElement;
const payload = document.getElementById('__ULTRAMODERN_RENDERER__');
const bootstrap = payload ? readDocumentBootstrap(document, rendererIdentity) : undefined;
const startupController = new AbortController();
let disposed = false;
let dispose: (() => void) | undefined;
interface NativeEntryHot { dispose(callback: () => void): void; }
function isNativeEntryHot(value: unknown): value is NativeEntryHot {
  return typeof value === 'object' && value !== null && 'dispose' in value && typeof value.dispose === 'function';
}
const hot = (import.meta as ImportMeta & { readonly webpackHot?: unknown }).webpackHot;
if (isNativeEntryHot(hot)) hot.dispose(() => { disposed = true; startupController.abort(new DOMException('The application entry was disposed', 'AbortError')); dispose?.(); });

async function start(): Promise<void> {
  const module = await import('./application.client');
  const application = await module.loadApplication(rendererIdentity, bootstrap?.hydrating ?? false);
  if (disposed) return;
  dispose = (bootstrap?.hydrating ? hydrateApplication : mountApplication)(application.view, root, bootstrap ? { renderId: bootstrap.documentId } : {});
}
void start().catch(error => { if (!disposed) queueMicrotask(() => { throw error; }); });
`;
}

function serverSource(
  identity: RendererIdentity,
  routed: boolean,
  i18n: boolean,
): string {
  const csrDocument = i18n
    ? `const requestLanguage = resolveRequestLanguage(request, i18nRouting);
  if (requestLanguage.kind === 'redirect') return respondApplicationResponse(context.session, createRequestLanguageRedirect(requestLanguage.location));
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return renderCSRDocument({ session: context.session, document: { ...document, renderId: document.documentId, lang: requestLanguage.language, inlineData: [createI18nSsrHandoffInlineData({ language: requestLanguage.language })] } });`
    : `if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return renderCSRDocument({ session: context.session, document: { ...document, renderId: document.documentId } });`;
  const common = `import { renderDocumentApplication, renderCSRDocument, runApplicationRequest${routed ? ', respondApplicationResponse' : ''} } from '@modern-js/renderer-solid/server';${
    i18n
      ? `
import { createI18nSsrHandoffInlineData, createRequestLanguageRedirect, resolveRequestLanguage } from '@modern-js/renderer-solid/i18n';
import { createI18n, i18nHandoff, i18nRouterRewrite, i18nRouting } from './i18n';`
      : ''
  }
import { validateSolidModuleManifest } from '@modern-js/renderer-solid/manifest';
import { assertRendererIdentity, type RendererIdentity } from '@modern-js/renderer-core/identity';
import type { NativeRequestContext } from '@modern-js/renderer-core/server';
export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
function prepare(request: Request, context: NativeRequestContext) {
  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  if (request !== context.session.request) throw new Error('Native request/session ownership mismatch');
  const manifest = validateSolidModuleManifest(context.nativeManifest, rendererIdentity);
  return { documentId: crypto.randomUUID(), rootId: 'root', ...(context.nonce === undefined ? {} : { nonce: context.nonce }), ...(context.assets === undefined ? {} : { assets: context.assets }), manifest: manifest.modules };
}
export function nativeCSRRequestHandler(request: Request, context: NativeRequestContext): Response | Promise<Response> {
  return runApplicationRequest(context.session, async () => {
  const document = prepare(request, context);
  ${csrDocument}
  });
}
`;
  if (!routed) {
    return `${common}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
  return runApplicationRequest(context.session, async () => {
  const document = prepare(request, context);
  const { default: App } = await import('./application.server');
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return renderDocumentApplication({ session: context.session, view: App, document: { ...document, renderId: document.documentId } });
  });
}
export default nativeRequestHandler;
`;
  }
  return `${common}
import { selectApplicationDataRoute, prepareRouterMatchTransfer, getApplicationStatus, resolveApplicationRedirect } from '@modern-js/renderer-solid/router';
import { handleDataRequest, mergeDataResponseMetadata, dataMetadataToDocumentPolicy, mergeDataResponseIntoResponse } from '@modern-js/renderer-core/data';
import type { DataOutcome, DecodedDataOutcome } from '@modern-js/renderer-core/data';
import { routerView } from './router-view.server';
export async function nativeMatchRouteIds(request: Request, context: NativeRequestContext): Promise<readonly string[]> {
  return runApplicationRequest(context.session, async () => {
  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  if (request !== context.session.request) throw new Error('Native request/session ownership mismatch');
  const { createNativeRouter } = await import('./application.server');
  const router = createNativeRouter({ identity: rendererIdentity, request, context: context.session.platform.bindings, session: context.session${i18n ? ', rewrite: i18nRouterRewrite(() => resolveRequestLanguage(request, i18nRouting).language)' : ''} });
  return router.matchRoutes(router.latestLocation).map(match => {
    const data = router.routesById[match.routeId]?.options.staticData;
    return data && 'ultramodernRouteId' in data && typeof data.ultramodernRouteId === 'string' ? data.ultramodernRouteId : undefined;
  }).filter((id): id is string => typeof id === 'string');
  });
}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
  return runApplicationRequest(context.session, async () => {
  const document = prepare(request, context);
  const nativeRequest = new Request(request, { signal: context.session.signal });
  const { createNativeRouter, dataModules } = await import('./application.server');${
    i18n
      ? `
  // One isolated i18next instance per request; the URL decides its language.
  const requestLanguage = resolveRequestLanguage(nativeRequest, i18nRouting);
  const i18n = await createI18n(requestLanguage.language);`
      : ''
  }
  const outcomes: DataOutcome[] = [];
  const router = createNativeRouter({ identity: rendererIdentity, request: nativeRequest, context: context.session.platform.bindings, onOutcome: (_routeId: string, outcome: DataOutcome | DecodedDataOutcome) => {
    if ('response' in outcome) outcomes.push(outcome);
    else if (outcome.completion) {
      const completion = outcome.completion;
      void completion.catch(error => context.session.fail(error));
      context.session.registerCleanup(() => completion);
    }
  }, session: context.session, nonce: context.nonce${i18n ? ', rewrite: i18nRouterRewrite(() => i18n.language)' : ''} });
  const dataResponse = await handleDataRequest({ request: nativeRequest, identity: rendererIdentity, context: context.session.platform.bindings, privateValues: [context, context.session, context.session.platform, context.session.platform.bindings], selectRoute: (request, routeId, operation) => selectApplicationDataRoute(router, request, routeId, operation, dataModules) });
  if (dataResponse) return respondApplicationResponse(context.session, dataResponse);${
    i18n
      ? `
  if (requestLanguage.kind === 'redirect') return respondApplicationResponse(context.session, createRequestLanguageRedirect(requestLanguage.location));`
      : ''
  }
  await router.load();
  prepareRouterMatchTransfer(router, context.session, [context, context.session, context.session.platform, context.session.platform.bindings, nativeRequest]);
  const metadata = mergeDataResponseMetadata(outcomes, { status: getApplicationStatus(router) });
  const redirect = resolveApplicationRedirect(router);
  if (redirect) return respondApplicationResponse(context.session, mergeDataResponseIntoResponse(redirect, metadata));
  context.session.resolveResponse(dataMetadataToDocumentPolicy(metadata));
  return renderDocumentApplication({ session: context.session, view: () => routerView(router${i18n ? ', i18n' : ''}), document: { ...document, renderId: document.documentId${i18n ? ', lang: i18n.language, inlineData: [i18nHandoff(i18n)]' : ''} } });
  });
}
export default nativeRequestHandler;
`;
}

/**
 * A federated server entry reaches the renderer through an import() boundary,
 * like the federated client entry: the Module Federation share scope must
 * initialize before the entry consumes the shared Solid singletons.
 */
function federatedServerSource(
  identity: RendererIdentity,
  routed: boolean,
): string {
  const handlers = [
    'nativeCSRRequestHandler',
    'nativeRequestHandler',
    ...(routed ? ['nativeMatchRouteIds'] : []),
  ];
  return `import type { NativeRequestContext } from '@modern-js/renderer-core/server';
export const rendererIdentity = Object.freeze(${JSON.stringify(identity)});
const handlers = () => import('./handlers.server');
${handlers
  .map(
    name =>
      `export async function ${name}(request: Request, context: NativeRequestContext) {
  return (await handlers()).${name}(request, context);
}`,
  )
  .join('\n')}
export default nativeRequestHandler;
`;
}

/** Solid owns its application lifecycle and native request handling. */
export function createSolidNativeEntryGenerator(): NativeEntryGenerator {
  return {
    async client(context) {
      const identity = resolveNativeEntryIdentity(context, 'solid');
      await emitNativeEntryApplication(context, 'client', {
        applicationSource,
        routeSource: emitSolidNativeRouteModule,
      });
      return clientSource(identity);
    },
    async server(context) {
      const identity = resolveNativeEntryIdentity(context, 'solid');
      const { routed, directory } = await emitNativeEntryApplication(
        context,
        'server',
        {
          applicationSource,
          routeSource: emitSolidNativeRouteModule,
        },
      );
      if (routed) {
        await writeNativeEntryModules(directory, {
          'router-view.server.tsx': context.i18n
            ? `import { ApplicationRouter, type AnyRouter } from '@modern-js/renderer-solid/router';
import { I18nProvider } from '@modern-js/renderer-solid/i18n';
import { type I18nInstance, i18nProviderInstance, i18nRouting } from './i18n';
export function routerView(router: AnyRouter, i18n: I18nInstance) { return <I18nProvider instance={i18nProviderInstance(i18n)} languages={i18nRouting.languages} localisedUrls={i18nRouting.localisedUrls}><ApplicationRouter router={router} /></I18nProvider>; }
`
            : "import { ApplicationRouter, type AnyRouter } from '@modern-js/renderer-solid/router';\nexport function routerView(router: AnyRouter) { return <ApplicationRouter router={router} />; }\n",
        });
      }
      const server = serverSource(identity, routed, Boolean(context.i18n));
      if (!findNativeFederationConfig(context.appDirectory)) return server;
      await writeNativeEntryModules(directory, {
        'handlers.server.tsx': server,
      });
      return federatedServerSource(identity, routed);
    },
  };
}
