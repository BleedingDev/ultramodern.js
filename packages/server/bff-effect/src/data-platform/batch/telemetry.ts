// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { trace } from '@opentelemetry/api';

import type {
  DataBatchTransportEvent,
  DataBatchTransportTelemetryAttributes,
} from '../types';

export const DATA_BATCH_TRANSPORT_OTEL_EVENT = 'modernjs.data.batch';

export function createDataBatchTransportTelemetryAttributes(
  event: DataBatchTransportEvent,
): DataBatchTransportTelemetryAttributes {
  return {
    'modernjs.data.batch.type': event.type,
    'modernjs.data.batch.endpoint': event.endpoint,
    'modernjs.data.batch.degraded':
      event.type === 'fallback' || event.type === 'disable',
    ...(event.batchId ? { 'modernjs.data.batch.id': event.batchId } : {}),
    ...(typeof event.size === 'number'
      ? { 'modernjs.data.batch.size': event.size }
      : {}),
    ...(event.reason ? { 'modernjs.data.batch.reason': event.reason } : {}),
  };
}

export function emitDataBatchTransportEvent(
  onEvent: ((event: DataBatchTransportEvent) => void) | undefined,
  event: DataBatchTransportEvent,
) {
  try {
    onEvent?.(event);
  } catch {
    // Observability callbacks must not affect transport state or settlement.
  }

  try {
    trace
      .getActiveSpan()
      ?.addEvent(
        DATA_BATCH_TRANSPORT_OTEL_EVENT,
        createDataBatchTransportTelemetryAttributes(event),
      );
  } catch {
    // OpenTelemetry exporters are observational and must remain non-fatal.
  }
}
