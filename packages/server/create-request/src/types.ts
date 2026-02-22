import type { HttpMethodDecider } from '@modern-js/types';

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

export type OperationContext = {
  operationId?: string;
  routePath?: string;
  method?: string;
  schemaHash?: string;
  operationVersion?: number;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
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
  setDomain?: (ops?: {
    target: 'server' | 'browser';
    requestId?: string;
  }) => string;
  requestId?: string;
};
