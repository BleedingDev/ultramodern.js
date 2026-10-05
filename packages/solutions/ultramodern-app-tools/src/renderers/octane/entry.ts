import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  emitNativeEntryApplication,
  type NativeApplicationSourceOptions,
  resolveNativeEntryIdentity,
} from '../../native-composition/native-entry';
import type { NativeEntryGenerator } from '../../native-composition/native-infrastructure';
import { emitOctaneNativeRouteModule } from './routes';

function applicationSource({
  mode,
  routed,
  source,
}: NativeApplicationSourceOptions): string {
  if (routed) {
    return mode === 'client'
      ? `import { OctaneRouterRoot, prepareOctaneRouterHydration } from '@modern-js/renderer-octane/router-client';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createNativeRouter } from './routes.client';
export async function loadApplication(identity: RendererIdentity, hydrating: boolean, signal?: AbortSignal) {
  const router = createNativeRouter(identity);
  if (hydrating) await prepareOctaneRouterHydration(router, signal ? { signal } : {});
  else await router.load();
  return { default: OctaneRouterRoot, props: { router } };
}
`
      : "export { createNativeRouter, dataModules } from './routes.server';\n";
  }
  return mode === 'server'
    ? `export { default } from ${JSON.stringify(source)};\n`
    : `import App from ${JSON.stringify(source)};\nimport type { RendererIdentity } from '@modern-js/renderer-core/identity';\nexport async function loadApplication(_identity: RendererIdentity, _hydrating: boolean, _signal?: AbortSignal) { return { default: App }; }\n`;
}

function clientSource(identity: RendererIdentity): string {
  return `import { mountOctaneApplication, hydrateOctaneApplication, readOctaneDocumentBootstrap as readDocumentBootstrap } from '@modern-js/renderer-octane/client';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
declare const __webpack_hash__: string;
const nativeHydrationBuildId = __webpack_hash__;
export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
const mountElement = document.getElementById('root');
if (!mountElement) throw new Error('The native application mount element is missing');
const root: HTMLElement = mountElement;
const payload = document.getElementById('__ULTRAMODERN_RENDERER__');
const bootstrap = payload ? readDocumentBootstrap(document, rendererIdentity, nativeHydrationBuildId) : undefined;
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
  const options = {
    container: root,
    identity: rendererIdentity,
    nativeHydrationBuildId,
    signal: startupController.signal,
    load: async () => {
      const module = await import('./application.client');
      if (disposed) throw new Error('The application entry was disposed while loading');
      return module.loadApplication(rendererIdentity, bootstrap?.hydrating ?? false, startupController.signal);
    },
  };
  const application = bootstrap?.hydrating
    ? await hydrateOctaneApplication({ ...options, documentIdentity: bootstrap.identity, documentId: bootstrap.documentId, documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId })
    : await mountOctaneApplication(options);
  dispose = () => application.dispose();
  if (disposed) dispose();
}
void start().catch(error => { if (!disposed) queueMicrotask(() => { throw error; }); });
`;
}

function serverSource(identity: RendererIdentity, routed: boolean): string {
  const common = `import { renderOctaneApplication, renderOctaneCSRDocument } from '@modern-js/renderer-octane/server';
import { validateOctaneModuleManifest } from '@modern-js/renderer-octane/manifest';
import { assertRendererIdentity, type RendererIdentity } from '@modern-js/renderer-core/identity';
import type { NativeRequestContext } from '@modern-js/renderer-core/server';
export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
function prepare(request: Request, context: NativeRequestContext) {
  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  if (request !== context.session.request) throw new Error('Native request/session ownership mismatch');
  const manifest = validateOctaneModuleManifest(context.nativeManifest, rendererIdentity);
  return { documentId: crypto.randomUUID(), rootId: 'root', ...(context.nonce === undefined ? {} : { nonce: context.nonce }), ...(context.assets === undefined ? {} : { assets: context.assets }), nativeHydrationBuildId: manifest.nativeHydrationBuildId };
}
export function nativeCSRRequestHandler(request: Request, context: NativeRequestContext): Response | Promise<Response> {
  const document = prepare(request, context);
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return renderOctaneCSRDocument({ session: context.session, document: document });
}
`;
  if (!routed) {
    return `${common}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
  const document = prepare(request, context);
  const { default: App } = await import('./application.server');
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return renderOctaneApplication({ session: context.session, App, document });
}
export default nativeRequestHandler;
`;
  }
  return `${common}
import { matchApplicationRoutes, selectApplicationDataRoute } from '@modern-js/renderer-octane/router';
import { createOctaneRouterInjection, createOctaneRequestHandler, createSsrStreamResponse, OctaneRouterServer } from '@modern-js/renderer-octane/router-server';
import { handleDataRequest, mergeDataResponseMetadata, collectDataHeaders, dataMetadataToDocumentPolicy, mergeDataResponseIntoResponse } from '@modern-js/renderer-core/data';
import type { DataOutcome, DecodedDataOutcome } from '@modern-js/renderer-core/data';

export async function nativeMatchRouteIds(request: Request): Promise<readonly string[]> {
  const { createNativeRouter } = await import('./application.server');
  const router = createNativeRouter(rendererIdentity, request);
  return matchApplicationRoutes(router, new URL(request.url)).map(match => {
    const data = router.routesById[match.routeId]?.options.staticData;
    return data && 'ultramodernRouteId' in data && typeof data.ultramodernRouteId === 'string' ? data.ultramodernRouteId : undefined;
  }).filter((id): id is string => typeof id === 'string');
}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
  const document = prepare(request, context);
  const nativeRequest = new Request(request, { signal: context.session.signal });
  const { createNativeRouter, dataModules } = await import('./application.server');
  const outcomes: DataOutcome[] = [];
  const router = createNativeRouter(rendererIdentity, nativeRequest, context.session.platform.bindings, (_routeId: string, outcome: DataOutcome | DecodedDataOutcome) => {
    if ('response' in outcome) outcomes.push(outcome);
    else if (outcome.completion) {
      const completion = outcome.completion;
      void completion.catch(error => context.session.fail(error));
      context.session.registerCleanup(() => completion);
    }
  }, context.nonce);
  const dataResponse = await handleDataRequest({ request: nativeRequest, identity: rendererIdentity, context: context.session.platform.bindings, privateValues: [context, context.session, context.session.platform, context.session.platform.bindings], selectRoute: (request, routeId, operation) => selectApplicationDataRoute(router, request, routeId, operation, dataModules) });
  if (dataResponse) return dataResponse;
  const response = await createOctaneRequestHandler({ request: nativeRequest, session: context.session, createRouter: () => router, serialization: { forbiddenValues: [context, context.session, context.session.platform, context.session.platform.bindings, nativeRequest] } })(async ({ router, responseHeaders }) => {
    const metadata = mergeDataResponseMetadata(outcomes, { status: router.state.statusCode ?? 200 });
    context.session.resolveResponse(dataMetadataToDocumentPolicy({ ...metadata, headers: [...collectDataHeaders(responseHeaders), ...metadata.headers] }));
    const injection = createOctaneRouterInjection(router, context.session);
    const response = await renderOctaneApplication({ session: context.session, App: OctaneRouterServer, props: { router }, document, injection });
    return createSsrStreamResponse(router, response);
  });
  return context.session.committedPolicy ? response : mergeDataResponseIntoResponse(response, mergeDataResponseMetadata(outcomes, { status: response.status }));
}
export default nativeRequestHandler;
`;
}

/** Octane owns its application lifecycle and native request handling. */
export function createOctaneNativeEntryGenerator(): NativeEntryGenerator {
  return {
    async client(context) {
      const identity = resolveNativeEntryIdentity(context, 'octane');
      await emitNativeEntryApplication(context, 'client', {
        applicationSource,
        routeSource: emitOctaneNativeRouteModule,
      });
      return clientSource(identity);
    },
    async server(context) {
      const identity = resolveNativeEntryIdentity(context, 'octane');
      const { routed } = await emitNativeEntryApplication(context, 'server', {
        applicationSource,
        routeSource: emitOctaneNativeRouteModule,
      });
      return serverSource(identity, routed);
    },
  };
}
