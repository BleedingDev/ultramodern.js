// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import {
  DEFAULT_DATA_ENVELOPE_HEADER,
  decodeRequestEnvelopeHeader,
  validateRequestEnvelope,
  validateSelectionPlan,
} from '../../data-platform';

import { getExpectedEnvelopeOrigin } from './routing';
import type { EffectDataPlatformValidationOptions } from './types';

function createInvalidEnvelopeResponse(message: string, errors?: string[]) {
  return new Response(
    JSON.stringify({
      message,
      ...(errors && errors.length > 0 ? { errors } : {}),
    }),
    {
      status: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
}

/**
 * Validates the `x-modernjs-data-envelope` header (the data-platform
 * transport/cache contract: protocol version, scope, selection plan).
 *
 * This is NOT a security boundary: the envelope is client-constructed cache
 * metadata used for batching, scope keys and hydration. Cross-project
 * authorization runs through the bff-core policy evaluator wired in via
 * `validateRequest` (see `EffectRequestValidator`), which both the direct
 * and batched request paths hit before this check.
 */

export function validateDataPlatformRequestEnvelope(
  request: Request,
  options: EffectDataPlatformValidationOptions | undefined,
) {
  const isEnabled = options?.enabled ?? true;
  if (!isEnabled) {
    return null;
  }

  const envelopeHeader =
    options?.envelopeHeader || DEFAULT_DATA_ENVELOPE_HEADER;
  const encodedEnvelope = request.headers.get(envelopeHeader);

  if (!encodedEnvelope) {
    if (options?.requireEnvelope) {
      return createInvalidEnvelopeResponse(
        `Missing required data envelope header: ${envelopeHeader}`,
      );
    }
    return null;
  }

  const envelope = decodeRequestEnvelopeHeader(encodedEnvelope);
  if (!envelope) {
    return createInvalidEnvelopeResponse(
      `Invalid data envelope header format: ${envelopeHeader}`,
    );
  }

  const validation = validateRequestEnvelope(envelope, {
    expectedProtocolVersion: 1,
    expectedNamespace: options?.expectedNamespace,
    expectedOrigin:
      options?.validateOrigin === false
        ? undefined
        : getExpectedEnvelopeOrigin(request),
    requireTraceContext: options?.requireTraceContext,
  });

  if (!validation.ok) {
    return createInvalidEnvelopeResponse(
      'Invalid data envelope',
      validation.errors,
    );
  }

  if (envelope.selectionPlan) {
    const selectionValidation = validateSelectionPlan(envelope.selectionPlan, {
      maxDepth: options?.selection?.maxDepth,
      maxFields: options?.selection?.maxFields,
      allowedLeafPaths: options?.selection?.allowedLeafPaths,
    });

    if (!selectionValidation.ok) {
      return createInvalidEnvelopeResponse(
        'Invalid data envelope selection plan',
        selectionValidation.errors,
      );
    }
  }

  return null;
}

export function mergeDataPlatformOptions(
  base: EffectDataPlatformValidationOptions | undefined,
  override: Partial<EffectDataPlatformValidationOptions> | undefined,
): EffectDataPlatformValidationOptions | undefined {
  if (!base && !override) {
    return undefined;
  }

  const baseSelection = base?.selection;
  const overrideSelection = override?.selection;
  const baseBatch = base?.batch;
  const overrideBatch = override?.batch;

  return {
    ...base,
    ...override,
    selection:
      baseSelection || overrideSelection
        ? {
            ...baseSelection,
            ...overrideSelection,
          }
        : undefined,
    batch:
      baseBatch || overrideBatch
        ? {
            ...baseBatch,
            ...overrideBatch,
          }
        : undefined,
  };
}
