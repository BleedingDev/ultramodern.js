import { createBrowserHistory, createRouter } from '@octanejs/tanstack-router';
import { bootstrapStreamedSignalHydration } from 'octane/hydration/streamed-signals';
import {
  hydrateOctaneApplication,
  OctaneRouterRoot,
  prepareOctaneRouterHydration,
  readOctaneDocumentBootstrap,
} from './framework-client';

declare const __webpack_hash__: string;
// HMR advances Rspack's current hash; the loaded document belongs to the initial
// development compilation for the lifetime of this browser session.
const nativeHydrationBuildId = __webpack_hash__;
const identity = {
  renderer: 'octane',
  appId: 'native-public-fragment-admission',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'owning-source-fragment-pair',
} as const;
const container = document.getElementById('root')!;
const bootstrap = readOctaneDocumentBootstrap(
  document,
  identity,
  nativeHydrationBuildId,
);
const initialMain = container.querySelector('main');
const initialHome = container.querySelector('[data-testid="home"]');
const initialTitle = document.head.querySelector('title');
const calls: string[] = [];
let loadCalls = 0;
let history: ReturnType<typeof createBrowserHistory> | undefined;
let router: ReturnType<typeof createRouter> | undefined;
let handle: Awaited<ReturnType<typeof hydrateOctaneApplication>> | undefined;

function input(): Parameters<typeof hydrateOctaneApplication>[0] {
  return {
    container,
    identity,
    nativeHydrationBuildId,
    documentIdentity: bootstrap.identity,
    documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId,
    documentId: bootstrap.documentId,
    load: async () => {
      loadCalls++;
      const { routeTree } = await import('./routes');
      history = createBrowserHistory({ window });
      router = createRouter({
        routeTree: routeTree('client', calls),
        history,
        isServer: false,
        defaultStaleTime: Infinity,
      });
      await prepareOctaneRouterHydration(router);
      return { default: OctaneRouterRoot, props: { router } };
    },
  };
}

export async function negativeStartup(kind: string) {
  let options = input();
  if (kind === 'renderer')
    options = { ...options, identity: { ...identity, renderer: 'solid' } };
  else if (kind === 'document')
    options = {
      ...options,
      documentIdentity: {
        ...bootstrap.identity,
        buildId: 'other-document-build',
      },
    };
  else if (kind === 'native')
    options = {
      ...options,
      documentNativeHydrationBuildId: 'other-native-compilation',
    };
  else if (kind === 'document-id') options = { ...options, documentId: '' };
  else if (kind === 'compiled-native') {
    options = {
      ...options,
      nativeHydrationBuildId: 'forged-matching-native-hash',
      documentNativeHydrationBuildId: 'forged-matching-native-hash',
    };
  } else if (kind !== 'duplicate-framework-bridge')
    throw new Error(`Unknown negative ${kind}`);
  const before = loadCalls;
  const beforeHtml = container.innerHTML;
  try {
    if (kind === 'compiled-native')
      readOctaneDocumentBootstrap(
        document,
        identity,
        options.nativeHydrationBuildId,
      );
    await hydrateOctaneApplication(options);
    throw new Error('Invalid hydration was accepted');
  } catch (error) {
    if (loadCalls !== before)
      throw new Error('Authored imports executed before hydration rejection');
    if (String(error).includes('Invalid hydration was accepted')) throw error;
    return {
      kind,
      error: String(error),
      authoredImports: loadCalls - before,
      retainedMain: container.querySelector('main') === initialMain,
      unchangedDom: container.innerHTML === beforeHtml,
    };
  }
}

export async function start() {
  handle = await hydrateOctaneApplication(input());
  return inspect();
}

export function inspect() {
  return {
    retainedMain: container.querySelector('main') === initialMain,
    retainedHome:
      container.querySelector('[data-testid="home"]') === initialHome,
    retainedTitle: document.head.querySelector('title') === initialTitle,
    routerPathname: router?.stores.location.get().pathname,
    pathname: location.pathname,
    loadCalls,
    calls: [...calls],
    roots: container.querySelectorAll('main').length,
  };
}

export function duplicateNativeBridge() {
  const target = window as unknown as Record<string, unknown> & {
    __octaneStreamedRenderer: unknown;
    __octaneStreamedSignalSelections: { register: unknown };
  };
  const ingress = target.__octaneStreamedRenderer;
  const selections = target.__octaneStreamedSignalSelections;
  const registration = selections.register;
  try {
    const bridge = bootstrapStreamedSignalHydration({
      buildId: bootstrap.nativeHydrationBuildId,
      documentId: bootstrap.documentId,
      target,
    });
    bridge.dispose();
    throw new Error('Duplicate native bridge was accepted');
  } catch (error) {
    if (String(error).includes('Duplicate native bridge was accepted'))
      throw error;
    return {
      error: String(error),
      retainedIngress: target.__octaneStreamedRenderer === ingress,
      retainedSelectionRegistration: selections.register === registration,
      ...inspect(),
    };
  }
}

export function dispose() {
  handle?.dispose();
  handle?.dispose();
  history?.destroy();
  return {
    nodes: container.childNodes.length,
    lifecycle: globalThis.fragmentLifecycle,
  };
}
