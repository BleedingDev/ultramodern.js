// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
/**
 * Data-platform envelope (`x-modernjs-data-envelope`): the TRANSPORT/CACHE
 * contract of the effect lane — protocol versioning, cache scope keys,
 * selection plans, batching and hydration checksums.
 *
 * Boundary note (one envelope system per concern): cross-project
 * AUTHORIZATION is the bff-core policy's job (`x-modernjs-bff-envelope` +
 * operation contracts, evaluated server-side in both the hono and effect
 * lanes). Nothing in this module is a trust boundary; treat every value
 * here as client-asserted cache metadata.
 */

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
  body?: DataBatchBody;
}

export interface DataBatchRequestPayload {
  protocolVersion: 2;
  batchId: string;
  sentAt: number;
  items: DataBatchRequestItem[];
}

export interface DataBatchResponseItem {
  id: string;
  status: number;
  headers?: DataBatchHeader[];
  body?: DataBatchBody;
}

export interface DataBatchBody {
  encoding: 'base64';
  data: string;
}

export type DataBatchHeader = [name: string, value: string];

export interface DataBatchResponsePayload {
  protocolVersion: 2;
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

export type DataTransportRequestInfo = string | URL | Request;
