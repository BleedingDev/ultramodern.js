// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import { createDataBatchTransport } from '../data-platform';
import { resolveOrigin } from './envelope';
import type {
  EffectRequestRuntime,
  GeneratedEffectClientConfig,
} from './types';

const resolveRuntimeFetch = (): typeof fetch | undefined =>
  typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

export const configureGeneratedEffectClientRuntime = (
  config: GeneratedEffectClientConfig,
  configureRequest: EffectRequestRuntime['configure'] | undefined,
): void => {
  const defaultOrigin = config.defaultOrigin;

  if (config.requestId && configureRequest) {
    const configurePayload: Record<string, unknown> = {
      requestId: config.requestId,
      requireEnvelope: true,
      identityBinding: {
        enabled: true,
        strict: true,
      },
      operationContract: {
        enabled: true,
        strict: true,
        requireSchemaHash: true,
        requireOperationVersion: true,
      },
      setDomain: () => resolveOrigin(defaultOrigin),
    };

    const runtimeFetch = resolveRuntimeFetch();
    if (config.batch.enabled !== false && runtimeFetch) {
      configurePayload.request = createDataBatchTransport({
        fetch: runtimeFetch,
        endpoint: config.batch.endpoint,
        flushIntervalMs: config.batch.flushIntervalMs,
        maxBatchSize: config.batch.maxBatchSize,
        maxBatchBytes: config.batch.maxBatchBytes,
        requestTimeoutMs: config.batch.requestTimeoutMs,
        allowedMethods: config.batch.allowedMethods,
      });
    }

    configureRequest(configurePayload);
  }
};
