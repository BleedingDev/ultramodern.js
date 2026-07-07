// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { parseTraceparent } from '@modern-js/create-request';

import type { TraceContext } from './types';

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value);
}

function isValidHex(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/.test(value);
}

export function parseTraceparentHeader(header: string): TraceContext | null {
  return parseTraceparent(header) ?? null;
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
