export { measureTextBytes, normalizeMethod } from './batch/request';
export {
  createDataBatchTransport,
  createDataBatchTransportTelemetryAttributes,
  DATA_BATCH_TRANSPORT_OTEL_EVENT,
  emitDataBatchTransportEvent,
} from './batch-transport';
export {
  buildQueryKey,
  buildScopeKey,
  createOperationId,
  decodeRequestEnvelopeHeader,
  encodeRequestEnvelopeHeader,
  isPlainObject,
  normalizeOrigin,
  stableStringify,
} from './codec';
export {
  createInvalidationEvent,
  shouldApplyInvalidation,
} from './invalidation';
export {
  deriveChildTraceContext,
  formatTraceparentHeader,
  parseTraceparentHeader,
} from './trace';
export type {
  CacheScope,
  DataBatchBody,
  DataBatchHeader,
  DataBatchRequestItem,
  DataBatchRequestPayload,
  DataBatchResponseItem,
  DataBatchResponsePayload,
  DataBatchTransportEvent,
  DataBatchTransportOptions,
  DataBatchTransportTelemetryAttributes,
  DataMutationMode,
  DataRequestMode,
  HydrationEnvelope,
  HydrationEnvelopeValidationOptions,
  InvalidationEvent,
  InvalidationSubscriber,
  OperationDescriptor,
  RequestEnvelope,
  RequestEnvelopeValidationOptions,
  SelectionPlan,
  SelectionPlanValidationOptions,
  SelectionPlanValidationResult,
  TraceContext,
} from './types';
export {
  DEFAULT_DATA_BATCH_ENDPOINT,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
} from './types';
export {
  createHydrationEnvelope,
  createRequestEnvelope,
  validateHydrationEnvelope,
  validateRequestEnvelope,
  validateSelectionPlan,
} from './validation';
