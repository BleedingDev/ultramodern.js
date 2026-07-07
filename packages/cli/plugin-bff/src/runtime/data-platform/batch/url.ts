// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type { DataTransportRequestInfo } from '../types';
import { DEFAULT_DATA_BATCH_ENDPOINT } from '../types';

export function resolveRuntimeOrigin() {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { location?: { origin?: string } }).location &&
    typeof (globalThis as { location?: { origin?: string } }).location
      ?.origin === 'string'
  ) {
    return (globalThis as { location?: { origin?: string } }).location!.origin!;
  }

  return 'http://localhost';
}

export function toAbsoluteUrl(input: DataTransportRequestInfo) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return new URL(input.url);
  }

  const value = String(input);
  try {
    return new URL(value);
  } catch {
    return new URL(value, resolveRuntimeOrigin());
  }
}

export function normalizeBatchEndpoint(
  requestUrl: URL,
  endpoint: string | undefined,
): URL {
  const value = endpoint || DEFAULT_DATA_BATCH_ENDPOINT;
  try {
    return new URL(value);
  } catch {
    return new URL(value, requestUrl.origin);
  }
}
