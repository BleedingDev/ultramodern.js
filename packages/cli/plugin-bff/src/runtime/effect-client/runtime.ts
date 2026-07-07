// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import { configureGeneratedEffectClientRuntime } from './batch';
import { prepareEffectRequest } from './envelope';
import { createEffectRequestContext as createEffectRequestContextWithHeaders } from './request-context';
import type {
  EffectClient,
  EffectClientOperation,
  EffectOperationDescriptor,
  EffectOperationManifest,
  EffectRequestContext,
  EffectRequestContextInput,
  EffectRequestRuntime,
  GeneratedEffectClientConfig,
  GeneratedEffectClientModule,
  GeneratedEffectEndpoint,
} from './types';

export type {
  EffectClient,
  EffectClientGroup,
  EffectClientOperation,
  EffectOperationDescriptor,
  EffectOperationManifest,
  EffectRequestContext,
  EffectRequestContextInput,
  EffectRequestRuntime,
  GeneratedEffectBatchConfig,
  GeneratedEffectClientConfig,
  GeneratedEffectClientModule,
  GeneratedEffectEndpoint,
} from './types';

export const createGeneratedEffectClient = (
  manifest: { endpoints: GeneratedEffectEndpoint[] },
  config: GeneratedEffectClientConfig,
  requestRuntime: EffectRequestRuntime,
): GeneratedEffectClientModule => {
  const createRequest = requestRuntime.createRequest;
  const configureRequest =
    typeof requestRuntime.configure === 'function'
      ? requestRuntime.configure
      : undefined;
  const createRequestContextHeaders =
    typeof requestRuntime.createRequestContextHeaders === 'function'
      ? requestRuntime.createRequestContextHeaders
      : undefined;

  const httpMethodDecider = config.httpMethodDecider || 'functionName';
  const port =
    config.useEnvPort &&
    typeof process !== 'undefined' &&
    process.env &&
    process.env.PORT
      ? process.env.PORT
      : config.port;

  configureGeneratedEffectClientRuntime(config, configureRequest);

  const createEffectRequestContext = (
    requestContext: EffectRequestContextInput,
  ): EffectRequestContext =>
    createEffectRequestContextWithHeaders(
      createRequestContextHeaders,
      requestContext,
    );

  const client: EffectClient = {};
  const operationManifest: EffectOperationManifest = {};

  for (const endpoint of manifest.endpoints) {
    const operationId = `${endpoint.method}:${endpoint.routePath}`;
    const operation: EffectOperationDescriptor = {
      appNamespace: config.appNamespace,
      apiId: endpoint.apiId,
      group: endpoint.group,
      endpoint: endpoint.endpoint,
      operationId,
      routePath: endpoint.routePath,
      method: endpoint.method,
      operationVersion: endpoint.operationVersion,
      schemaHash: endpoint.schemaHash,
      version: endpoint.operationVersion,
    };

    const sender = createRequest({
      path: endpoint.routePath,
      method: endpoint.method,
      port,
      operationContext: {
        operationId,
        routePath: endpoint.routePath,
        method: endpoint.method,
        schemaHash: endpoint.schemaHash,
        operationVersion: endpoint.operationVersion,
      },
      httpMethodDecider,
      ...(config.requestId ? { requestId: config.requestId } : {}),
    });

    const call: EffectClientOperation = (request: unknown = {}) =>
      sender(
        prepareEffectRequest({
          endpoint,
          operation,
          request,
          config,
          createEffectRequestContext,
        }),
      );

    client[endpoint.group] ??= {};
    client[endpoint.group]![endpoint.endpoint] = call;
    operationManifest[endpoint.group] ??= {};
    operationManifest[endpoint.group]![endpoint.endpoint] = operation;
  }

  return {
    client,
    operationManifest,
    createEffectRequestContext,
  };
};
