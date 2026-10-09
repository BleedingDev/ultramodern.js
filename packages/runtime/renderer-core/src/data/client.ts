import { assertRendererIdentity, type RendererIdentity } from '../identity';
import { readBoundedDataText } from './body';
import { DataProtocolError, MAX_DATA_BYTES, parsePublicData } from './codec';
import {
  isPrerenderedDocument,
  isStaticDataPayload,
  staticDataPayloadPath,
} from './static';
import {
  DATA_CONTENT_TYPE,
  DATA_PROTOCOL_VERSION,
  DATA_STREAM_CONTENT_TYPE,
  type DataOperation,
  type DataWireEnvelope,
  type DecodedDataOutcome,
  DIRECT_PARAM,
  LOADER_ID_PARAM,
  type PublicDataError,
  type PublicDataOutcome,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function assertKeys(record: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(record).some(key => !keys.includes(key))) {
    throw new DataProtocolError('Unknown data protocol field');
  }
}

function assertError(value: unknown): asserts value is PublicDataError {
  if (!isRecord(value)) throw new DataProtocolError('Malformed public error');
  assertKeys(value, ['name', 'message', 'stack']);
  if (
    typeof value['name'] !== 'string' ||
    typeof value['message'] !== 'string' ||
    (Object.hasOwn(value, 'stack') && typeof value['stack'] !== 'string')
  ) {
    throw new DataProtocolError('Malformed public error');
  }
}

function assertEnvelope(
  value: unknown,
  expected: {
    identity: RendererIdentity;
    routeId: string;
    operation: DataOperation;
  },
): asserts value is DataWireEnvelope {
  if (
    !isRecord(value) ||
    value['version'] !== DATA_PROTOCOL_VERSION ||
    value['routeId'] !== expected.routeId ||
    value['operation'] !== expected.operation ||
    !isRecord(value['identity']) ||
    !isRecord(value['outcome'])
  ) {
    throw new DataProtocolError('Data protocol or route identity mismatch');
  }
  assertKeys(value, [
    'version',
    'identity',
    'routeId',
    'operation',
    'outcome',
    'deferredKeys',
  ]);
  assertKeys(value['identity'], [
    'renderer',
    'appId',
    'entryName',
    'protocolVersion',
    'buildId',
  ]);
  try {
    assertRendererIdentity(
      value['identity'] as unknown as RendererIdentity,
      expected.identity,
    );
  } catch {
    throw new DataProtocolError('Data renderer or build identity mismatch');
  }
  const outcome = value['outcome'];
  if (
    !Number.isInteger(outcome['status']) ||
    (outcome['status'] as number) < 200 ||
    (outcome['status'] as number) > 599
  ) {
    throw new DataProtocolError('Malformed data response status');
  }
  switch (outcome['kind']) {
    case 'success':
      assertKeys(outcome, ['kind', 'value', 'status']);
      break;
    case 'redirect':
      assertKeys(outcome, ['kind', 'location', 'status']);
      if (
        typeof outcome['location'] !== 'string' ||
        ![301, 302, 303, 307, 308].includes(outcome['status'] as number)
      ) {
        throw new DataProtocolError('Malformed data redirect');
      }
      break;
    case 'not-found':
      assertKeys(outcome, ['kind', 'value', 'thrown', 'status']);
      if (outcome['status'] !== 404 || typeof outcome['thrown'] !== 'boolean')
        throw new DataProtocolError('Malformed not-found outcome');
      break;
    case 'error':
      assertKeys(outcome, ['kind', 'error', 'data', 'thrown', 'status']);
      assertError(outcome['error']);
      if (typeof outcome['thrown'] !== 'boolean')
        throw new DataProtocolError('Malformed error outcome');
      break;
    default:
      throw new DataProtocolError('Unknown data outcome');
  }
  if (Object.hasOwn(value, 'deferredKeys')) {
    if (
      !Array.isArray(value['deferredKeys']) ||
      value['deferredKeys'].some(key => typeof key !== 'string') ||
      new Set(value['deferredKeys']).size !== value['deferredKeys'].length ||
      outcome['kind'] !== 'success' ||
      !isRecord(outcome['value']) ||
      value['deferredKeys'].some(key =>
        Object.hasOwn(outcome['value'] as object, key),
      )
    ) {
      throw new DataProtocolError('Malformed deferred data keys');
    }
  }
}

function dataError(error: PublicDataError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack !== undefined) result.stack = error.stack;
  else delete result.stack;
  return result;
}

async function readDeferredResponse(
  response: Response,
  expected: {
    identity: RendererIdentity;
    routeId: string;
    operation: DataOperation;
  },
  signal?: AbortSignal,
): Promise<DecodedDataOutcome> {
  if (!response.body) throw new DataProtocolError('Missing deferred data body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let initialized = false;
  let completed = false;
  let initialResolve!: (outcome: DecodedDataOutcome) => void;
  let initialReject!: (reason: unknown) => void;
  const initial = new Promise<DecodedDataOutcome>((resolve, reject) => {
    initialResolve = resolve;
    initialReject = reject;
  });
  let completionResolve!: () => void;
  let completionReject!: (reason: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });
  void completion.catch(() => undefined);
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  const reject = (error: unknown) => {
    completionReject(error);
    if (!initialized) initialReject(error);
    for (const promise of pending.values()) promise.reject(error);
    pending.clear();
  };
  const abort = () => {
    const reason =
      signal?.reason ??
      new DOMException('The data request was aborted', 'AbortError');
    reject(reason);
    void reader.cancel(reason).catch(() => undefined);
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const consume = (text: string) => {
    if (completed)
      throw new DataProtocolError('Data frames follow stream completion');
    const frame = parsePublicData(text);
    if (!isRecord(frame))
      throw new DataProtocolError('Malformed data stream frame');
    if (frame['type'] === 'initial') {
      assertKeys(frame, ['type', 'envelope']);
      if (initialized)
        throw new DataProtocolError('Duplicate initial data frame');
      assertEnvelope(frame['envelope'], expected);
      const envelope = frame['envelope'];
      if (
        !Array.isArray(envelope.deferredKeys) ||
        envelope.outcome.kind !== 'success'
      ) {
        throw new DataProtocolError('Initial stream frame needs deferred keys');
      }
      // The decoded critical record itself receives the promises, keeping
      // its identity, self-references and prototype.
      const value = envelope.outcome.value as Record<string, unknown>;
      for (const key of envelope.deferredKeys) {
        const promise = new Promise<unknown>((resolve, rejectPromise) => {
          pending.set(key, { resolve, reject: rejectPromise });
        });
        void promise.catch(() => undefined);
        Object.defineProperty(value, key, {
          value: promise,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      initialized = true;
      const outcome: DecodedDataOutcome = { ...envelope.outcome, value };
      Object.defineProperty(outcome, 'completion', { value: completion });
      initialResolve(outcome);
      return;
    }
    if (!initialized)
      throw new DataProtocolError(
        'Deferred data arrived before the initial frame',
      );
    if (frame['type'] === 'complete') {
      assertKeys(frame, ['type']);
      if (pending.size !== 0)
        throw new DataProtocolError(
          'Deferred stream completed with unresolved values',
        );
      completed = true;
      return;
    }
    if (frame['type'] !== 'resolve' && frame['type'] !== 'reject')
      throw new DataProtocolError('Unknown data stream frame');
    assertKeys(
      frame,
      frame['type'] === 'resolve'
        ? ['type', 'key', 'value']
        : ['type', 'key', 'error'],
    );
    if (typeof frame['key'] !== 'string' || !pending.has(frame['key']))
      throw new DataProtocolError('Unknown or duplicate deferred data key');
    const promise = pending.get(frame['key'])!;
    if (frame['type'] === 'resolve') promise.resolve(frame['value']);
    else {
      assertError(frame['error']);
      promise.reject(dataError(frame['error']));
    }
    pending.delete(frame['key']);
  };
  const append = (text: string) => {
    buffer += text;
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (!line) throw new DataProtocolError('Empty data stream frame');
      consume(line);
      lineEnd = buffer.indexOf('\n');
    }
    if (new TextEncoder().encode(buffer).byteLength > MAX_DATA_BYTES) {
      throw new DataProtocolError('Deferred data frame exceeds its size limit');
    }
  };
  void (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          append(decoder.decode());
          break;
        }
        // A transport may combine many frames in one chunk. Decode bounded pieces.
        for (let offset = 0; offset < chunk.value.byteLength; offset += 65536) {
          append(
            decoder.decode(chunk.value.subarray(offset, offset + 65536), {
              stream: true,
            }),
          );
        }
      }
      if (buffer !== '' || !completed)
        throw new DataProtocolError('Truncated deferred data stream');
      completionResolve();
    } catch (error) {
      reject(error);
      void reader.cancel(error).catch(() => undefined);
    } finally {
      signal?.removeEventListener('abort', abort);
      reader.releaseLock();
    }
  })();
  return initial;
}

export async function readDataResponse(
  response: Response,
  expected: {
    identity: RendererIdentity;
    routeId: string;
    operation: DataOperation;
  },
  signal?: AbortSignal,
): Promise<DecodedDataOutcome> {
  signal?.throwIfAborted();
  const contentType = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim();
  if (contentType === DATA_STREAM_CONTENT_TYPE)
    return readDeferredResponse(response, expected, signal);
  if (contentType !== DATA_CONTENT_TYPE)
    throw new DataProtocolError(
      `Expected an UltraModern data response, received HTTP ${response.status}`,
    );
  const value = parsePublicData(await readBoundedDataText(response, signal));
  signal?.throwIfAborted();
  assertEnvelope(value, expected);
  if (Object.hasOwn(value, 'deferredKeys'))
    throw new DataProtocolError('Deferred values require the stream protocol');
  return value.outcome;
}

/**
 * A payload wraps one data response as a JSON string, whose escaping can
 * grow it up to six times.
 */
const STATIC_PAYLOAD_MAX_BYTES = MAX_DATA_BYTES * 6 + 1024;

/**
 * A prerendered document can be hosted without a server. Its search-free
 * loader payloads were captured beside it at build time; anything missing
 * falls through to the server data request.
 */
async function readStaticPayload(
  url: URL,
  routeId: string,
  fetchData: typeof globalThis.fetch,
  request: Request,
): Promise<Response | undefined> {
  if (url.search || !isPrerenderedDocument()) return undefined;
  let response: Response;
  try {
    response = await fetchData(
      new URL(staticDataPayloadPath(url.pathname, routeId), url),
      { credentials: 'same-origin', signal: request.signal },
    );
  } catch {
    request.signal.throwIfAborted();
    return undefined;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  let payload: unknown;
  try {
    // Read like any data response: bounded, and cancelled with the request.
    payload = JSON.parse(
      await readBoundedDataText(
        response,
        request.signal,
        STATIC_PAYLOAD_MAX_BYTES,
      ),
    );
  } catch {
    request.signal.throwIfAborted();
    return undefined;
  }
  if (!isStaticDataPayload(payload)) return undefined;
  return new Response(payload.body, {
    status: payload.status,
    headers: { 'content-type': payload.contentType },
  });
}

/**
 * Buffer a request body through its own reader, so aborting the request
 * cancels a slow or never-ending source stream instead of waiting on it.
 */
async function bufferRequestBody(request: Request): Promise<Blob | null> {
  if (!request.body) return null;
  const { signal } = request;
  const reader = request.body.getReader();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      chunks.push(part.value);
    }
    return new Blob(chunks as BlobPart[], {
      type: request.headers.get('content-type') ?? '',
    });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function createDataClient(
  routeId: string,
  identity: RendererIdentity,
  options: { fetch?: typeof globalThis.fetch } = {},
): {
  loader(input: { request: Request }): Promise<DecodedDataOutcome>;
  action(input: { request: Request }): Promise<DecodedDataOutcome>;
} {
  if (!routeId)
    throw new DataProtocolError('A data client requires a route ID');
  const fetchData = options.fetch ?? globalThis.fetch;
  const execute = async (
    operation: DataOperation,
    input: { request: Request },
  ) => {
    const request = input.request;
    request.signal.throwIfAborted();
    if (operation === 'loader' && request.method !== 'GET')
      throw new DataProtocolError('A loader client needs a GET Request');
    if (operation === 'action' && ['GET', 'HEAD'].includes(request.method))
      throw new DataProtocolError('An action client needs a mutation Request');
    const url = new URL(request.url);
    if (operation === 'loader') {
      const replayed = await readStaticPayload(
        url,
        routeId,
        fetchData,
        request,
      );
      if (replayed)
        return readDataResponse(
          replayed,
          { identity, routeId, operation },
          request.signal,
        );
    }
    url.searchParams.set(LOADER_ID_PARAM, routeId);
    url.searchParams.set(DIRECT_PARAM, 'true');
    // Browsers only stream request bodies over HTTP/2, so the action body
    // is buffered instead of forwarding the source request's stream.
    const proxyRequest = new Request(url, {
      method: request.method,
      headers: request.headers,
      body: operation === 'action' ? await bufferRequestBody(request) : null,
      signal: request.signal,
    });
    const response = await fetchData(proxyRequest, {
      credentials: 'same-origin',
      redirect: 'manual',
      signal: request.signal,
    });
    return readDataResponse(
      response,
      { identity, routeId, operation },
      request.signal,
    );
  };
  return {
    loader: input => execute('loader', input),
    action: input => execute('action', input),
  };
}
