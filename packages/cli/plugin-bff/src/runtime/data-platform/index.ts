// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { trace } from '@opentelemetry/api';

export type DataRequestMode =
  | 'cache-first'
  | 'stale-while-revalidate'
  | 'network-only';

export type DataMutationMode = 'optimistic' | 'pessimistic' | 'fire-and-forget';

export type SelectionPlan = {
  [field: string]: true | SelectionPlan;
};

export interface OperationDescriptor {
  appNamespace: string;
  apiId: string;
  group: string;
  endpoint: string;
  schemaHash?: string;
  version?: number;
}

export interface CacheScope {
  appNamespace: string;
  origin: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
  parentSpanId?: string;
}

export interface RequestEnvelope<Input = unknown> {
  protocolVersion: 1;
  operationId: string;
  appNamespace: string;
  origin: string;
  requestMode: DataRequestMode;
  mutationMode?: DataMutationMode;
  scopeKey: string;
  input: Input;
  inputHash: string;
  selectionPlan?: SelectionPlan;
  selectionHash?: string;
  traceparent?: string;
  timestamp: number;
}

export interface HydrationEnvelope<Payload = unknown> {
  protocolVersion: 1;
  runtimeVersion: string;
  appNamespace: string;
  origin: string;
  createdAt: number;
  payload: Payload;
  checksum: string;
}

export interface InvalidationEvent {
  sourceNamespace: string;
  sourceOperationId: string;
  scopeKey: string;
  targetNamespaces?: string[];
  targetOperationIds?: string[];
}

export interface InvalidationSubscriber {
  namespace: string;
  operationIds?: string[];
  scopeKey?: string;
  acceptCrossNamespace?: boolean;
}

export interface DataBatchRequestItem {
  id: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DataBatchRequestPayload {
  protocolVersion: 1;
  batchId: string;
  sentAt: number;
  items: DataBatchRequestItem[];
}

export interface DataBatchResponseItem {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface DataBatchResponsePayload {
  protocolVersion: 1;
  batchId: string;
  receivedAt: number;
  items: DataBatchResponseItem[];
}

export interface DataBatchTransportEvent {
  type: 'enqueue' | 'flush' | 'fallback' | 'disable';
  endpoint: string;
  batchId?: string;
  size?: number;
  reason?: string;
}

export type DataBatchTransportTelemetryAttributes = Record<
  string,
  string | number | boolean
>;

export interface DataBatchTransportOptions {
  endpoint?: string;
  fetch?: (
    input: DataTransportRequestInfo,
    init?: RequestInit,
  ) => Promise<Response>;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxBatchBytes?: number;
  requestTimeoutMs?: number;
  allowedMethods?: string[];
  onEvent?: (event: DataBatchTransportEvent) => void;
}

export const DATA_BATCH_TRANSPORT_OTEL_EVENT = 'modernjs.data.batch';

export function createDataBatchTransportTelemetryAttributes(
  event: DataBatchTransportEvent,
): DataBatchTransportTelemetryAttributes {
  return {
    'modernjs.data.batch.type': event.type,
    'modernjs.data.batch.endpoint': event.endpoint,
    'modernjs.data.batch.degraded':
      event.type === 'fallback' || event.type === 'disable',
    ...(event.batchId ? { 'modernjs.data.batch.id': event.batchId } : {}),
    ...(typeof event.size === 'number'
      ? { 'modernjs.data.batch.size': event.size }
      : {}),
    ...(event.reason ? { 'modernjs.data.batch.reason': event.reason } : {}),
  };
}

export function emitDataBatchTransportEvent(
  onEvent: ((event: DataBatchTransportEvent) => void) | undefined,
  event: DataBatchTransportEvent,
) {
  onEvent?.(event);
  trace
    .getActiveSpan()
    ?.addEvent(
      DATA_BATCH_TRANSPORT_OTEL_EVENT,
      createDataBatchTransportTelemetryAttributes(event),
    );
}

export interface SelectionPlanValidationOptions {
  maxDepth?: number;
  maxFields?: number;
  allowedLeafPaths?: ReadonlyArray<string>;
}

export interface SelectionPlanValidationResult {
  ok: boolean;
  errors: string[];
  stats: {
    maxDepth: number;
    fieldCount: number;
  };
}

export interface RequestEnvelopeValidationOptions {
  expectedProtocolVersion?: number;
  expectedNamespace?: string;
  expectedOrigin?: string;
  requireTraceContext?: boolean;
}

export interface HydrationEnvelopeValidationOptions {
  expectedProtocolVersion?: number;
  expectedNamespace?: string;
  expectedOrigin?: string;
  expectedRuntimeVersion?: string;
}

export const DEFAULT_DATA_ENVELOPE_HEADER = 'x-modernjs-data-envelope';
export const DEFAULT_DATA_BATCH_ENDPOINT = '/_data/batch';
export const DEFAULT_DATA_BATCH_HEADER = 'x-modernjs-data-batch';

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
type DataTransportRequestInfo = string | URL | Request;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function encodeRequestEnvelopeHeader(envelope: RequestEnvelope): string {
  return encodeURIComponent(stableStringify(envelope));
}

function isRequestEnvelopeShape(value: unknown): value is RequestEnvelope {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    value.protocolVersion === 1 &&
    typeof value.operationId === 'string' &&
    typeof value.appNamespace === 'string' &&
    typeof value.origin === 'string' &&
    typeof value.scopeKey === 'string' &&
    typeof value.inputHash === 'string' &&
    typeof value.timestamp === 'number'
  );
}

export function decodeRequestEnvelopeHeader(
  value: string,
): RequestEnvelope | null {
  try {
    const decoded = decodeURIComponent(value);
    const parsed = JSON.parse(decoded);
    if (!isRequestEnvelopeShape(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeSegment(segment: string): string {
  const normalized = segment.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalized.length > 0 ? normalized : 'unknown';
}

export function normalizeOrigin(origin: string): string {
  const normalized = origin.trim();
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function normalizeOperationDescriptor(input: OperationDescriptor) {
  return {
    appNamespace: sanitizeSegment(input.appNamespace),
    apiId: sanitizeSegment(input.apiId),
    group: sanitizeSegment(input.group),
    endpoint: sanitizeSegment(input.endpoint),
    schemaHash: input.schemaHash || null,
    version: input.version ?? 1,
  };
}

export function createOperationId(input: OperationDescriptor): string {
  const descriptor = normalizeOperationDescriptor(input);
  const readable = `${descriptor.appNamespace}.${descriptor.apiId}.${descriptor.group}.${descriptor.endpoint}.v${String(descriptor.version)}`;
  return `${readable}:${hashString(stableStringify(descriptor))}`;
}

export function buildScopeKey(scope: CacheScope): string {
  const canonical = {
    appNamespace: sanitizeSegment(scope.appNamespace),
    origin: normalizeOrigin(scope.origin),
    tenantId: scope.tenantId ?? null,
    userId: scope.userId ?? null,
    sessionId: scope.sessionId ?? null,
  };
  return `${canonical.appNamespace}:${hashString(stableStringify(canonical))}`;
}

export function buildQueryKey(input: {
  operationId: string;
  scopeKey: string;
  requestMode?: DataRequestMode;
  requestInput?: unknown;
  selectionPlan?: SelectionPlan;
}): string {
  const canonical = {
    operationId: input.operationId,
    scopeKey: input.scopeKey,
    requestMode: input.requestMode ?? 'cache-first',
    requestInput: input.requestInput ?? null,
    selectionPlan: input.selectionPlan ?? null,
  };

  return `${input.operationId}:${hashString(stableStringify(canonical))}`;
}

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value);
}

function isValidHex(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/.test(value);
}

export function parseTraceparentHeader(header: string): TraceContext | null {
  const match = header.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return null;
  }

  const traceId = match[1]!.toLowerCase();
  const spanId = match[2]!.toLowerCase();
  const flags = match[3]!.toLowerCase();

  if (isAllZeroHex(traceId) || isAllZeroHex(spanId)) {
    return null;
  }

  const sampled = (Number.parseInt(flags, 16) & 0x1) === 1;

  return {
    traceId,
    spanId,
    sampled,
  };
}

export function formatTraceparentHeader(trace: TraceContext): string {
  const traceId = trace.traceId.toLowerCase();
  const spanId = trace.spanId.toLowerCase();

  if (!isValidHex(traceId, 32) || !isValidHex(spanId, 16)) {
    throw new Error('Invalid trace context: traceId/spanId format mismatch');
  }

  if (isAllZeroHex(traceId) || isAllZeroHex(spanId)) {
    throw new Error('Invalid trace context: traceId/spanId cannot be zero');
  }

  const flags = trace.sampled ? '01' : '00';
  return `00-${traceId}-${spanId}-${flags}`;
}

export function deriveChildTraceContext(
  parent: TraceContext,
  childSpanId: string,
): TraceContext {
  const normalizedSpanId = childSpanId.toLowerCase();
  if (!isValidHex(normalizedSpanId, 16) || isAllZeroHex(normalizedSpanId)) {
    throw new Error('Invalid child span id');
  }

  return {
    traceId: parent.traceId.toLowerCase(),
    spanId: normalizedSpanId,
    sampled: parent.sampled,
    parentSpanId: parent.spanId.toLowerCase(),
  };
}

export function validateSelectionPlan(
  plan: SelectionPlan,
  options: SelectionPlanValidationOptions = {},
): SelectionPlanValidationResult {
  const maxDepthLimit = options.maxDepth ?? 8;
  const maxFieldsLimit = options.maxFields ?? 256;
  const allowedLeafPaths = options.allowedLeafPaths
    ? new Set(options.allowedLeafPaths)
    : null;

  const errors: string[] = [];
  let maxDepth = 0;
  let fieldCount = 0;

  const walk = (node: unknown, path: string[]) => {
    if (!isPlainObject(node)) {
      errors.push(
        `Selection node at "${path.join('.') || '<root>'}" must be an object`,
      );
      return;
    }

    const keys = Object.keys(node);
    if (keys.length === 0) {
      errors.push(
        `Selection node at "${path.join('.') || '<root>'}" cannot be empty`,
      );
      return;
    }

    for (const key of keys) {
      fieldCount += 1;
      if (fieldCount > maxFieldsLimit) {
        errors.push(
          `Selection has too many fields: ${String(fieldCount)} > ${String(maxFieldsLimit)}`,
        );
        return;
      }

      const nextPath = [...path, key];
      const depth = nextPath.length;
      if (depth > maxDepth) {
        maxDepth = depth;
      }
      if (depth > maxDepthLimit) {
        errors.push(
          `Selection exceeds maxDepth at "${nextPath.join('.')}" (${String(depth)} > ${String(maxDepthLimit)})`,
        );
        return;
      }

      const value = (node as Record<string, unknown>)[key];
      if (value === true) {
        if (allowedLeafPaths && !allowedLeafPaths.has(nextPath.join('.'))) {
          errors.push(`Unknown selected field "${nextPath.join('.')}"`);
        }
        continue;
      }

      if (!isPlainObject(value)) {
        errors.push(
          `Invalid selection value at "${nextPath.join('.')}"; expected true or nested object`,
        );
        continue;
      }

      walk(value, nextPath);
    }
  };

  walk(plan, []);

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      maxDepth,
      fieldCount,
    },
  };
}

export function createRequestEnvelope<Input>(input: {
  operation: OperationDescriptor;
  scope: CacheScope;
  requestInput: Input;
  selectionPlan?: SelectionPlan;
  requestMode?: DataRequestMode;
  mutationMode?: DataMutationMode;
  traceContext?: TraceContext;
  requireTraceContext?: boolean;
  timestamp?: number;
  protocolVersion?: 1;
}): RequestEnvelope<Input> {
  if (input.requireTraceContext && !input.traceContext) {
    throw new Error('Trace context is required for this request envelope');
  }

  const traceparent = input.traceContext
    ? formatTraceparentHeader(input.traceContext)
    : undefined;

  const envelope: RequestEnvelope<Input> = {
    protocolVersion: input.protocolVersion ?? 1,
    operationId: createOperationId(input.operation),
    appNamespace: sanitizeSegment(input.scope.appNamespace),
    origin: normalizeOrigin(input.scope.origin),
    requestMode: input.requestMode ?? 'cache-first',
    mutationMode: input.mutationMode,
    scopeKey: buildScopeKey(input.scope),
    input: input.requestInput,
    inputHash: hashString(stableStringify(input.requestInput ?? null)),
    selectionPlan: input.selectionPlan,
    selectionHash: input.selectionPlan
      ? hashString(stableStringify(input.selectionPlan))
      : undefined,
    traceparent,
    timestamp: input.timestamp ?? Date.now(),
  };

  return envelope;
}

export function validateRequestEnvelope(
  envelope: RequestEnvelope,
  options: RequestEnvelopeValidationOptions = {},
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (
    options.expectedProtocolVersion !== undefined &&
    envelope.protocolVersion !== options.expectedProtocolVersion
  ) {
    errors.push(
      `Protocol mismatch: expected ${String(options.expectedProtocolVersion)} but received ${String(envelope.protocolVersion)}`,
    );
  }

  if (
    options.expectedNamespace &&
    envelope.appNamespace !== options.expectedNamespace
  ) {
    errors.push(
      `Namespace mismatch: expected ${options.expectedNamespace} but received ${envelope.appNamespace}`,
    );
  }

  if (options.expectedOrigin) {
    const expectedOrigin = normalizeOrigin(options.expectedOrigin);
    if (envelope.origin !== expectedOrigin) {
      errors.push(
        `Origin mismatch: expected ${expectedOrigin} but received ${envelope.origin}`,
      );
    }
  }

  if (!envelope.operationId) {
    errors.push('Missing operationId');
  }

  if (!envelope.scopeKey) {
    errors.push('Missing scopeKey');
  }

  if (options.requireTraceContext && !envelope.traceparent) {
    errors.push('Missing trace context');
  }

  if (envelope.traceparent && !parseTraceparentHeader(envelope.traceparent)) {
    errors.push('Invalid traceparent header');
  }

  const computedInputHash = hashString(stableStringify(envelope.input ?? null));
  if (computedInputHash !== envelope.inputHash) {
    errors.push('Input hash mismatch');
  }

  if (envelope.selectionPlan) {
    const computedSelectionHash = hashString(
      stableStringify(envelope.selectionPlan),
    );
    if (computedSelectionHash !== envelope.selectionHash) {
      errors.push('Selection hash mismatch');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createHydrationEnvelope<Payload>(input: {
  runtimeVersion: string;
  scope: Pick<CacheScope, 'appNamespace' | 'origin'>;
  payload: Payload;
  createdAt?: number;
  protocolVersion?: 1;
}): HydrationEnvelope<Payload> {
  const envelopeWithoutChecksum = {
    protocolVersion: input.protocolVersion ?? 1,
    runtimeVersion: input.runtimeVersion,
    appNamespace: sanitizeSegment(input.scope.appNamespace),
    origin: normalizeOrigin(input.scope.origin),
    createdAt: input.createdAt ?? Date.now(),
    payload: input.payload,
  };

  const checksum = hashString(stableStringify(envelopeWithoutChecksum));

  return {
    ...envelopeWithoutChecksum,
    checksum,
  };
}

export function validateHydrationEnvelope(
  envelope: HydrationEnvelope,
  options: HydrationEnvelopeValidationOptions = {},
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (
    options.expectedProtocolVersion !== undefined &&
    envelope.protocolVersion !== options.expectedProtocolVersion
  ) {
    errors.push(
      `Protocol mismatch: expected ${String(options.expectedProtocolVersion)} but received ${String(envelope.protocolVersion)}`,
    );
  }

  if (
    options.expectedNamespace &&
    envelope.appNamespace !== options.expectedNamespace
  ) {
    errors.push(
      `Namespace mismatch: expected ${options.expectedNamespace} but received ${envelope.appNamespace}`,
    );
  }

  if (options.expectedOrigin) {
    const expectedOrigin = normalizeOrigin(options.expectedOrigin);
    if (envelope.origin !== expectedOrigin) {
      errors.push(
        `Origin mismatch: expected ${expectedOrigin} but received ${envelope.origin}`,
      );
    }
  }

  if (
    options.expectedRuntimeVersion &&
    envelope.runtimeVersion !== options.expectedRuntimeVersion
  ) {
    errors.push(
      `Runtime version mismatch: expected ${options.expectedRuntimeVersion} but received ${envelope.runtimeVersion}`,
    );
  }

  const checksumBase = {
    protocolVersion: envelope.protocolVersion,
    runtimeVersion: envelope.runtimeVersion,
    appNamespace: envelope.appNamespace,
    origin: envelope.origin,
    createdAt: envelope.createdAt,
    payload: envelope.payload,
  };

  const checksum = hashString(stableStringify(checksumBase));
  if (checksum !== envelope.checksum) {
    errors.push('Hydration checksum mismatch');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createInvalidationEvent(input: {
  sourceOperation: OperationDescriptor;
  sourceScope: CacheScope;
  targetNamespaces?: string[];
  targetOperations?: OperationDescriptor[];
}): InvalidationEvent {
  return {
    sourceNamespace: sanitizeSegment(input.sourceOperation.appNamespace),
    sourceOperationId: createOperationId(input.sourceOperation),
    scopeKey: buildScopeKey(input.sourceScope),
    targetNamespaces: input.targetNamespaces?.map(namespace =>
      sanitizeSegment(namespace),
    ),
    targetOperationIds: input.targetOperations?.map(operation =>
      createOperationId(operation),
    ),
  };
}

export function shouldApplyInvalidation(
  event: InvalidationEvent,
  subscriber: InvalidationSubscriber,
): boolean {
  if (subscriber.scopeKey && subscriber.scopeKey !== event.scopeKey) {
    return false;
  }

  const sameNamespace = subscriber.namespace === event.sourceNamespace;
  const allowedCrossNamespace =
    subscriber.acceptCrossNamespace === true &&
    event.targetNamespaces?.includes(subscriber.namespace) === true;

  if (!sameNamespace && !allowedCrossNamespace) {
    return false;
  }

  if (!subscriber.operationIds || subscriber.operationIds.length === 0) {
    return true;
  }

  if (!event.targetOperationIds || event.targetOperationIds.length === 0) {
    return true;
  }

  return subscriber.operationIds.some(operationId =>
    event.targetOperationIds?.includes(operationId),
  );
}

function resolveRuntimeOrigin() {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { location?: { origin?: string } }).location &&
    typeof (globalThis as { location?: { origin?: string } }).location
      ?.origin === 'string'
  ) {
    return (globalThis as { location?: { origin?: string } }).location!.origin!;
  }

  return 'http://localhost';
}

function toAbsoluteUrl(input: DataTransportRequestInfo) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return new URL(input.url);
  }

  const value = String(input);
  try {
    return new URL(value);
  } catch {
    return new URL(value, resolveRuntimeOrigin());
  }
}

function normalizeBatchEndpoint(
  requestUrl: URL,
  endpoint: string | undefined,
): URL {
  const value = endpoint || DEFAULT_DATA_BATCH_ENDPOINT;
  try {
    return new URL(value);
  } catch {
    return new URL(value, requestUrl.origin);
  }
}

function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const next: Record<string, string> = {};
    headers.forEach((value, key) => {
      next[key.toLowerCase()] = value;
    });
    return next;
  }

  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[String(key).toLowerCase()] = String(value);
      return acc;
    }, {});
  }

  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === 'undefined') {
        return acc;
      }
      acc[String(key).toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : String(value);
      return acc;
    },
    {},
  );
}

function isBatchResponseItem(value: unknown): value is DataBatchResponseItem {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'number'
  );
}

function isBatchResponsePayload(
  value: unknown,
): value is DataBatchResponsePayload {
  return (
    isPlainObject(value) &&
    value.protocolVersion === 1 &&
    typeof value.batchId === 'string' &&
    typeof value.receivedAt === 'number' &&
    Array.isArray(value.items) &&
    value.items.every(item => isBatchResponseItem(item))
  );
}

function measureTextBytes(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value);
  }
  return value.length;
}

function createBatchId() {
  const now = Date.now().toString(36);
  const random = Math.random().toString(16).slice(2, 10);
  return `batch_${now}_${random}`;
}

function normalizeMethod(method: string | undefined) {
  return (method || 'GET').toUpperCase();
}

function toRequestBody(initBody: BodyInit | null | undefined) {
  if (typeof initBody === 'string') {
    return initBody;
  }

  if (
    typeof URLSearchParams !== 'undefined' &&
    initBody instanceof URLSearchParams
  ) {
    return initBody.toString();
  }

  return undefined;
}

function shouldBatchRequest(input: {
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
  allowedMethods: Set<string>;
  batchEndpoint: string;
  requestUrl: URL;
}) {
  if (input.requestUrl.href === input.batchEndpoint) {
    return false;
  }

  if (input.headers[DEFAULT_DATA_BATCH_HEADER] === 'off') {
    return false;
  }

  if (!input.allowedMethods.has(input.method)) {
    return false;
  }

  if (input.body !== undefined) {
    return false;
  }

  return true;
}

async function parseResponseLikeCreateRequest(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    let data: unknown = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    (response as Response & { data?: unknown }).data = data;
    throw response;
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    return response.json();
  }

  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    return response.text();
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    return response.formData();
  }

  if (contentType.includes('application/octet-stream')) {
    return response.arrayBuffer();
  }

  if (contentType.includes('image/png')) {
    return response;
  }

  return response.text();
}

type QueuedBatchRequest = {
  key: string;
  endpoint: string;
  requestUrl: string;
  requestInit: RequestInit;
  item: DataBatchRequestItem;
  size: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type BatchBucket = {
  items: QueuedBatchRequest[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
};

function ensureBucket(
  buckets: Map<string, BatchBucket>,
  endpoint: string,
): BatchBucket {
  const existing = buckets.get(endpoint);
  if (existing) {
    return existing;
  }

  const next: BatchBucket = {
    items: [],
    bytes: 0,
    timer: null,
    flushing: false,
  };
  buckets.set(endpoint, next);
  return next;
}

export function createDataBatchTransport(
  options: DataBatchTransportOptions = {},
) {
  const fallbackFetch =
    typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
  const baseFetch = options.fetch || fallbackFetch;
  if (!baseFetch) {
    throw new Error('createDataBatchTransport requires a fetch implementation');
  }
  const flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 8);
  const maxBatchSize = Math.max(1, options.maxBatchSize ?? 16);
  const maxBatchBytes = Math.max(1024, options.maxBatchBytes ?? 64 * 1024);
  const requestTimeoutMs = options.requestTimeoutMs;
  const allowedMethods = new Set(
    (options.allowedMethods && options.allowedMethods.length > 0
      ? options.allowedMethods
      : ['GET']
    ).map(method => method.toUpperCase()),
  );
  const onEvent = options.onEvent;

  const buckets = new Map<string, BatchBucket>();
  const pendingByKey = new Map<string, Promise<unknown>>();
  const disabledEndpoints = new Set<string>();

  const runSingle = async (request: QueuedBatchRequest) => {
    const response = await baseFetch(request.requestUrl, request.requestInit);
    return parseResponseLikeCreateRequest(response);
  };

  const settleRequests = async (
    items: QueuedBatchRequest[],
    runner: (item: QueuedBatchRequest) => Promise<unknown>,
  ) => {
    await Promise.all(
      items.map(async item => {
        try {
          const value = await runner(item);
          item.resolve(value);
        } catch (error) {
          item.reject(error);
        } finally {
          pendingByKey.delete(item.key);
        }
      }),
    );
  };

  const flushBucket = async (endpoint: string) => {
    const bucket = buckets.get(endpoint);
    if (!bucket || bucket.flushing) {
      return;
    }

    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }

    if (bucket.items.length === 0) {
      return;
    }

    bucket.flushing = true;
    const items = bucket.items;
    bucket.items = [];
    bucket.bytes = 0;

    if (items.length === 1 || disabledEndpoints.has(endpoint)) {
      emitDataBatchTransportEvent(onEvent, {
        type: disabledEndpoints.has(endpoint) ? 'fallback' : 'flush',
        endpoint,
        size: items.length,
        reason: disabledEndpoints.has(endpoint) ? 'batch-disabled' : undefined,
      });
      await settleRequests(items, runSingle);
      bucket.flushing = false;
      return;
    }

    const batchId = createBatchId();
    const payload: DataBatchRequestPayload = {
      protocolVersion: 1,
      batchId,
      sentAt: Date.now(),
      items: items.map(item => item.item),
    };

    emitDataBatchTransportEvent(onEvent, {
      type: 'flush',
      endpoint,
      batchId,
      size: items.length,
    });

    const payloadJson = JSON.stringify(payload);
    const traceparent =
      items.find(item => typeof item.item.headers?.traceparent === 'string')
        ?.item.headers?.traceparent || undefined;

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        accept: 'application/json, */*;q=0.8',
        'content-type': 'application/json; charset=utf-8',
        [DEFAULT_DATA_BATCH_HEADER]: '1',
        ...(traceparent ? { traceparent } : {}),
      },
      body: payloadJson,
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller =
        requestTimeoutMs && requestTimeoutMs > 0
          ? new AbortController()
          : undefined;
      if (controller) {
        requestInit.signal = controller.signal;
        timeoutHandle = setTimeout(() => {
          controller.abort();
          emitDataBatchTransportEvent(onEvent, {
            type: 'fallback',
            endpoint,
            batchId,
            size: items.length,
            reason: 'batch-timeout',
          });
        }, requestTimeoutMs);
      }

      const response = await baseFetch(endpoint, requestInit);

      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          disabledEndpoints.add(endpoint);
          emitDataBatchTransportEvent(onEvent, {
            type: 'disable',
            endpoint,
            batchId,
            reason: `batch-endpoint-unavailable-${String(response.status)}`,
          });
        } else {
          emitDataBatchTransportEvent(onEvent, {
            type: 'fallback',
            endpoint,
            batchId,
            size: items.length,
            reason: `batch-response-${String(response.status)}`,
          });
        }
        await settleRequests(items, runSingle);
        bucket.flushing = false;
        return;
      }

      const result = (await response.json()) as unknown;
      if (!isBatchResponsePayload(result)) {
        emitDataBatchTransportEvent(onEvent, {
          type: 'fallback',
          endpoint,
          batchId,
          size: items.length,
          reason: 'invalid-batch-response',
        });
        await settleRequests(items, runSingle);
        bucket.flushing = false;
        return;
      }

      const itemMap = new Map<string, DataBatchResponseItem>();
      for (const item of result.items) {
        itemMap.set(item.id, item);
      }

      await settleRequests(items, async request => {
        const resultItem = itemMap.get(request.item.id);
        if (!resultItem) {
          return runSingle(request);
        }

        const reconstructedResponse = new Response(resultItem.body ?? '', {
          status: resultItem.status,
          headers: resultItem.headers,
        });
        return parseResponseLikeCreateRequest(reconstructedResponse);
      });
    } catch (error) {
      emitDataBatchTransportEvent(onEvent, {
        type: 'fallback',
        endpoint,
        batchId,
        size: items.length,
        reason: 'batch-transport-error',
      });
      await settleRequests(items, runSingle);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      bucket.flushing = false;
    }
  };

  return (input: DataTransportRequestInfo, init?: RequestInit) => {
    const requestUrl = toAbsoluteUrl(input);
    const batchEndpointUrl = normalizeBatchEndpoint(
      requestUrl,
      options.endpoint,
    );
    const endpoint = batchEndpointUrl.toString();
    const method = normalizeMethod(init?.method);
    const body = toRequestBody(init?.body ?? null);
    const headers = toHeaderRecord(init?.headers);

    const normalizedInit: RequestInit = {
      ...init,
      method,
      headers,
      body,
    };

    if (
      disabledEndpoints.has(endpoint) ||
      !shouldBatchRequest({
        method,
        body,
        headers,
        allowedMethods,
        batchEndpoint: endpoint,
        requestUrl,
      })
    ) {
      return baseFetch(requestUrl.toString(), normalizedInit).then(
        parseResponseLikeCreateRequest,
      );
    }

    const item: DataBatchRequestItem = {
      id: `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method,
      headers,
      ...(body ? { body } : {}),
    };

    const key = stableStringify({
      endpoint,
      path: item.path,
      method: item.method,
      headers: item.headers,
      body: item.body ?? null,
    });

    const existing = pendingByKey.get(key);
    if (existing) {
      return existing;
    }

    const size = measureTextBytes(stableStringify(item));
    const promise = new Promise<unknown>((resolve, reject) => {
      const bucket = ensureBucket(buckets, endpoint);
      const queued: QueuedBatchRequest = {
        key,
        endpoint,
        requestUrl: requestUrl.toString(),
        requestInit: normalizedInit,
        item,
        size,
        resolve,
        reject,
      };

      bucket.items.push(queued);
      bucket.bytes += size;
      emitDataBatchTransportEvent(onEvent, {
        type: 'enqueue',
        endpoint,
        size: bucket.items.length,
      });

      if (
        bucket.items.length >= maxBatchSize ||
        bucket.bytes >= maxBatchBytes
      ) {
        void flushBucket(endpoint);
        return;
      }

      if (!bucket.timer) {
        bucket.timer = setTimeout(() => {
          bucket.timer = null;
          void flushBucket(endpoint);
        }, flushIntervalMs);
      }
    });

    pendingByKey.set(key, promise);
    return promise;
  };
}
