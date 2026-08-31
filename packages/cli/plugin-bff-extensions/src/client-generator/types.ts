import type { OperationContractMap } from '@modern-js/bff-core';
import type { EffectEndpointMeta } from '@modern-js/bff-effect/effect';
import type { HttpMethodDecider } from '@modern-js/types';

export type EffectClientCodegenOptions = {
  appDir: string;
  apiDir: string;
  resourcePath: string;
  prefix: string;
  port: number;
  target?: string;
  /** Producer identity used by cross-project clients and server contracts. */
  requestId?: string;
  requestCreator?: string;
  httpMethodDecider?: HttpMethodDecider;
  onDependency?: (dependency: string) => void;
  dataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

export type GeneratedEffectClientArtifacts = {
  code: string;
  declaration: string;
  endpoints: EffectEndpointMeta[];
  operationContracts: OperationContractMap;
  operationVersion: number;
  requestId: string;
};
