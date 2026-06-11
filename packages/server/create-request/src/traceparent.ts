const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export type TraceparentContext = {
  traceId: string;
  spanId: string;
  sampled: boolean;
};

const isAllZeroHex = (value: string) => /^0+$/.test(value);

/**
 * Parse a W3C trace context `traceparent` header (version 00).
 * All-zero trace ids and span ids are rejected per the W3C spec.
 */
export function parseTraceparent(
  traceparent: string | undefined | null,
): TraceparentContext | undefined {
  if (!traceparent) {
    return undefined;
  }

  const match = traceparent.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  const [, rawTraceId, rawSpanId, rawFlags] = match;
  if (!rawTraceId || !rawSpanId || !rawFlags) {
    return undefined;
  }

  const traceId = rawTraceId.toLowerCase();
  const spanId = rawSpanId.toLowerCase();
  if (isAllZeroHex(traceId) || isAllZeroHex(spanId)) {
    return undefined;
  }

  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(rawFlags, 16) & 0x1) === 1,
  };
}
