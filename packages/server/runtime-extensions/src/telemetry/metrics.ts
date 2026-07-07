import type { Metrics } from '@modern-js/types';

import { isRecord } from './envelope';
import type { TelemetryRegistry } from './registry';

type TelemetryMetricsTags = Record<string, unknown>;
type TelemetryMetricsPrefixOrTags = string | TelemetryMetricsTags;

function normalizeMetricsInput(
  prefixOrTags?: TelemetryMetricsPrefixOrTags,
  tags?: TelemetryMetricsTags,
) {
  if (typeof prefixOrTags === 'string') {
    return {
      prefix: prefixOrTags,
      tags: tags || {},
    };
  }

  if (isRecord(prefixOrTags)) {
    return {
      prefix: undefined,
      tags: prefixOrTags,
    };
  }

  return {
    prefix: undefined,
    tags: tags || {},
  };
}

function normalizeMetricName(name: string, prefix: string | undefined) {
  return prefix && prefix.length > 0 ? `${prefix}.${name}` : name;
}

function toTelemetryMetricTags(tags: TelemetryMetricsTags) {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) {
      continue;
    }
    output[key] = String(value);
  }
  return output;
}

function getTraceContext(tags: TelemetryMetricsTags) {
  const traceId =
    typeof tags.trace_id === 'string'
      ? tags.trace_id
      : typeof tags.traceId === 'string'
        ? tags.traceId
        : undefined;

  const spanId =
    typeof tags.span_id === 'string'
      ? tags.span_id
      : typeof tags.spanId === 'string'
        ? tags.spanId
        : undefined;

  const parentSpanId =
    typeof tags.parent_span_id === 'string'
      ? tags.parent_span_id
      : typeof tags.parentSpanId === 'string'
        ? tags.parentSpanId
        : undefined;

  return {
    traceId,
    spanId,
    parentSpanId,
  };
}

export const createTelemetryAwareMetrics = <T extends Metrics>(
  baseMetrics: T,
  registry: TelemetryRegistry,
): T => {
  const emitCounter: Metrics['emitCounter'] = (
    name,
    value,
    prefixOrTags,
    tags,
  ) => {
    const normalized = normalizeMetricsInput(
      prefixOrTags as TelemetryMetricsPrefixOrTags | undefined,
      tags,
    );
    baseMetrics.emitCounter(name, value, normalized.prefix, normalized.tags);

    try {
      const metricName = normalizeMetricName(name, normalized.prefix);
      const traceContext = getTraceContext(normalized.tags);
      registry.enqueueMetric({
        name: metricName,
        value,
        unit: 'count',
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        parentSpanId: traceContext.parentSpanId,
        tags: toTelemetryMetricTags(normalized.tags),
        attributes: normalized.tags,
      });
    } catch (_error) {
      // telemetry wrapping must never break request metrics.
    }
  };

  const emitTimer: Metrics['emitTimer'] = (name, value, prefixOrTags, tags) => {
    const normalized = normalizeMetricsInput(
      prefixOrTags as TelemetryMetricsPrefixOrTags | undefined,
      tags,
    );
    baseMetrics.emitTimer(name, value, normalized.prefix, normalized.tags);

    try {
      const metricName = normalizeMetricName(name, normalized.prefix);
      const traceContext = getTraceContext(normalized.tags);
      registry.enqueueMetric({
        name: metricName,
        value,
        unit: 'ms',
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        parentSpanId: traceContext.parentSpanId,
        tags: toTelemetryMetricTags(normalized.tags),
        attributes: normalized.tags,
      });
    } catch (_error) {
      // telemetry wrapping must never break request metrics.
    }
  };

  return {
    ...baseMetrics,
    emitCounter,
    emitTimer,
  };
};
