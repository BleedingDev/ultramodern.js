// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off

import { createBatchTransportQueue } from './batch/queue';
import type { DataBatchTransportOptions } from './types';

export {
  createDataBatchTransportTelemetryAttributes,
  DATA_BATCH_TRANSPORT_OTEL_EVENT,
  emitDataBatchTransportEvent,
} from './batch/telemetry';

export function createDataBatchTransport(
  options: DataBatchTransportOptions = {},
) {
  const fallbackFetch =
    typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
  const baseFetch = options.fetch || fallbackFetch;
  if (!baseFetch) {
    throw new Error('createDataBatchTransport requires a fetch implementation');
  }
  return createBatchTransportQueue({ options, baseFetch });
}
