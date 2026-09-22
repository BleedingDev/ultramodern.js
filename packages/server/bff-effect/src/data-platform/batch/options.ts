import type { DataBatchTransportOptions } from '../types';

/** Wire limits and method eligibility are identical on both sides. */
export function normalizeBatchLimits(
  options: Pick<
    DataBatchTransportOptions,
    'maxBatchSize' | 'maxBatchBytes' | 'allowedMethods'
  > = {},
) {
  return {
    maxBatchSize: Math.max(1, options.maxBatchSize ?? 16),
    maxBatchBytes: Math.max(1024, options.maxBatchBytes ?? 64 * 1024),
    allowedMethods: new Set(
      (options.allowedMethods !== undefined && options.allowedMethods.length > 0
        ? options.allowedMethods
        : ['GET']
      ).map(method => method.toUpperCase()),
    ),
  };
}
