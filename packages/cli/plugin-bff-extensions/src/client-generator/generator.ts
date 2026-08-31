import { collectEffectEndpoints } from '@modern-js/bff-effect/effect';
import { logger } from '@modern-js/utils';
import {
  createEffectClientGeneration,
  renderEffectClientCode,
  renderEffectClientDeclaration,
} from './rendering';
import { getHttpApiRuntime, loadEffectApi } from './runtime';
import type {
  EffectClientCodegenOptions,
  GeneratedEffectClientArtifacts,
} from './types';

export function generateEffectClient(
  options: EffectClientCodegenOptions,
): Promise<GeneratedEffectClientArtifacts | null> {
  return loadEffectApi({
    appDir: options.appDir,
    resourcePath: options.resourcePath,
    onDependency: options.onDependency,
  }).then(api => {
    if (api === null) {
      logger.warn(
        `[BFF][Effect] Failed to generate client for ${options.resourcePath}: unable to resolve exported HttpApi.`,
      );
      return null;
    }

    return getHttpApiRuntime().then(httpApiRuntime => {
      const endpoints = collectEffectEndpoints(
        httpApiRuntime.reflect,
        api,
        options.prefix,
      );
      const generation = createEffectClientGeneration(endpoints, options);
      return {
        code: renderEffectClientCode(generation),
        declaration: renderEffectClientDeclaration(endpoints),
        endpoints,
        operationContracts: generation.operationContracts,
        operationVersion: generation.operationVersion,
        requestId: generation.requestId,
      };
    });
  });
}

export function generateEffectClientCode(options: EffectClientCodegenOptions) {
  return generateEffectClient(options).then(artifacts =>
    artifacts === null ? null : artifacts.code,
  );
}
