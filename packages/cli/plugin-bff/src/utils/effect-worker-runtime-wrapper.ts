// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import type { HttpMethodDecider } from '@modern-js/types';
import { generateEffectClient } from './effect-client-generator';

type EffectWorkerRuntimeGenerationOptions = {
  apiDir: string;
  appDir: string;
  effectDataPlatformBatch?: {
    allowedMethods?: string[];
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchBytes?: number;
    maxBatchSize?: number;
    requestTimeoutMs?: number;
  };
  httpMethodDecider?: HttpMethodDecider;
  port: number;
  prefix: string;
  requestCreator?: string;
  requestId?: string;
};

export async function generateEffectWorkerRuntimeWrapper(
  loader: { addDependency: (dependency: string) => void },
  options: EffectWorkerRuntimeGenerationOptions,
  resourcePath: string,
) {
  const artifacts = await generateEffectClient({
    appDir: options.appDir,
    apiDir: options.apiDir,
    resourcePath,
    prefix: options.prefix,
    port: Number(options.port),
    target: 'bundle',
    requestId: options.requestId,
    requestCreator: options.requestCreator,
    httpMethodDecider: options.httpMethodDecider,
    dataPlatformBatch: options.effectDataPlatformBatch,
    onDependency: dependency => loader.addDependency(dependency),
  });
  const sourceRequest = `${resourcePath}?modern-bff-runtime-source`;
  const operationContracts = artifacts?.operationContracts ?? {};

  return `import * as effectBffModule from ${JSON.stringify(sourceRequest)};
import { createEffectBffEdgeDispatcher } from '@modern-js/plugin-bff/effect-edge/dispatcher';

const __generatedOperationContracts = ${JSON.stringify(operationContracts)};

const __mergeGeneratedOperationContracts = policy => {
  if (
    !policy ||
    !policy.expectedOperationContracts ||
    typeof policy.expectedOperationContracts !== 'object' ||
    Array.isArray(policy.expectedOperationContracts)
  ) {
    return policy;
  }
  return {
    ...policy,
    expectedOperationContracts: {
      ...policy.expectedOperationContracts,
      ...__generatedOperationContracts,
    },
  };
};

export const __modern_create_effect_bff_dispatcher = options =>
  createEffectBffEdgeDispatcher({
    ...options,
    crossProjectPolicy: __mergeGeneratedOperationContracts(
      options?.crossProjectPolicy,
    ),
    module: effectBffModule,
  });
`;
}
