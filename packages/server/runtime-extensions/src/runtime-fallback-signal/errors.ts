import type { RuntimeSignalError } from './types';

export function createRuntimeSignalError(
  message: string,
  code: RuntimeSignalError['code'],
) {
  const error = new Error(message) as RuntimeSignalError;
  error.code = code;
  return error;
}
