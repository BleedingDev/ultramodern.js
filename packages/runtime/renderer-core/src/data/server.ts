import { identityCacheKey, type RendererIdentity } from '../identity';
import { responseHeaders as collectDataHeaders } from '../session/cache';
import type { DocumentCachePolicy, ResponsePolicy } from '../session/types';
import { readBoundedDataText } from './body';
import {
  assertPublicData,
  DataProtocolError,
  serializePublicData,
} from './codec';
import { createRequestDataPolicy, type RequestDataPolicy } from './private';
import {
  DATA_CONTENT_TYPE,
  DATA_PROTOCOL_VERSION,
  DATA_STREAM_CONTENT_TYPE,
  type DataHandler,
  type DataHandlerInput,
  type DataOperation,
  type DataOutcome,
  type DataResponseMetadata,
  type DataStreamFrame,
  type DataWireEnvelope,
  LOADER_ID_PARAM,
  type PublicDataError,
  type PublicDataOutcome,
  type SelectedDataRoute,
} from './types';

export { collectDataHeaders };

const DEFERRED = Symbol('ultramodern.data.deferred');
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BODYLESS_STATUSES = new Set([204, 205, 304]);
const REPRESENTATION_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-digest',
  'repr-digest',
  'digest',
  'transfer-encoding',
  'content-range',
  'accept-ranges',
  'content-disposition',
  'content-language',
  'content-location',
  'etag',
  'last-modified',
  'location',
]);
/** RFC 9110 connection-specific fields; they never describe a new response. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);

/**
 * Loader fields a generated envelope or document must not inherit: its
 * representation metadata, hop-by-hop fields and any field `Connection` names.
 */
function projectedHeaderFilter(
  headers: Iterable<readonly [string, string]>,
): (name: string) => boolean {
  const stripped = new Set([...REPRESENTATION_HEADERS, ...HOP_BY_HOP_HEADERS]);
  for (const [name, value] of headers)
    if (name.toLowerCase() === 'connection')
      for (const field of value.split(','))
        if (field.trim()) stripped.add(field.trim().toLowerCase());
  return name => !stripped.has(name.toLowerCase());
}

const outcomePolicies = new WeakMap<DataOutcome, RequestDataPolicy>();

/**
 * Opaque result of {@link deferData}. Exported so loaders returning it keep a
 * nameable type under declaration emit (composite/declaration projects).
 */
export interface DeferredDataResult {
  [DEFERRED]: true;
  critical: Record<string, unknown>;
  deferred: Record<string, Promise<unknown>>;
  init?: ResponseInit;
}

export function deferData(
  critical: Record<string, unknown>,
  deferred: Record<string, Promise<unknown>>,
  init?: ResponseInit,
): DeferredDataResult {
  for (const record of [critical, deferred]) {
    if (
      record === null ||
      typeof record !== 'object' ||
      (Object.getPrototypeOf(record) !== Object.prototype &&
        Object.getPrototypeOf(record) !== null)
    ) {
      throw new DataProtocolError(
        'Deferred data requires plain critical and deferred records',
      );
    }
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(record),
    )) {
      if (descriptor.get || descriptor.set)
        throw new DataProtocolError('Deferred data must not contain accessors');
    }
  }
  assertPublicData(critical);
  for (const [key, promise] of Object.entries(deferred)) {
    if (Object.hasOwn(critical, key) || !(promise instanceof Promise)) {
      throw new DataProtocolError(
        'Deferred data needs unique keys and Promise values',
      );
    }
    // Rejections are serialized when consumed, including an already rejected promise.
    void promise.catch(() => undefined);
  }
  return {
    [DEFERRED]: true,
    critical,
    deferred: Object.fromEntries(Object.entries(deferred)),
    ...(init === undefined ? {} : { init }),
  };
}

/**
 * Cache-Control directives in order, names lowercased. Quoted values are
 * consumed whole, so text inside an extension value is never a directive.
 */
function cacheDirectives(
  cacheControl: string,
): { name: string; value: string | undefined }[] {
  return [
    ...cacheControl.matchAll(
      /(?:^|,)\s*([!#$%&'*+.^_`|~\w-]+)\s*(?:=\s*("(?:[^"\\]|\\.)*"|[^,]*))?/gu,
    ),
  ].map(match => ({ name: match[1].toLowerCase(), value: match[2]?.trim() }));
}

function cacheLifetime(cacheControl: string): number | undefined {
  const names = new Set<string>();
  const ages: number[] = [];
  for (const { name, value: raw } of cacheDirectives(cacheControl)) {
    if (name !== 'max-age' && name !== 's-maxage') continue;
    if (raw === undefined) return undefined;
    if (names.has(name) || !/^\d+$/.test(raw)) return undefined;
    const age = Number(raw);
    if (!Number.isSafeInteger(age)) return undefined;
    names.add(name);
    ages.push(age);
  }
  // Shared-cache freshness cannot establish the browser max-age the merged
  // document emits; it can only shorten one.
  if (!names.has('max-age')) return undefined;
  return ages.length > 0 ? Math.min(...ages) : undefined;
}

const ACCUMULATED_HEADERS = new Set([
  'set-cookie',
  'vary',
  'link',
  'server-timing',
  'content-security-policy',
  'content-security-policy-report-only',
]);

/** The native router supplies status after resolving its own route outcomes. */
export function mergeDataResponseMetadata(
  outcomes: readonly DataOutcome[],
  nativeResponse: { status: number; statusText?: string },
): DataResponseMetadata {
  const headers = new Headers();
  let cachePolicy: DataResponseMetadata['cachePolicy'] = 'public';
  for (const outcome of outcomes) {
    for (const [name, value] of outcome.response.headers) {
      // Browsers enforce every CSP field, so a nested loader adds to the
      // layout's policies instead of replacing them.
      if (ACCUMULATED_HEADERS.has(name.toLowerCase()))
        headers.append(name, value);
      else headers.set(name, value);
    }
    if (
      outcome.kind !== 'success' ||
      outcome.response.cachePolicy === 'no-store'
    )
      cachePolicy = 'no-store';
    else if (
      outcome.response.cachePolicy === 'private' &&
      cachePolicy === 'public'
    )
      cachePolicy = 'private';
  }
  const vary = headers.get('vary');
  if (vary !== null) {
    const fields = new Map<string, string>();
    for (const field of vary.split(',')) {
      const name = field.trim();
      const key = name.toLowerCase();
      if (name && !fields.has(key)) fields.set(key, name);
    }
    headers.set('vary', [...fields.values()].join(', '));
  }
  if (
    outcomes.length === 0 ||
    headers.has('set-cookie') ||
    nativeResponse.status >= 400
  )
    cachePolicy = 'no-store';
  if (cachePolicy !== 'no-store') {
    const ages = outcomes.map(outcome =>
      cacheLifetime(
        new Headers(outcome.response.headers).get('cache-control') ?? '',
      ),
    );
    if (cachePolicy === 'public' && ages.some(age => age === undefined))
      cachePolicy = 'no-store';
    else {
      // An absent or invalid private lifetime requires immediate revalidation.
      const maxAge = Math.min(...ages.map(age => age ?? 0));
      headers.set(
        'cache-control',
        cachePolicy === 'private'
          ? `private, max-age=${maxAge}, must-revalidate`
          : `public, max-age=${maxAge}`,
      );
    }
  }
  if (cachePolicy === 'no-store') headers.set('cache-control', 'no-store');
  return {
    status: nativeResponse.status,
    statusText: nativeResponse.statusText ?? '',
    headers: collectDataHeaders(headers),
    cachePolicy,
  };
}

/** Loader representation headers cannot describe the native HTML document. */
export function dataMetadataToDocumentPolicy(
  metadata: DataResponseMetadata,
): ResponsePolicy {
  const headers = new Headers();
  const fields = [...metadata.headers];
  const keep = projectedHeaderFilter(fields);
  for (const [name, value] of fields) {
    if (keep(name)) headers.append(name, value);
  }
  headers.set('content-type', 'text/html; charset=utf-8');
  let cache: DocumentCachePolicy = { mode: 'no-store' };
  const cacheControl = headers.get('cache-control') ?? '';
  const directives = cacheDirectiveNames(cacheControl);
  if (metadata.cachePolicy === 'private') cache = { mode: 'private' };
  if (
    metadata.cachePolicy === 'public' &&
    metadata.status === 200 &&
    !headers.has('set-cookie') &&
    !directives.has('private') &&
    !directives.has('no-store') &&
    !directives.has('no-cache') &&
    !headers
      .get('vary')
      ?.split(',')
      .some(value => value.trim() === '*')
  ) {
    const maxAgeSeconds = cacheLifetime(cacheControl);
    if (maxAgeSeconds !== undefined) cache = { mode: 'public', maxAgeSeconds };
  }
  if (headers.has('set-cookie') || metadata.status >= 400)
    cache = { mode: 'no-store' };
  if (cache.mode === 'no-store') headers.set('cache-control', 'no-store');
  else if (cache.mode === 'private' && !directives.has('private'))
    headers.set('cache-control', 'private');
  return {
    kind: 'document',
    status: metadata.status,
    headers: collectDataHeaders(headers),
    cache,
  };
}

/** Preserve a native terminal response while adding all matched loader cookies. */
export function mergeDataResponseIntoResponse(
  response: Response,
  metadata: DataResponseMetadata,
): Response {
  const headers = new Headers(response.headers);
  const nativeCookies = headers.getSetCookie();
  const metadataHeaders = dataMetadataToDocumentPolicy(metadata).headers;
  const metadataCookies: string[] = [];
  for (const [name, value] of metadataHeaders) {
    const headerName = name.toLowerCase();
    if (headerName === 'set-cookie') metadataCookies.push(value);
    // CSP and Server-Timing are list fields the native response keeps too.
    else if (ACCUMULATED_HEADERS.has(headerName) && headerName !== 'vary')
      headers.append(name, value);
    else if (headerName === 'vary') {
      const fields = new Map<string, string>();
      for (const field of `${headers.get('vary') ?? ''},${value}`.split(',')) {
        const item = field.trim();
        if (item && !fields.has(item.toLowerCase()))
          fields.set(item.toLowerCase(), item);
      }
      headers.set('vary', [...fields.values()].join(', '));
    } else if (headerName !== 'content-type') headers.set(name, value);
  }
  if (metadataCookies.length > 0) {
    headers.delete('set-cookie');
    const counts = new Map<string, number>();
    for (const cookie of metadataCookies) {
      headers.append('set-cookie', cookie);
      counts.set(cookie, (counts.get(cookie) ?? 0) + 1);
    }
    for (const cookie of nativeCookies) {
      const remaining = counts.get(cookie) ?? 0;
      if (remaining > 0) counts.set(cookie, remaining - 1);
      else headers.append('set-cookie', cookie);
    }
  }
  // Terminal outcomes never enter the document cache or a successful stream cache.
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Cache-Control directive names, lowercased. Only whole tokens count, so an
 * extension such as `x-public` or a quoted `"public"` value never opts in.
 */
function cacheDirectiveNames(cacheControl: string): Set<string> {
  return new Set(cacheDirectives(cacheControl).map(({ name }) => name));
}

function responseMetadata(init: ResponseInit = {}): DataResponseMetadata {
  const status = init.status ?? 200;
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new DataProtocolError(
      'A data response requires a valid HTTP response status',
    );
  }
  const headers = new Headers(init.headers);
  const directives = cacheDirectiveNames(headers.get('cache-control') ?? '');
  return {
    status,
    statusText: init.statusText ?? '',
    headers: collectDataHeaders(headers),
    cachePolicy:
      directives.has('no-store') || directives.has('no-cache')
        ? 'no-store'
        : directives.has('private')
          ? 'private'
          : directives.has('public')
            ? 'public'
            : 'no-store',
  };
}

export function publicDataError(
  error: unknown,
  production = true,
): PublicDataError {
  const fallback = { name: 'Error', message: 'Unexpected Server Error' };
  if (production) return fallback;
  if (error instanceof Error || error instanceof DOMException) {
    // Node's lazy stack is an accessor too. Only descriptor data strings are
    // public; error projection must never execute application getters.
    const field = (key: 'name' | 'message' | 'stack'): string | undefined => {
      let object: object | null = error;
      for (let depth = 0; object !== null && depth < 100; depth++) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (descriptor) {
          return typeof descriptor.value === 'string'
            ? descriptor.value
            : undefined;
        }
        object = Object.getPrototypeOf(object);
      }
      return undefined;
    };
    try {
      const name = field('name') ?? fallback.name;
      const message = field('message') ?? fallback.message;
      const stack = field('stack');
      return { name, message, ...(stack ? { stack } : {}) };
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function responseValue(
  response: Response,
  signal?: AbortSignal,
): Promise<unknown> {
  if (BODYLESS_STATUSES.has(response.status) || response.body === null)
    return undefined;
  const text = await readBoundedDataText(response, signal);
  if (
    /\bapplication\/(?:[^;]+\+)?json\b/i.test(
      response.headers.get('content-type') ?? '',
    )
  ) {
    try {
      return JSON.parse(text);
    } catch {
      throw new DataProtocolError('A data Response contains malformed JSON');
    }
  }
  return text;
}

/** Resolve every status/redirect/header outcome before the document commits headers. */
export async function normalizeDataResult(
  value: unknown,
  options: {
    thrown?: boolean;
    production?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<DataOutcome> {
  const thrown = options.thrown ?? false;
  const production = options.production ?? true;
  if (value instanceof Response) {
    const response = responseMetadata(value);
    if (REDIRECT_STATUSES.has(value.status)) {
      const location = value.headers.get('location');
      if (!location)
        throw new DataProtocolError(
          'A redirect data Response requires Location',
        );
      return { kind: 'redirect', location, response };
    }
    const data = await responseValue(value, options.signal);
    assertPublicData(data);
    if (value.status === 404)
      return { kind: 'not-found', value: data, thrown, response };
    if (thrown || value.status >= 400) {
      return {
        kind: 'error',
        error: {
          name: 'DataResponseError',
          message:
            value.status >= 500 && production
              ? 'Unexpected Server Error'
              : value.statusText || `Data request failed (${value.status})`,
        },
        ...(value.status >= 500 && production ? {} : { data }),
        thrown,
        response,
      };
    }
    return { kind: 'success', value: data, response };
  }
  if (thrown) {
    return {
      kind: 'error',
      error: publicDataError(value, production),
      thrown: true,
      response: responseMetadata({
        status: 500,
        headers: { 'cache-control': 'no-store' },
      }),
    };
  }
  if (value && typeof value === 'object' && DEFERRED in value) {
    const data = value as DeferredDataResult;
    const response = responseMetadata(data.init);
    if (
      REDIRECT_STATUSES.has(response.status) ||
      response.status >= 400 ||
      BODYLESS_STATUSES.has(response.status)
    ) {
      throw new DataProtocolError(
        'Deferred data must have a successful body-bearing response status',
      );
    }
    return {
      kind: 'deferred',
      critical: data.critical,
      deferred: data.deferred,
      response,
    };
  }
  assertPublicData(value);
  return { kind: 'success', value, response: responseMetadata() };
}

export async function invokeRouteData<Context>(
  handler: DataHandler<Context>,
  input: DataHandlerInput<Context>,
  options: { production?: boolean; privateValues?: readonly unknown[] } = {},
): Promise<DataOutcome> {
  input.request.signal.throwIfAborted();
  const policy = createRequestDataPolicy([
    input.context,
    input.request,
    ...(options.privateValues ?? []),
  ]);
  return invokeOwnedRouteData(handler, input, options, policy);
}

async function invokeOwnedRouteData<Context>(
  handler: DataHandler<Context>,
  input: DataHandlerInput<Context>,
  options: { production?: boolean },
  policy: RequestDataPolicy,
): Promise<DataOutcome> {
  input.request.signal.throwIfAborted();
  let value: unknown;
  let thrown = false;
  try {
    value = await handler(input);
  } catch (error) {
    input.request.signal.throwIfAborted();
    value = error;
    thrown = true;
  }
  input.request.signal.throwIfAborted();
  policy.assertRoot(value);
  let outcome = await normalizeDataResult(value, {
    ...options,
    thrown,
    signal: input.request.signal,
  });
  if (outcome.kind === 'deferred') {
    policy.assertValue(outcome.critical);
    outcome = {
      ...outcome,
      deferred: Object.fromEntries(
        Object.entries(outcome.deferred).map(([key, promise]) => {
          const checked = Promise.prototype.then.call(
            promise,
            (value: unknown) => {
              policy.assertValue(value);
              return value;
            },
            (error: unknown) => {
              policy.assertRoot(error);
              throw error;
            },
          ) as Promise<unknown>;
          void checked.catch(() => undefined);
          return [key, checked];
        }),
      ),
    };
  } else {
    policy.assertValue(publicOutcome(outcome));
  }
  outcomePolicies.set(outcome, policy);
  return outcome;
}

function publicOutcome(outcome: DataOutcome): PublicDataOutcome {
  const status = outcome.response.status;
  switch (outcome.kind) {
    case 'success':
      return { kind: 'success', value: outcome.value, status };
    case 'deferred':
      return { kind: 'success', value: outcome.critical, status };
    case 'redirect':
      return { kind: 'redirect', location: outcome.location, status };
    case 'not-found':
      return {
        kind: 'not-found',
        value: outcome.value,
        thrown: outcome.thrown,
        status,
      };
    case 'error':
      return {
        kind: 'error',
        error: outcome.error,
        ...(Object.hasOwn(outcome, 'data') ? { data: outcome.data } : {}),
        thrown: outcome.thrown,
        status,
      };
  }
}

function wireEnvelope(
  outcome: DataOutcome,
  identity: RendererIdentity,
  routeId: string,
  operation: DataOperation,
): DataWireEnvelope {
  identityCacheKey(identity);
  return {
    version: DATA_PROTOCOL_VERSION,
    identity: {
      renderer: identity.renderer,
      appId: identity.appId,
      entryName: identity.entryName,
      protocolVersion: identity.protocolVersion,
      buildId: identity.buildId,
    },
    routeId,
    operation,
    outcome: publicOutcome(outcome),
    ...(outcome.kind === 'deferred'
      ? { deferredKeys: Object.keys(outcome.deferred) }
      : {}),
  };
}

function createDeferredStream(
  outcome: Extract<DataOutcome, { kind: 'deferred' }>,
  envelope: DataWireEnvelope,
  signal: AbortSignal | undefined,
  production: boolean,
  onCancel?: (reason: unknown) => void | Promise<void>,
  policy?: RequestDataPolicy,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const projectError = (error: unknown): PublicDataError => {
    try {
      policy?.assertRoot(error);
    } catch (violation) {
      error = violation;
    }
    return publicDataError(error, production);
  };
  // Snapshot and validate critical data before returning a body or committing headers.
  policy?.assertValue({ type: 'initial', envelope });
  const initialBytes = encoder.encode(
    `${serializePublicData({ type: 'initial', envelope })}\n`,
  );
  const transport = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transport.writable.getWriter();
  let active = true;
  let finished = false;
  let cancelled = false;
  const cancelResources = (reason: unknown) => {
    if (finished || cancelled) return;
    cancelled = true;
    // The response is already interrupted. A resource callback must not crash
    // its transport or prevent writer/listener cleanup.
    try {
      void Promise.resolve(onCancel?.(reason)).catch(() => undefined);
    } catch {
      /* The request owner's lifecycle records its own cleanup failures. */
    }
  };
  const cleanup = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', abort);
  };
  const abort = () => {
    if (!active) return;
    const reason =
      signal?.reason ??
      new DOMException('The data request was aborted', 'AbortError');
    cancelResources(reason);
    cleanup();
    void writer.abort(reason).catch(() => undefined);
  };
  let writes = Promise.resolve();
  const write = (
    frame: DataStreamFrame,
    encoded?: Uint8Array,
  ): Promise<void> => {
    const next = writes.then(async () => {
      if (!active) return;
      if (encoded) {
        await writer.write(encoded);
        return;
      }
      let text: string;
      try {
        policy?.assertValue(frame);
        text = serializePublicData(frame);
      } catch (error) {
        if (frame.type !== 'resolve') throw error;
        text = serializePublicData({
          type: 'reject',
          key: frame.key,
          error: projectError(error),
        });
      }
      await writer.write(encoder.encode(`${text}\n`));
    });
    writes = next;
    return next;
  };
  // A single native stream consumer drives TransformStream backpressure.
  void writer.closed.catch(reason => {
    cancelResources(reason);
    cleanup();
  });
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  void (async () => {
    await write({ type: 'initial', envelope }, initialBytes);
    await Promise.all(
      Object.entries(outcome.deferred).map(async ([key, promise]) => {
        let frame: DataStreamFrame;
        try {
          const value = await promise;
          assertPublicData(value);
          frame = { type: 'resolve', key, value };
        } catch (error) {
          frame = {
            type: 'reject',
            key,
            error: projectError(error),
          };
        }
        await write(frame);
      }),
    );
    if (!active) return;
    await write({ type: 'complete' });
    await writer.close();
    finished = true;
    cleanup();
  })().catch(error => {
    cancelResources(error);
    cleanup();
    void writer.abort(error).catch(() => undefined);
  });
  return transport.readable;
}

export function createDataResponse(
  outcome: DataOutcome,
  identity: RendererIdentity,
  options: {
    routeId: string;
    operation: DataOperation;
    signal?: AbortSignal;
    production?: boolean;
    onCancel?: (reason: unknown) => void | Promise<void>;
  },
): Response {
  const policy = outcomePolicies.get(outcome);
  policy?.assertValue(publicOutcome(outcome));
  const envelope = wireEnvelope(
    outcome,
    identity,
    options.routeId,
    options.operation,
  );
  const headers = new Headers();
  // The envelope owns new bytes. Original validators, ranges and redirects do not.
  // Read the loader fields once; the private-value check counts iterations.
  const fields = [...outcome.response.headers];
  const keep = projectedHeaderFilter(fields);
  for (const [name, value] of fields)
    if (keep(name)) headers.append(name, value);
  headers.set('x-modernjs-response', 'yes');
  if (
    !headers.has('cache-control') ||
    headers.has('set-cookie') ||
    outcome.kind !== 'success' ||
    outcome.response.cachePolicy === 'no-store'
  )
    headers.set('cache-control', 'no-store');
  if (outcome.kind === 'redirect')
    headers.set('x-modernjs-redirect', outcome.location);
  headers.set(
    'content-type',
    `${outcome.kind === 'deferred' ? DATA_STREAM_CONTENT_TYPE : DATA_CONTENT_TYPE}; charset=utf-8`,
  );
  // Bodyless statuses need a body-bearing transport, and the envelope is never
  // partial content even when the loader answered 206. The envelope keeps the
  // original status.
  const status =
    outcome.kind === 'redirect' ||
    outcome.response.status === 206 ||
    BODYLESS_STATUSES.has(outcome.response.status)
      ? 200
      : outcome.response.status;
  let body: ReadableStream<Uint8Array> | string;
  if (outcome.kind === 'deferred') {
    body = createDeferredStream(
      outcome,
      envelope,
      options.signal,
      options.production ?? true,
      options.onCancel,
      policy,
    );
  } else {
    policy?.assertValue(envelope);
    body = serializePublicData(envelope);
  }
  return new Response(body, { status, headers });
}

export async function handleDataRequest<Context>(options: {
  request: Request;
  identity: RendererIdentity;
  context: Context;
  selectRoute: (
    request: Request,
    requestedRouteId: string,
    operation: DataOperation,
  ) =>
    | SelectedDataRoute<Context>
    | undefined
    | Promise<SelectedDataRoute<Context> | undefined>;
  production?: boolean;
  /** Additional dispatcher-owned request identities, never public payload. */
  privateValues?: readonly unknown[];
}): Promise<Response | undefined> {
  // Classify before cloning: cloning a non-data POST can transfer its body.
  const url = new URL(options.request.url);
  const routeId = url.searchParams.get(LOADER_ID_PARAM);
  if (!routeId) return undefined;
  identityCacheKey(options.identity);
  const context = options.context;
  const cancellation = new AbortController();
  const request = new Request(options.request, {
    signal: AbortSignal.any([options.request.signal, cancellation.signal]),
  });
  request.signal.throwIfAborted();
  const policy = createRequestDataPolicy([
    context,
    options.request,
    request,
    ...(options.privateValues ?? []),
  ]);
  if (
    !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
  ) {
    return new Response('Unsupported data method', {
      status: 405,
      headers: {
        allow: 'GET, HEAD, POST, PUT, PATCH, DELETE',
        'cache-control': 'no-store',
      },
    });
  }
  const operation: DataOperation =
    request.method === 'GET' || request.method === 'HEAD' ? 'loader' : 'action';
  const selected = await options.selectRoute(request, routeId, operation);
  request.signal.throwIfAborted();
  if (!selected || selected.routeId !== routeId) {
    return new Response('Data route is not authorized for this URL', {
      status: 403,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const productionOptions =
    options.production === undefined ? {} : { production: options.production };
  const outcome = await invokeOwnedRouteData(
    selected.handler,
    {
      request,
      routeId,
      params: selected.params,
      context,
    },
    productionOptions,
    policy,
  );
  const response = createDataResponse(outcome, options.identity, {
    routeId,
    operation,
    signal: request.signal,
    ...productionOptions,
    onCancel: reason => cancellation.abort(reason),
  });
  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}
