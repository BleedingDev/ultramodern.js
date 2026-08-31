import type {
  CrossProjectPolicyConfig,
  NormalizedCrossProjectPolicy,
} from './crossProjectPolicy';
import {
  buildOperationContractMap,
  type OperationContractSource,
} from './operationContracts';

/**
 * Runtime input collected by BFF server adapters (hono/effect/...) before
 * the cross-project policy can be enforced.
 *
 * `crossProjectPolicy` accepts the raw `bff.crossProjectPolicy` user config —
 * `BffCrossProjectPolicyUserConfig` is a structural subset of
 * `CrossProjectPolicyConfig`, so no casts are required at the call site.
 */
export interface ResolveCrossProjectPolicyInput {
  crossProjectPolicy?: CrossProjectPolicyConfig;
  /** Registered API handlers used to derive the operation-contract map. */
  handlers: OperationContractSource[];
  /** Logical producer ID (`bff.requestId`). */
  requestId?: string;
  /** Marker injected by generated cross-project SDK plugins. */
  isCrossProjectServer?: boolean;
  /**
   * Producer contract version (usually derived from the producer
   * package.json major via `deriveOperationVersion`).
   */
  operationVersion?: number;
}

/**
 * Fully-defaulted policy returned by {@link resolveCrossProjectPolicy}.
 */
export type ResolvedCrossProjectPolicy = NormalizedCrossProjectPolicy;

/**
 * Normalizes the user-facing cross-project policy config into the evaluator
 * input shared by every BFF server adapter:
 *
 * - returns `undefined` when neither a policy nor the cross-project server
 *   marker is present (policy middleware must not be installed);
 * - applies the documented defaults for all `require*` switches;
 * - merges generated operation contracts (derived from the registered
 *   handlers) over any user-provided `expectedOperationContracts`.
 */
export const resolveCrossProjectPolicy = (
  input: ResolveCrossProjectPolicyInput,
): ResolvedCrossProjectPolicy | undefined => {
  const {
    crossProjectPolicy,
    handlers,
    requestId,
    isCrossProjectServer,
    operationVersion,
  } = input;
  if (!crossProjectPolicy && !isCrossProjectServer) {
    return undefined;
  }

  const policy: CrossProjectPolicyConfig = crossProjectPolicy ?? {};
  const effectiveRequestId =
    typeof requestId === 'string' && requestId.trim().length > 0
      ? requestId
      : 'default';
  const generatedContracts = buildOperationContractMap({
    handlers,
    requestId: effectiveRequestId,
    operationVersion,
  });

  return {
    ...policy,
    enabled: policy.enabled ?? Boolean(isCrossProjectServer),
    requireEnvelope: policy.requireEnvelope ?? true,
    requireOperationContext: policy.requireOperationContext ?? true,
    requireOperationContextDetails:
      policy.requireOperationContextDetails ?? true,
    requireOperationSchemaHash: policy.requireOperationSchemaHash ?? true,
    requireOperationVersion: policy.requireOperationVersion ?? true,
    allowUnknownOperations: policy.allowUnknownOperations ?? false,
    expectedOperationContracts: {
      ...(policy.expectedOperationContracts ?? {}),
      ...generatedContracts,
    },
  };
};
