import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type {
  NativeEntryGeneration,
  NativeEntryGenerator,
} from './native-infrastructure';
import {
  discoverNativeFileSystemRoutes,
  emitNativeRouteModule,
} from './native-routes';
import { resolveRendererProfile } from './renderer-profile';

const entryRoutes = new WeakMap<
  NativeEntryGeneration,
  Promise<FileSystemRouteIR[]>
>();

function entryIdentity(context: NativeEntryGeneration): RendererIdentity {
  const identity = context.rendererIdentity;
  if (
    !identity ||
    identity.renderer !== context.renderer ||
    identity.entryName !== context.entrypoint.entryName ||
    identity.protocolVersion !== 1 ||
    !identity.appId?.trim() ||
    !identity.buildId?.trim()
  ) {
    throw new Error(
      'Native entry emission requires its resolved immutable build identity',
    );
  }
  return identity;
}

function entryDirectory(context: NativeEntryGeneration): string {
  return context.entrypoint.internalEntry
    ? path.dirname(context.entrypoint.internalEntry)
    : path.join(
        context.internalDirectory,
        context.renderer,
        context.entrypoint.entryName,
      );
}

async function emitApplication(
  context: NativeEntryGeneration,
  mode: 'client' | 'server',
) {
  const directory = entryDirectory(context);
  const source = context.entrypoint.entry;
  const routed = (await fs.stat(source)).isDirectory();
  let application: string;
  if (routed) {
    let discovery = entryRoutes.get(context);
    if (!discovery) {
      discovery = discoverNativeFileSystemRoutes({
        routesDirectory: source,
        entryName: context.entrypoint.entryName,
        extensions: resolveRendererProfile(context.renderer).sourceExtensions,
      }).then(routes => context.modifyRoutes(routes));
      entryRoutes.set(context, discovery);
    }
    const routes = await discovery;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `routes.${mode}.ts`),
      emitNativeRouteModule({
        renderer: context.renderer,
        routes,
        mode,
        basePath: context.basePath,
      }),
    );
    const routerImport =
      context.renderer === 'solid'
        ? '@modern-js/renderer-solid/router'
        : '@modern-js/renderer-octane/router';
    if (mode === 'client') {
      application =
        context.renderer === 'solid'
          ? `import { ApplicationRouter } from ${JSON.stringify(routerImport)};
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createNativeRouter } from './routes.client';
export async function loadApplication(identity: RendererIdentity, hydrating: boolean) {
  const router = createNativeRouter(identity);
  if (!hydrating) await router.load();
  return { view: () => <ApplicationRouter router={router} /> };
}
`
          : `import { OctaneRouterRoot, prepareOctaneRouterHydration } from '@modern-js/renderer-octane/router-client';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createNativeRouter } from './routes.client';
export async function loadApplication(identity: RendererIdentity, hydrating: boolean, signal?: AbortSignal) {
  const router = createNativeRouter(identity);
  if (hydrating) await prepareOctaneRouterHydration(router, signal ? { signal } : {});
  else await router.load();
  return { default: OctaneRouterRoot, props: { router } };
}
`;
    } else {
      application = `export { createNativeRouter, dataModules } from './routes.server';\n`;
    }
  } else {
    application =
      mode === 'server'
        ? context.renderer === 'solid'
          ? `import App from ${JSON.stringify(source)};\nexport default function view() { return <App />; }\n`
          : `export { default } from ${JSON.stringify(source)};\n`
        : context.renderer === 'solid'
          ? `import App from ${JSON.stringify(source)};\nimport type { RendererIdentity } from '@modern-js/renderer-core/identity';\nexport async function loadApplication(_identity: RendererIdentity, _hydrating: boolean) { return { view: () => <App /> }; }\n`
          : `import App from ${JSON.stringify(source)};\nimport type { RendererIdentity } from '@modern-js/renderer-core/identity';\nexport async function loadApplication(_identity: RendererIdentity, _hydrating: boolean, _signal?: AbortSignal) { return { default: App }; }\n`;
  }
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, `application.${mode}.tsx`),
    application,
  );
  return { routed, directory };
}

function clientSource(
  renderer: 'solid' | 'octane',
  identity: RendererIdentity,
): string {
  const shared = `import type { RendererIdentity } from '@modern-js/renderer-core/identity';
${renderer === 'octane' ? 'declare const __webpack_hash__: string;\nconst nativeHydrationBuildId = __webpack_hash__;\n' : ''}export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
const mountElement = document.getElementById('root');
if (!mountElement) throw new Error('The native application mount element is missing');
const root: HTMLElement = mountElement;
const payload = document.getElementById('__ULTRAMODERN_RENDERER__');
const bootstrap = payload ? readDocumentBootstrap(document, rendererIdentity${renderer === 'octane' ? ', nativeHydrationBuildId' : ''}) : undefined;
const startupController = new AbortController();
let disposed = false;
let dispose: (() => void) | undefined;
interface NativeEntryHot { dispose(callback: () => void): void; }
function isNativeEntryHot(value: unknown): value is NativeEntryHot {
  return typeof value === 'object' && value !== null && 'dispose' in value && typeof value.dispose === 'function';
}
const hot = (import.meta as ImportMeta & { readonly webpackHot?: unknown }).webpackHot;
if (isNativeEntryHot(hot)) hot.dispose(() => { disposed = true; startupController.abort(new DOMException('The application entry was disposed', 'AbortError')); dispose?.(); });
`;
  if (renderer === 'solid') {
    return `import { mountApplication, hydrateApplication, readSolidDocumentBootstrap as readDocumentBootstrap } from '@modern-js/renderer-solid/client';
${shared}
async function start(): Promise<void> {
  const module = await import('./application.client');
  const application = await module.loadApplication(rendererIdentity, bootstrap?.hydrating ?? false);
  if (disposed) return;
  dispose = (bootstrap?.hydrating ? hydrateApplication : mountApplication)(application.view, root, bootstrap ? { renderId: bootstrap.documentId } : {});
}
void start().catch(error => { if (!disposed) queueMicrotask(() => { throw error; }); });
`;
  }
  return `import { mountOctaneApplication, hydrateOctaneApplication, readOctaneDocumentBootstrap as readDocumentBootstrap } from '@modern-js/renderer-octane/client';
${shared}
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

function serverSource(
  renderer: 'solid' | 'octane',
  identity: RendererIdentity,
  routed: boolean,
): string {
  const solid = renderer === 'solid';
  const scopeStart = solid
    ? '  return runApplicationRequest(context.session, async () => {\n'
    : '';
  const scopeEnd = solid ? '  });\n' : '';
  const serverImport = solid
    ? `import { renderDocumentApplication, renderCSRDocument, runApplicationRequest${routed ? ', respondApplicationResponse' : ''} } from '@modern-js/renderer-solid/server';\nimport { validateSolidModuleManifest } from '@modern-js/renderer-solid/manifest';`
    : `import { renderOctaneApplication, renderOctaneCSRDocument } from '@modern-js/renderer-octane/server';\nimport { validateOctaneModuleManifest } from '@modern-js/renderer-octane/manifest';`;
  const common = `${serverImport}
import { assertRendererIdentity, type RendererIdentity } from '@modern-js/renderer-core/identity';
import type { NativeRequestContext } from '@modern-js/renderer-core/server';
export const rendererIdentity: Readonly<RendererIdentity> = Object.freeze(${JSON.stringify(identity)});
function prepare(request: Request, context: NativeRequestContext) {
  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  if (request !== context.session.request) throw new Error('Native request/session ownership mismatch');
  const manifest = ${solid ? 'validateSolidModuleManifest' : 'validateOctaneModuleManifest'}(context.nativeManifest, rendererIdentity);
  return { documentId: crypto.randomUUID(), rootId: 'root', ...(context.nonce === undefined ? {} : { nonce: context.nonce }), ...(context.assets === undefined ? {} : { assets: context.assets }), ${solid ? 'manifest: manifest.modules' : 'nativeHydrationBuildId: manifest.nativeHydrationBuildId'} };
}
export function nativeCSRRequestHandler(request: Request, context: NativeRequestContext): Response | Promise<Response> {
${scopeStart}  const document = prepare(request, context);
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return ${solid ? 'renderCSRDocument' : 'renderOctaneCSRDocument'}({ session: context.session, document: ${solid ? '{ ...document, renderId: document.documentId }' : 'document'} });
${scopeEnd}}
`;
  if (!routed) {
    return `${common}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
${scopeStart}  const document = prepare(request, context);
  const { default: App } = await import('./application.server');
  if (!context.session.responsePolicy) context.session.resolveResponse({ kind: 'document', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } });
  return ${
    solid
      ? 'renderDocumentApplication({ session: context.session, view: App, document: { ...document, renderId: document.documentId } })'
      : 'renderOctaneApplication({ session: context.session, App, document })'
  };
${scopeEnd}}
export default nativeRequestHandler;
`;
  }
  const routerImports = solid
    ? `import { selectApplicationDataRoute, prepareRouterMatchTransfer, getApplicationStatus, resolveApplicationRedirect } from '@modern-js/renderer-solid/router';`
    : `import { selectApplicationDataRoute } from '@modern-js/renderer-octane/router';
import { createOctaneRouterInjection, createOctaneRequestHandler, createSsrStreamResponse, OctaneRouterServer } from '@modern-js/renderer-octane/router-server';`;
  const render = solid
    ? `await router.load();
  prepareRouterMatchTransfer(router, context.session, [context, context.session, context.session.platform, context.session.platform.bindings, nativeRequest]);
  const metadata = mergeDataResponseMetadata(outcomes, { status: getApplicationStatus(router) });
  const redirect = resolveApplicationRedirect(router);
  if (redirect) return respondApplicationResponse(context.session, mergeDataResponseIntoResponse(redirect, metadata));
  context.session.resolveResponse(dataMetadataToDocumentPolicy(metadata));
  return renderDocumentApplication({ session: context.session, view: () => <ApplicationRouter router={router} />, document: { ...document, renderId: document.documentId } });`
    : `const response = await createOctaneRequestHandler({ request: nativeRequest, session: context.session, createRouter: () => router, serialization: { forbiddenValues: [context, context.session, context.session.platform, context.session.platform.bindings, nativeRequest] } })(async ({ router, responseHeaders }) => {
    const metadata = mergeDataResponseMetadata(outcomes, { status: router.state.statusCode ?? 200 });
    context.session.resolveResponse(dataMetadataToDocumentPolicy({ ...metadata, headers: [...collectDataHeaders(responseHeaders), ...metadata.headers] }));
    const injection = createOctaneRouterInjection(router, context.session);
    const response = await renderOctaneApplication({ session: context.session, App: OctaneRouterServer, props: { router }, document, injection });
    return createSsrStreamResponse(router, response);
  });
  return context.session.committedPolicy ? response : mergeDataResponseIntoResponse(response, mergeDataResponseMetadata(outcomes, { status: response.status }));`;
  // The server index is plain TS. A Solid route view lives in its native JSX module.
  const solidRender = render.replace(
    'view: () => <ApplicationRouter router={router} />',
    'view: () => routerView(router)',
  );
  return `${common}
${routerImports}
import { handleDataRequest, mergeDataResponseMetadata, ${solid ? '' : 'collectDataHeaders, '}dataMetadataToDocumentPolicy, mergeDataResponseIntoResponse } from '@modern-js/renderer-core/data';
import type { DataOutcome, DecodedDataOutcome } from '@modern-js/renderer-core/data';
${solid ? "import { routerView } from './router-view.server';" : ''}
export async function nativeMatchRouteIds(request: Request${solid ? ', context: NativeRequestContext' : ''}): Promise<readonly string[]> {
${scopeStart}${
  solid
    ? `  assertRendererIdentity(context.entry, rendererIdentity);
  assertRendererIdentity(context.session.identity, rendererIdentity);
  if (request !== context.session.request) throw new Error('Native request/session ownership mismatch');
`
    : ''
}  const { createNativeRouter } = await import('./application.server');
  const router = createNativeRouter(rendererIdentity, request${solid ? ', context.session.platform.bindings, undefined, context.session' : ''});
  return router.matchRoutes(new URL(request.url).pathname).map(match => {
    const data = router.routesById[match.routeId]?.options.staticData;
    return data && 'ultramodernRouteId' in data && typeof data.ultramodernRouteId === 'string' ? data.ultramodernRouteId : undefined;
  }).filter((id): id is string => typeof id === 'string');
${scopeEnd}}
export async function nativeRequestHandler(request: Request, context: NativeRequestContext): Promise<Response> {
${scopeStart}  const document = prepare(request, context);
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
  }${solid ? ', context.session' : ''});
  const dataResponse = await handleDataRequest({ request: nativeRequest, identity: rendererIdentity, context: context.session.platform.bindings, privateValues: [context, context.session, context.session.platform, context.session.platform.bindings], selectRoute: (request, routeId, operation) => selectApplicationDataRoute(router, request, routeId, operation, dataModules) });
  if (dataResponse) return ${solid ? 'respondApplicationResponse(context.session, dataResponse)' : 'dataResponse'};
  ${solid ? solidRender : render}
${scopeEnd}}
export default nativeRequestHandler;
`;
}

/** Generate real native application modules through the owning CLI output hook. */
export function createNativeEntryGenerator(
  renderer: 'solid' | 'octane',
): NativeEntryGenerator {
  return {
    async client(context) {
      if (context.renderer !== renderer)
        throw new Error('Native generator renderer conflict');
      const identity = entryIdentity(context);
      await emitApplication(context, 'client');
      return clientSource(renderer, identity);
    },
    async server(context) {
      if (context.renderer !== renderer)
        throw new Error('Native generator renderer conflict');
      const identity = entryIdentity(context);
      const { routed, directory } = await emitApplication(context, 'server');
      if (routed && renderer === 'solid') {
        await fs.writeFile(
          path.join(directory, 'router-view.server.tsx'),
          `import { ApplicationRouter, type AnyRouter } from '@modern-js/renderer-solid/router';\nexport function routerView(router: AnyRouter) { return <ApplicationRouter router={router} />; }\n`,
        );
      }
      return serverSource(renderer, identity, routed);
    },
  };
}
