/**
 * Shared (browser/node) core for the fork-added BFF producer-client policy:
 * envelope construction, operation-context derivation, identity/operation
 * contract violations and header utilities.
 *
 * This module is environment-neutral by design: it must not import node
 * builtins (it is bundled into the browser entry) nor touch `window`
 * directly (it is bundled into the node entry). Environment-specific
 * behaviour (origin resolution, incoming-header forwarding, fetch wiring)
 * stays in `browser.ts` / `node.ts`.
 *
 * Honest scope note: everything produced here (envelope, operation context,
 * schema hash, operation version) is asserted by the CLIENT. It protects
 * against version skew and misconfiguration, not against malicious callers —
 * the server-side policy evaluator in `@modern-js/bff-core` is the actual
 * gate, and only when it is bound to a verified identity.
 */
import { parseTraceparent as parseTraceparentHeader } from './traceparent';
import type {
  IdentityBindingViolation,
  OperationContext,
  OperationContractOptions,
  OperationContractViolation,
  TransportTarget,
} from './types';

export const TRACEPARENT_HEADER = 'traceparent';

const readProcessEnv = (key: string) => {
  if (
    typeof process === 'undefined' ||
    typeof process.env === 'undefined' ||
    typeof process.env[key] !== 'string'
  ) {
    return undefined;
  }

  return process.env[key];
};

const isStrictDefaultRequestIdEnabled = () =>
  readProcessEnv('MODERN_BFF_STRICT_DEFAULT_REQUEST_ID') === 'true';

export const isSecuredRequestId = (requestId: string) =>
  requestId !== 'default' || isStrictDefaultRequestIdEnabled();

export const isEmptyDomain = (domain?: string) =>
  typeof domain !== 'string' || domain.trim() === '';

export const firstHeaderValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

export const findHeaderKey = (headers: Record<string, any>, header: string) => {
  const normalized = header.toLowerCase();
  return Object.keys(headers).find(key => key.toLowerCase() === normalized);
};

export const readHeader = (headers: Record<string, any>, header: string) => {
  const key = findHeaderKey(headers, header);
  return typeof key === 'string' ? headers[key] : undefined;
};

export const writeHeader = (
  headers: Record<string, any>,
  header: string,
  value: unknown,
) => {
  if (typeof value === 'undefined') {
    return;
  }
  const key = findHeaderKey(headers, header);
  if (typeof key === 'string' && key !== header) {
    delete headers[key];
  }
  headers[header] = value;
};

export const deleteHeader = (headers: Record<string, any>, header: string) => {
  const key = findHeaderKey(headers, header);
  if (typeof key === 'string') {
    delete headers[key];
  }
};

export const toOrigin = (value?: string) => {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch (error) {
    return undefined;
  }
};

export const parseTraceparentValue = (value: unknown) =>
  parseTraceparentHeader(firstHeaderValue(value) as string | undefined);

export const extractPathParamNames = (path: string): string[] =>
  Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g)).flatMap(([, key]) =>
    key ? [key] : [],
  );

export const buildOperationContext = ({
  requestId,
  method,
  path,
  operationContext,
  traceparent,
}: {
  requestId: string;
  method: string;
  path: string;
  operationContext?: OperationContext | undefined;
  traceparent?: unknown;
}) => {
  const routePath = operationContext?.routePath || path;
  const operationMethod = (
    operationContext?.method ||
    method ||
    'GET'
  ).toUpperCase();
  const rawOperationId =
    operationContext?.operationId || `${operationMethod}:${routePath}`;
  const operationId = rawOperationId.startsWith(`${requestId}:`)
    ? rawOperationId
    : `${requestId}:${rawOperationId}`;
  const traceparentValue =
    operationContext?.traceparent ||
    (typeof firstHeaderValue(traceparent) === 'string'
      ? String(firstHeaderValue(traceparent))
      : undefined);
  const parsedTraceContext =
    operationContext?.traceId && operationContext?.spanId
      ? {
          traceId: operationContext.traceId,
          spanId: operationContext.spanId,
        }
      : parseTraceparentValue(traceparentValue);

  return {
    requestId,
    operationId,
    routePath,
    method: operationMethod,
    ...(operationContext?.schemaHash
      ? { schemaHash: operationContext.schemaHash }
      : {}),
    ...(typeof operationContext?.operationVersion === 'number'
      ? { operationVersion: operationContext.operationVersion }
      : {}),
    ...(traceparentValue ? { traceparent: traceparentValue } : {}),
    ...(parsedTraceContext
      ? {
          traceId: parsedTraceContext.traceId,
          spanId: parsedTraceContext.spanId,
        }
      : {}),
  };
};

type OperationContextPayload = ReturnType<typeof buildOperationContext>;

export class ProducerClientNotInitializedError extends Error {
  readonly code = 'BFF_PRODUCER_CLIENT_NOT_INITIALIZED';

  constructor(requestId: string) {
    super(
      `Producer client "${requestId}" is not initialized. Call initProducerClient() (or configure()) before using generated APIs for this requestId.`,
    );
    this.name = 'ProducerClientNotInitializedError';
  }
}

export class ProducerDomainNotConfiguredError extends Error {
  readonly code = 'BFF_PRODUCER_DOMAIN_NOT_CONFIGURED';

  constructor(requestId: string) {
    super(
      `Producer client "${requestId}" must provide setDomain() during configure().`,
    );
    this.name = 'ProducerDomainNotConfiguredError';
  }
}

export class CrossOriginEnvelopePolicyError extends Error {
  readonly code = 'BFF_CROSS_ORIGIN_ENVELOPE_NOT_ALLOWED';

  constructor(requestId: string, sourceOrigin?: string, targetOrigin?: string) {
    super(
      `Cross-origin envelope is not allowed for producer "${requestId}" (${sourceOrigin || 'unknown-origin'} -> ${targetOrigin || 'unknown-origin'}). Configure allowCrossOriginEnvelope to explicitly allow this flow.`,
    );
    this.name = 'CrossOriginEnvelopePolicyError';
  }
}

export class IdentityBindingViolationError extends Error {
  readonly code = 'BFF_IDENTITY_BINDING_VIOLATION';

  readonly violation: IdentityBindingViolation;

  constructor(violation: IdentityBindingViolation) {
    super(
      `Identity header "${violation.header}" for producer "${violation.requestId}" was rejected by server-derived identity binding.`,
    );
    this.name = 'IdentityBindingViolationError';
    this.violation = violation;
  }
}

export class OperationContractViolationError extends Error {
  readonly code = 'BFF_OPERATION_CONTRACT_VIOLATION';

  readonly violation: OperationContractViolation;

  constructor(violation: OperationContractViolation) {
    super(
      `Operation contract violation "${violation.reason}" for producer "${violation.requestId}" operation "${violation.operationId}".`,
    );
    this.name = 'OperationContractViolationError';
    this.violation = violation;
  }
}

export const validateOperationContract = ({
  requestId,
  target,
  contextPayload,
  operationContract,
}: {
  requestId: string;
  target: TransportTarget;
  contextPayload: OperationContextPayload;
  operationContract: OperationContractOptions | undefined;
}) => {
  const operationContractEnabled =
    operationContract?.enabled ?? isSecuredRequestId(requestId);

  if (!operationContractEnabled) {
    return;
  }

  const strict = operationContract?.strict ?? true;
  const requireSchemaHash = operationContract?.requireSchemaHash ?? true;
  const requireOperationVersion =
    operationContract?.requireOperationVersion ?? true;

  const maybeReportViolation = (
    reason: OperationContractViolation['reason'],
  ) => {
    const violation: OperationContractViolation = {
      requestId,
      target,
      operationId: contextPayload.operationId,
      routePath: contextPayload.routePath,
      method: contextPayload.method,
      schemaHash:
        typeof contextPayload.schemaHash === 'string'
          ? contextPayload.schemaHash
          : undefined,
      operationVersion:
        typeof contextPayload.operationVersion === 'number'
          ? contextPayload.operationVersion
          : undefined,
      reason,
    };
    operationContract?.onViolation?.(violation);
    if (strict) {
      throw new OperationContractViolationError(violation);
    }
  };

  if (requireSchemaHash && typeof contextPayload.schemaHash !== 'string') {
    maybeReportViolation('missing_schema_hash');
  }

  if (
    requireOperationVersion &&
    typeof contextPayload.operationVersion !== 'number'
  ) {
    maybeReportViolation('missing_operation_version');
  }
};

export const resolveConfiguredRequest = <F>(
  configuredRequests: Map<string, F>,
  requestId: string,
  fallback: F,
): F => {
  const configuredRequest = configuredRequests.get(requestId);
  if (configuredRequest) {
    return configuredRequest;
  }

  if (requestId !== 'default') {
    throw new ProducerClientNotInitializedError(requestId);
  }

  return fallback;
};

/**
 * Builds the JSON value for the `x-modernjs-bff-envelope` header and throws
 * when the cross-origin envelope policy denies the flow. Returns the
 * serialized envelope.
 */
export const buildEnvelopeHeaderValue = ({
  requestId,
  target,
  sourceOrigin,
  targetOrigin,
  traceContext,
  allowCrossOriginEnvelope,
}: {
  requestId: string;
  target: TransportTarget;
  sourceOrigin: string | undefined;
  targetOrigin: string | undefined;
  traceContext: { traceId: string; spanId: string } | null | undefined;
  allowCrossOriginEnvelope:
    | boolean
    | ((options: {
        requestId: string;
        sourceOrigin?: string;
        targetOrigin?: string;
        target: TransportTarget;
      }) => boolean)
    | undefined;
}) => {
  const isCrossOrigin =
    Boolean(sourceOrigin) &&
    Boolean(targetOrigin) &&
    sourceOrigin !== targetOrigin;
  if (isCrossOrigin) {
    const isAllowed =
      typeof allowCrossOriginEnvelope === 'function'
        ? allowCrossOriginEnvelope({
            requestId,
            sourceOrigin,
            targetOrigin,
            target,
          }) === true
        : allowCrossOriginEnvelope === true;
    if (!isAllowed) {
      throw new CrossOriginEnvelopePolicyError(
        requestId,
        sourceOrigin,
        targetOrigin,
      );
    }
  }

  return JSON.stringify({
    requestId,
    target,
    timestamp: Date.now(),
    sourceOrigin,
    targetOrigin,
    ...(traceContext
      ? {
          traceId: traceContext.traceId,
          spanId: traceContext.spanId,
        }
      : {}),
  });
};

/**
 * Derives the operation context for a secured requestId, validates it against
 * the configured operation contract and writes the `x-operation-id` and
 * `x-modernjs-bff-operation-context` headers (without clobbering caller
 * provided values for the id header).
 */
export const attachOperationContextHeaders = ({
  headers,
  requestId,
  target,
  method,
  path,
  operationContext,
  operationContract,
  operationContextHeader,
  operationContextDetailHeader,
}: {
  headers: Record<string, any>;
  requestId: string;
  target: TransportTarget;
  method: string;
  path: string;
  operationContext: OperationContext | undefined;
  operationContract: OperationContractOptions | undefined;
  operationContextHeader: string;
  operationContextDetailHeader: string;
}) => {
  if (
    typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined' &&
    operationContext?.traceparent
  ) {
    writeHeader(headers, TRACEPARENT_HEADER, operationContext.traceparent);
  }
  const contextPayload = buildOperationContext({
    requestId,
    method,
    path,
    operationContext,
    traceparent: readHeader(headers, TRACEPARENT_HEADER),
  });
  validateOperationContract({
    requestId,
    target,
    contextPayload,
    operationContract,
  });

  if (typeof readHeader(headers, operationContextHeader) === 'undefined') {
    writeHeader(headers, operationContextHeader, contextPayload.operationId);
  }
  writeHeader(
    headers,
    operationContextDetailHeader,
    JSON.stringify(contextPayload),
  );

  return contextPayload;
};
