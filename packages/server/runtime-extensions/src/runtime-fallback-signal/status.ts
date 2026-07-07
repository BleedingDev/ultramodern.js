import type { RuntimeSignalError } from './types';

export function getRuntimeSignalErrorStatusCode(
  signalError: RuntimeSignalError,
): 400 | 401 | 403 | 413 | 429 | 500 {
  if (signalError.code === 'PAYLOAD_TOO_LARGE') {
    return 413;
  }
  if (signalError.code === 'INVALID_PAYLOAD') {
    return 400;
  }
  if (signalError.code === 'UNAUTHORIZED') {
    return 401;
  }
  if (signalError.code === 'RATE_LIMITED') {
    return 429;
  }
  if (signalError.code === 'UNTRUSTED_SOURCE') {
    return 403;
  }
  return 500;
}
