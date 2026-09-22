import type {
  AppTools,
  BffClientArtifacts,
  BffGeneration,
} from '@modern-js/app-tools';
import { ApiRouter } from '@modern-js/bff-core';
import type { CLIPluginAPI } from '@modern-js/plugin';
import {
  buildOperationContractMap,
  type OperationContractMap,
  resolveOperationProducer,
} from '@modern-js/server-runtime-extensions/bff-policy/node';

export const BFF_REQUEST_RUNTIME =
  '@modern-js/runtime-extensions/request-policy';

export interface BffGenerationMetadata {
  runtimeFramework: 'effect' | 'hono';
  relativeEffectEntry: string;
  operationContracts: OperationContractMap;
}

export function registerBffClientArtifacts(
  api: CLIPluginAPI<AppTools>,
  metadata: WeakMap<BffGeneration, BffGenerationMetadata>,
) {
  api.modifyBffClientArtifacts(async (context: BffClientArtifacts) => {
    const { generation } = context;
    const config = api.getNormalizedConfig();
    if (api.getAppContext().bffRuntimeFramework === 'effect') {
      const { resolveEffectOperationContracts, resolveEffectEntryPaths } =
        await import('@modern-js/plugin-bff-extensions/effect-source-loader');
      const { sourceEffectEntry, relativeEffectEntry } =
        resolveEffectEntryPaths({
          appDir: generation.appDirectory,
          apiDir: generation.apiDirectory,
          effectEntry: config.bff?.effect?.entry,
        });
      if (!sourceEffectEntry)
        throw new Error(
          `Cannot resolve Effect BFF entry in ${generation.apiDirectory}.`,
        );
      const operationContracts = await resolveEffectOperationContracts({
        appDir: generation.appDirectory,
        resourcePath: sourceEffectEntry,
        prefix: generation.prefix,
        requestId: generation.requestId,
      });
      if (operationContracts === null) {
        throw new Error(
          `Cannot resolve exported Effect HttpApi in ${sourceEffectEntry}.`,
        );
      }
      metadata.set(generation, {
        runtimeFramework: 'effect',
        relativeEffectEntry,
        operationContracts,
      });
    } else {
      const router = new ApiRouter({
        appDir: generation.appDirectory,
        apiDir: generation.apiDirectory,
        lambdaDir: generation.lambdaDirectory,
        prefix: generation.prefix,
        httpMethodDecider: generation.httpMethodDecider,
        isBuild: true,
      });
      const operationContracts = generation.existLambda
        ? buildOperationContractMap({
            handlers: await router.getApiHandlers(),
            ...resolveOperationProducer({
              directories: [generation.apiDirectory, generation.appDirectory],
              requestId: generation.requestId || 'default',
            }),
          })
        : {};
      metadata.set(generation, {
        runtimeFramework: 'hono',
        relativeEffectEntry: '',
        operationContracts,
      });
    }
    return context;
  });
}
