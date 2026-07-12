import type { HttpMethodDecider } from '@modern-js/types';
import type { EffectEndpointMeta } from '../../runtime/effect/endpoint-contracts';

export type EffectClientCodegenOptions = {
  appDir: string;
  apiDir: string;
  resourcePath: string;
  prefix: string;
  port: number;
  target?: string;
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
};
