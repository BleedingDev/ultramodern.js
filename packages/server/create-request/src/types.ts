import type { HttpMethodDecider } from '@modern-js/types';

export const BFF_ENVELOPE_HEADER = 'x-modernjs-bff-envelope';
export const BFF_OPERATION_CONTEXT_HEADER = 'x-operation-id';
export const BFF_OPERATION_CONTEXT_DETAIL_HEADER =
  'x-modernjs-bff-operation-context';
export const BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS = [
  'x-tenant-id',
  'x-subject-id',
  'x-user-id',
  BFF_OPERATION_CONTEXT_HEADER,
] as const;

export type BFFRequestPayload = {
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: string;
  formUrlencoded?: string | Record<string, any> | URLSearchParams;
  formData?: FormData;
  data?: Record<string, any>;
  headers?: Record<string, any>;
  cookies?: Record<string, any>;
  files?: Record<string, any>;
};

export type Sender<F = typeof fetch> = ((...args: any[]) => Promise<any>) & {
  fetch?: F;
};

export type ResolveHeadersOptions = {
  requestId: string;
  allowedHeaders: string[];
  incomingHeaders: Record<string, any>;
};

export type ResolveHeaders = (
  options: ResolveHeadersOptions,
) => Record<string, any> | void;

export type AllowCrossOriginEnvelopeOptions = {
  requestId: string;
  sourceOrigin?: string;
  targetOrigin?: string;
  target: 'server' | 'browser';
};

export type AllowCrossOriginEnvelope =
  | boolean
  | ((options: AllowCrossOriginEnvelopeOptions) => boolean);

export type TransportTarget = 'server' | 'browser';

export type RetryDecisionContext = {
  requestId: string;
  target: TransportTarget;
  method: string;
  url: string;
  attempt: number;
  maxAttempts: number;
  error: unknown;
  statusCode?: number;
};

export type RetryBackoffOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryableStatusCodes?: number[];
  shouldRetry?: (context: RetryDecisionContext) => boolean;
};

export type DegradedModeReason = 'timeout' | 'retry' | 'retry_exhausted';

export type DegradedModeEvent = {
  requestId: string;
  target: TransportTarget;
  method: string;
  url: string;
  reason: DegradedModeReason;
  attempt: number;
  maxAttempts: number;
  timeoutMs?: number;
  backoffMs?: number;
  statusCode?: number;
  error?: unknown;
};

export type TransportResilienceOptions = {
  timeoutMs?: number;
  retry?: RetryBackoffOptions;
  onDegraded?: (event: DegradedModeEvent) => void;
};

export type IdentityBindingViolationReason =
  | 'client_override_blocked'
  | 'client_override_rejected';

export type IdentityBindingViolation = {
  requestId: string;
  target: TransportTarget;
  header: string;
  reason: IdentityBindingViolationReason;
  attemptedValue?: unknown;
  derivedValue?: unknown;
};

export type DeriveIdentityHeadersOptions = {
  requestId: string;
  target: TransportTarget;
  incomingHeaders: Record<string, any>;
  protectedHeaders: string[];
};

export type IdentityBindingOptions = {
  enabled?: boolean;
  strict?: boolean;
  protectedHeaders?: string[];
  deriveHeaders?: (
    options: DeriveIdentityHeadersOptions,
  ) => Record<string, any> | void;
  onViolation?: (violation: IdentityBindingViolation) => void;
};

export type OperationContractViolationReason =
  | 'missing_schema_hash'
  | 'missing_operation_version';

export type OperationContractViolation = {
  requestId: string;
  target: TransportTarget;
  operationId: string;
  reason: OperationContractViolationReason;
  routePath?: string;
  method?: string;
  schemaHash?: string;
  operationVersion?: number;
};

export type CrossProjectOperationContract = {
  schemaHash?: string;
  operationVersion?: number;
};

export type CrossProjectPolicyViolationReason =
  | 'missing_envelope'
  | 'invalid_envelope'
  | 'missing_request_id'
  | 'namespace_not_allowed'
  | 'missing_operation_context'
  | 'operation_context_mismatch'
  | 'missing_operation_context_details'
  | 'invalid_operation_context_details'
  | 'operation_context_details_request_id_mismatch'
  | 'missing_operation_schema_hash'
  | 'missing_operation_version'
  | 'unknown_operation_contract'
  | 'operation_schema_hash_mismatch'
  | 'operation_version_mismatch';

export type CrossProjectPolicyViolation = {
  code: 'BFF_CROSS_PROJECT_POLICY_DENIED';
  reason: CrossProjectPolicyViolationReason;
  message: string;
  status: number;
};

export type OperationContractOptions = {
  enabled?: boolean;
  strict?: boolean;
  requireSchemaHash?: boolean;
  requireOperationVersion?: boolean;
  onViolation?: (violation: OperationContractViolation) => void;
};

export type OperationContextSource =
  | 'client'
  | 'server'
  | 'generated-client'
  | 'effect-adapter'
  | 'data-platform'
  | 'unknown';

export type OperationContext = {
  requestId?: string;
  operationId?: string;
  routePath?: string;
  method?: string;
  schemaHash?: string;
  operationVersion?: number;
  locale?: string;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
  source?: OperationContextSource;
  scope?: Record<string, unknown>;
  sessionClaims?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};

export type RequestCreatorOptions<F = typeof fetch> = {
  path: string;
  method: string;
  port: number;
  httpMethodDecider?: HttpMethodDecider;
  fetch?: F;
  domain?: string;
  requestId?: string;
  operationContext?: OperationContext;
};

export type RequestCreator<F = typeof fetch> = {
  (options: RequestCreatorOptions<F>): Sender;
  (
    path: string,
    method: string,
    port: number,
    httpMethodDecider?: HttpMethodDecider,
    fetch?: F,
    requestId?: string,
    operationContext?: OperationContext,
  ): Sender;
};

export type UploadCreatorOptions = {
  path: string;
  domain?: string;
  requestId?: string;
};

export type UploadCreator = (options: UploadCreatorOptions) => Sender;

export type IOptions<F = typeof fetch> = {
  request?: F;
  interceptor?: (request: F) => F;
  allowedHeaders?: string[];
  resolveHeaders?: ResolveHeaders;
  transport?: TransportResilienceOptions;
  requireEnvelope?: boolean;
  allowCrossOriginEnvelope?: AllowCrossOriginEnvelope;
  identityBinding?: IdentityBindingOptions;
  operationContract?: OperationContractOptions;
  setDomain?: (ops?: {
    target: 'server' | 'browser';
    requestId?: string;
  }) => string;
  requestId?: string;
};
