import assert from 'node:assert/strict';
import {
  bindingVariable,
  candidateHeader,
  controlHeader,
  defaultRoutes,
  receiptHeader,
  validateCandidateBinding,
  validateRoutes,
  validateToken,
} from './contract.mjs';

function diagnosticSource({ token, candidateBinding, dispatchForm }) {
  return (
    `const token = ${JSON.stringify(token)};
const candidateBinding = ${JSON.stringify(candidateBinding)};
const candidateText = JSON.stringify(candidateBinding);
const dispatchForm = ${JSON.stringify(dispatchForm)};
const controlHeader = ${JSON.stringify(controlHeader)};
const candidateHeader = ${JSON.stringify(candidateHeader)};
const receiptHeader = ${JSON.stringify(receiptHeader)};
const bindingVariable = ${JSON.stringify(bindingVariable)};
` +
    String.raw`
type Bindings = { LIFECYCLE_WORKER_TOKEN: string };
type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};
type Observation = {
  id: string;
  mapAlreadyOwned: boolean;
  events: Array<{ sequence: number; type: string; detail?: unknown }>;
  snapshots: Array<{
    phase: string; owner: unknown; binding: unknown;
    bindingsIdentity: boolean; contextIdentity: boolean;
    executionContext: boolean; method: string; requestHeader: string | null;
    nativeRequestHeader?: unknown; nativeLoaderContextIdentity?: boolean;
  }>;
  setupReleased: boolean;
  deferredReleased: boolean;
  producerStarts: number;
  producerResolutions: number;
  producerCancellationCalls: number;
  producerCleanups: number;
  requestSignalAborts: number;
  sourceCancels: number;
  sourceErrors: number;
  sourceCompletions: number;
  requestCleanups: number;
  nativeTerminals: Array<{ status: string }>;
  renderErrors: string[];
  waitUntilCompletions: number;
};
type Controls = { setup(): void; deferred(): void };
// Only diagnostics and explicit test gates are shared. Render inputs live in State.
const observations = new Map<string, Observation>();
const controls = new Map<string, Controls>();
const mapOwners = new WeakMap<object, string>();
let sequence = 0;
const event = (observation: Observation, type: string, detail?: unknown) => {
  observation.events.push({ sequence: ++sequence, type, ...(detail === undefined ? {} : { detail }) });
};
function authorize(request: Request): void {
  if (request.headers.get(controlHeader) !== token || request.headers.get(candidateHeader) !== candidateText)
    throw new Error('Lifecycle request is not bound to this candidate');
}
function diagnosticRequest(request: Request): Response | undefined {
  authorize(request);
  const url = new URL(request.url);
  const action = url.searchParams.get('lifecycleControl');
  if (!action) return undefined;
  const id = url.searchParams.get('lifecycleRequest') || '';
  if (action === 'observe') {
    return Response.json({ candidateBinding, token, dispatchForm, observations: Array.from(observations.values()) });
  }
  const control = controls.get(id);
  const observation = observations.get(id);
  if (!control || !observation) throw new Error('Unknown lifecycle request');
  if (action === 'setup') {
    if (observation.setupReleased) throw new Error('Setup gate released twice');
    observation.setupReleased = true;
    event(observation, 'setup-release');
    control.setup();
  } else if (action === 'deferred') {
    if (observation.deferredReleased) throw new Error('Deferred gate released twice');
    observation.deferredReleased = true;
    event(observation, 'deferred-release');
    control.deferred();
  } else throw new Error('Unknown lifecycle control action');
  return Response.json({ candidateBinding, token, dispatchForm, id, action });
}
const stateBrand: unique symbol = Symbol('lifecycle-fixture-state');
type State = {
  readonly [stateBrand]: true;
  id: string;
  request: Request;
  env: object;
  ctx: ExecutionContext;
  context: Map<unknown, unknown>;
  observation: Observation;
  setup: Promise<void>;
  deferred: Promise<void>;
  producer: Promise<void>;
  resolved: boolean;
  cancelled: boolean;
  cancellationReason?: unknown;
  cancelProducer(reason: unknown): void;
  snapshot(phase: string): void;
  cleanup(): void;
};
function isState(value: unknown): value is State {
  return typeof value === 'object' && value !== null && stateBrand in value && value[stateBrand] === true;
}
function begin(
  request: Request,
  env: object,
  ctx: ExecutionContext,
  context: Map<unknown, unknown>,
  currentPlatform: () => {
    bindings: unknown; executionContext: unknown;
    nativeRequestHeader?: unknown; nativeLoaderContext?: unknown;
  },
): State {
  authorize(request);
  const id = new URL(request.url).searchParams.get('lifecycleRequest') || '';
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || observations.has(id)) throw new Error('Invalid or reused lifecycle request id');
  const mapAlreadyOwned = mapOwners.has(context);
  mapOwners.set(context, id);
  context.set('lifecycle-owner', id);
  let releaseSetup!: () => void;
  let releaseDeferred!: () => void;
  let rejectDeferred!: (reason: unknown) => void;
  const setup = new Promise<void>(resolve => { releaseSetup = resolve; });
  const deferred = new Promise<void>((resolve, reject) => { releaseDeferred = resolve; rejectDeferred = reject; });
  // Only the diagnostic request settles these gates. workerd cancels a request
  // as hung (500) when its sole pending work is a promise another request
  // settles, so this request owns a timer until both of its gates settle.
  const keepAlive = setInterval(() => {}, 50);
  const releaseKeepAlive = () => clearInterval(keepAlive);
  void Promise.allSettled([setup, deferred]).then(releaseKeepAlive);
  const observation: Observation = {
    id, mapAlreadyOwned, events: [], snapshots: [], setupReleased: false, deferredReleased: false,
    producerStarts: 0, producerResolutions: 0, producerCancellationCalls: 0, producerCleanups: 0,
    requestSignalAborts: 0, sourceCancels: 0, sourceErrors: 0, sourceCompletions: 0,
    requestCleanups: 0, nativeTerminals: [], renderErrors: [], waitUntilCompletions: 0,
  };
  observations.set(id, observation);
  controls.set(id, { setup: releaseSetup, deferred: releaseDeferred });
  const state: State = {
    [stateBrand]: true,
    id, request, env, ctx, context, observation, setup, deferred,
    producer: Promise.resolve(), resolved: false, cancelled: false,
    cancelProducer(reason) {
      observation.producerCancellationCalls += 1;
      event(observation, 'producer-cancel', String(reason));
      state.cancelled = true;
      state.cancellationReason = reason;
      rejectDeferred(reason);
    },
    snapshot(phase) {
      const current = currentPlatform();
      observation.snapshots.push({
        phase, owner: context.get('lifecycle-owner'), binding: bindingVariable in env ? env[bindingVariable] : undefined,
        bindingsIdentity: current.bindings === env, contextIdentity: current.executionContext === ctx,
        executionContext: typeof ctx?.waitUntil === 'function' && typeof ctx?.passThroughOnException === 'function',
        method: request.method, requestHeader: request.headers.get('x-lifecycle-request'),
        ...(current.nativeLoaderContext === undefined ? {} : {
          nativeRequestHeader: current.nativeRequestHeader,
          nativeLoaderContextIdentity: current.nativeLoaderContext === context,
        }),
      });
      event(observation, 'snapshot', phase);
    },
    cleanup() {
      observation.requestCleanups += 1;
      event(observation, 'request-cleanup');
      request.signal.removeEventListener('abort', aborted);
      releaseKeepAlive();
      controls.delete(id);
    },
  };
  const aborted = () => {
    observation.requestSignalAborts += 1;
    event(observation, 'request-signal-abort', String(request.signal.reason));
    state.cancelProducer(request.signal.reason);
  };
  request.signal.addEventListener('abort', aborted, { once: true });
  state.snapshot('before-setup-await');
  return state;
}
function startProducer(state: State): void {
  const observation = state.observation;
  observation.producerStarts += 1;
  event(observation, 'producer-start');
  state.producer = (async () => {
    try {
      state.snapshot('before-deferred-await');
      await state.deferred;
      state.snapshot('after-deferred-await');
      state.resolved = true;
      observation.producerResolutions += 1;
      event(observation, 'producer-resolved');
    } finally {
      observation.producerCleanups += 1;
      event(observation, 'producer-cleanup');
    }
  })();
  // The renderer owns this promise; this catch only prevents diagnostic rejection noise.
  state.producer.catch(() => {});
  state.ctx.waitUntil(state.producer.then(
    () => { observation.waitUntilCompletions += 1; event(observation, 'wait-until-complete'); },
    () => { observation.waitUntilCompletions += 1; event(observation, 'wait-until-rejected'); },
  ));
}
function renderTree(state: State) {
  function Deferred() {
    if (state.cancelled) throw state.cancellationReason;
    if (!state.resolved) throw state.producer;
    state.snapshot('deferred-render');
    return <span id="lifecycle-deferred">{token + ':' + state.id + ':deferred:α🌐'}</span>;
  }
  // A host root: React withholds the shell while a root-level Suspense
  // boundary is pending, since it could still contain <html>/<body>.
  return <main id="lifecycle-root">
    <p id="lifecycle-shell">{token + ':' + state.id + ':shell:α🌐'}</p>
    <Suspense fallback={<p id="lifecycle-pending">{state.id + ':pending'}</p>}>
      <Deferred />
    </Suspense>
  </main>;
}
// Forward one native read per consumer pull, including cancellation of the original reader.
function observeNativeSource(source: ReadableStream<Uint8Array>, state: State, ownsCleanup: boolean): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let consumerCancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        state.observation.sourceErrors += 1;
        event(state.observation, 'source-error', String(error));
        if (consumerCancelled) return;
        try { controller.error(error); }
        finally {
          try { reader.releaseLock(); }
          finally { if (ownsCleanup) state.cleanup(); }
        }
        return;
      }
      if (consumerCancelled) {
        event(state.observation, 'read-settled-after-cancel', { done: chunk.done });
        return;
      }
      if (chunk.done) {
        state.observation.sourceCompletions += 1;
        event(state.observation, 'source-complete');
        try { controller.close(); }
        finally {
          try { reader.releaseLock(); }
          finally { if (ownsCleanup) state.cleanup(); }
        }
      } else {
        controller.enqueue(chunk.value);
      }
    },
    async cancel(reason) {
      consumerCancelled = true;
      state.observation.sourceCancels += 1;
      event(state.observation, 'source-cancel', String(reason));
      state.cancelProducer(reason);
      try { await reader.cancel(reason); }
      finally {
        try { reader.releaseLock(); }
        finally { if (ownsCleanup) state.cleanup(); }
      }
    },
  }, { highWaterMark: 0 });
}
function nativeResponse(body: ReadableStream<Uint8Array>, state: State): Response {
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'x-lifecycle-response': token + ':' + state.id,
    [receiptHeader]: encodeURIComponent(JSON.stringify({ candidateBinding, token, dispatchForm, id: state.id })),
  });
  headers.append('set-cookie', 'lifecycle_first=' + state.id + '; Path=/; HttpOnly');
  headers.append('set-cookie', 'lifecycle_second=' + state.id + '; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/');
  return new Response(body, { status: 207, statusText: 'Lifecycle Multi-Status', headers });
}
`
  );
}

function fetchSource(input) {
  return (
    `import { Suspense } from 'react';
import { renderToReadableStream } from 'react-dom/server.edge';
${diagnosticSource(input)}
` +
    String.raw`
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const diagnostic = diagnosticRequest(request);
    if (diagnostic) return diagnostic;
    const state = begin(request, env, ctx, new Map(), () => ({ bindings: env, executionContext: ctx }));
    await state.setup;
    state.snapshot('after-setup-await');
    startProducer(state);
    const source = await renderToReadableStream(renderTree(state), {
      signal: request.signal,
      onError(error) { state.observation.renderErrors.push(String(error)); event(state.observation, 'render-error', String(error)); },
    });
    return nativeResponse(observeNativeSource(source, state, true), state);
  },
};
`
  );
}

function requestSource({
  runtimeSpecifier,
  runtimeExtensionsSpecifier,
  cloudflareSpecifier,
  entryName,
  ...input
}) {
  return (
    `import { Suspense } from 'react';
import { registerPlugin } from ${JSON.stringify(`${runtimeSpecifier}/plugin`)};
import { routerProviderRegistryHooks, setGlobalContext } from ${JSON.stringify(`${runtimeSpecifier}/context`)};
import { createRequestHandler, renderStreaming } from ${JSON.stringify(`${runtimeSpecifier}/ssr/server`)};
import { applyRouterRuntimeState, getRouterRuntimeState } from ${JSON.stringify(`${runtimeExtensionsSpecifier}/router-state`)};
import { createRouterStatePlugin } from ${JSON.stringify(`${runtimeExtensionsSpecifier}/router-state-plugin`)};
import { isCloudflareWorkerRequestHandlerOptions, type CloudflareWorkerRequestHandlerOptions } from ${JSON.stringify(`${cloudflareSpecifier}/cloudflare/worker-options`)};
${diagnosticSource(input)}
const fixtureEntryName = ${JSON.stringify(entryName)};
` +
    String.raw`
const stateKey: unique symbol = Symbol('request-owned-lifecycle-state');
// Apps get this plugin from the SDK; it runs the router runtime state's
// cleanup when the request ends. Generated apps register it from untyped
// code; its router hook extension does not narrow to the base plugin type.
type RegisteredPlugin = Parameters<typeof registerPlugin>[0][number];
const runtime = registerPlugin([
  createRouterStatePlugin({
    registryHooks: routerProviderRegistryHooks,
  }) as unknown as RegisteredPlugin,
]);
setGlobalContext({ App: () => null, entryName: fixtureEntryName, enableRsc: false });
runtime.hooks.extendStreamSSR.tap(info => {
  if (!(stateKey in info.runtimeContext) || !isState(info.runtimeContext[stateKey]))
    throw new Error('Native stream hook lost its request-owned state');
  const state = info.runtimeContext[stateKey];
  return {
    processReadableStream(source) { return observeNativeSource(source, state, false); },
    onTerminal(terminal) {
      state.observation.nativeTerminals.push({ status: terminal.status });
      event(state.observation, 'native-terminal', terminal.status);
    },
  };
});
const nativePromise = createRequestHandler(async (request, _Root, options) => {
  if (!isCloudflareWorkerRequestHandlerOptions(options))
    throw new Error('Native request options lack the actual worker platform');
  const env = options.platform.bindings;
  const ctx = options.executionContext;
  if (env === undefined || ctx === undefined)
    throw new Error('The actual worker bindings or execution context are absent');
  if (!(options.loaderContext instanceof Map)) throw new Error('Native loaderContext is not a Map');
  const state = begin(request, env, ctx, options.loaderContext, () => ({
    bindings: options.platform?.kind === 'worker' ? options.platform.bindings : undefined,
    executionContext: options.executionContext,
    nativeRequestHeader: options.runtimeContext.ssrContext?.request.headers['x-lifecycle-request'],
    nativeLoaderContext: options.runtimeContext.ssrContext?.loaderContext,
  }));
  Object.assign(options.runtimeContext, { [stateKey]: state });
  const previous = getRouterRuntimeState(options.runtimeContext);
  applyRouterRuntimeState(options.runtimeContext, {
    ...previous,
    framework: previous?.framework ?? 'worker-lifecycle-proof',
    async cleanup() { await previous?.cleanup?.(); state.cleanup(); },
  });
  await state.setup;
  state.snapshot('after-setup-await');
  startProducer(state);
  const body = await renderStreaming(request, renderTree(state), options);
  return nativeResponse(body, state);
});
export const requestHandler = async (
  request: Request,
  options: CloudflareWorkerRequestHandlerOptions<Bindings>,
): Promise<Response> => {
  const diagnostic = diagnosticRequest(request);
  if (diagnostic) return diagnostic;
  return (await nativePromise)(request, options);
};
`
  );
}

export function createWorkerLifecycleSources({
  runtimeSpecifier,
  runtimeExtensionsSpecifier = '@modern-js/runtime-extensions',
  cloudflareSpecifier = '@modern-js/app-tools-extensions',
  token,
  candidateBinding,
  routes = defaultRoutes,
}) {
  for (const specifier of [
    runtimeSpecifier,
    runtimeExtensionsSpecifier,
    cloudflareSpecifier,
  ]) {
    assert.equal(typeof specifier, 'string');
    assert(/^@[-a-zA-Z0-9_.]+\/[-a-zA-Z0-9_.]+$/u.test(specifier));
  }
  const candidate = validateCandidateBinding(candidateBinding);
  validateToken(token);
  const sources = validateRoutes(routes).map(route => ({
    ...route,
    source: (route.dispatchForm === 'fetch-export'
      ? fetchSource
      : requestSource)({
      runtimeSpecifier,
      runtimeExtensionsSpecifier,
      cloudflareSpecifier,
      token,
      candidateBinding: candidate,
      dispatchForm: route.dispatchForm,
      entryName: route.entryName,
    }),
  }));
  return {
    sources,
    candidateBinding: candidate,
    token,
    bindingVariable,
    controlHeader,
    candidateHeader,
    receiptHeader,
  };
}
