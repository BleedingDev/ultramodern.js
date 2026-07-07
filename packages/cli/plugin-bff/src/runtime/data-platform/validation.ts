// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import {
  buildScopeKey,
  createOperationId,
  hashString,
  isPlainObject,
  normalizeOrigin,
  sanitizeSegment,
  stableStringify,
} from './codec';
import { formatTraceparentHeader, parseTraceparentHeader } from './trace';
import type {
  CacheScope,
  DataMutationMode,
  DataRequestMode,
  HydrationEnvelope,
  HydrationEnvelopeValidationOptions,
  OperationDescriptor,
  RequestEnvelope,
  RequestEnvelopeValidationOptions,
  SelectionPlan,
  SelectionPlanValidationOptions,
  SelectionPlanValidationResult,
  TraceContext,
} from './types';

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
