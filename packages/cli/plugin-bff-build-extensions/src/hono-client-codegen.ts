import type { ClientCodegenPlugin } from '@modern-js/bff-core';
import {
  buildOperationContractMap,
  createOperationSchemaHash,
  resolveOperationProducer,
} from '@modern-js/server-runtime-extensions/bff-policy/node';

const REQUEST_RUNTIME = '@modern-js/runtime-extensions/request-policy';

export const modifyClient: ClientCodegenPlugin = (draft, context) => {
  const { appDir, requestId } = context.options;
  draft.requestCreator = context.options.requestCreator || REQUEST_RUNTIME;
  const { operationVersion, requestId: normalizedRequestId } =
    resolveOperationProducer({
      directories: [context.options.apiDir, appDir],
      requestId: requestId || 'default',
    });
  const operationContracts = buildOperationContractMap({
    handlers: [...context.handlerInfos],
    requestId: normalizedRequestId,
    operationVersion,
  });
  const operationEntries = context.handlerInfos
    .map(handlerInfo => {
      const httpMethod = handlerInfo.httpMethod.toUpperCase();
      return {
        name: handlerInfo.name,
        httpMethod,
        routePath: handlerInfo.routePath,
        schemaHash:
          operationContracts[`${httpMethod}:${handlerInfo.routePath}`]
            ?.schemaHash ?? '',
      };
    })
    .sort((a, b) =>
      `${a.routePath}:${a.httpMethod}:${a.name}`.localeCompare(
        `${b.routePath}:${b.httpMethod}:${b.name}`,
      ),
    );
  const schemaHash = createOperationSchemaHash(
    operationEntries,
    normalizedRequestId,
  );
  for (const { handlerInfo, optionProperties } of draft.handlers) {
    if (handlerInfo.action === 'upload' && !requestId) continue;
    const method = handlerInfo.httpMethod.toUpperCase();
    const operationContext = {
      operationId: handlerInfo.name,
      routePath: handlerInfo.routePath,
      method,
      schemaHash:
        operationContracts[`${method}:${handlerInfo.routePath}`]?.schemaHash ??
        '',
      operationVersion,
    };
    optionProperties.push(
      `operationContext: ${JSON.stringify(operationContext)}`,
    );
  }
  if (requestId) {
    draft.imports.push(
      `import * as requestRuntime from ${JSON.stringify(draft.requestCreator)};`,
      'import { createProducerClient } from "@modern-js/plugin-bff-extensions/producer-runtime";',
    );
    draft.statements.push(`export const initProducerClient = (options = {}) => {
  const configure = requestRuntime.configure;
  if (typeof configure !== 'function') {
    console.warn('[modernjs] Compatibility request creator path does not expose configure(); use default @modern-js/create-request or migrate the compatibility path.');
    return undefined;
  }
  return createProducerClient(configure, { requestId: ${JSON.stringify(requestId)} })(options);
};`);
  }
  draft.statements.push(
    `export const operationVersion = ${String(operationVersion)};`,
    `export const operationSchemaHash = ${JSON.stringify(schemaHash)};`,
    `export const operationManifest = ${JSON.stringify({ operationVersion, schemaHash, operations: operationEntries }, null, 2)};`,
  );
};
