import { logger } from '@modern-js/utils';
import { collectEffectEndpoints } from '../../runtime/effect/endpoint-contracts';
import {
  renderEffectClientCode,
  renderEffectClientDeclaration,
} from './rendering';
import { getHttpApiRuntime, loadEffectApi } from './runtime';
import type {
  EffectClientCodegenOptions,
  GeneratedEffectClientArtifacts,
} from './types';

/**
 * Generates the Effect client module plus its type declaration. The module
 * body is a thin manifest + one call into
 * `@modern-js/plugin-bff/effect-client-runtime`; the declaration preserves
 * the group/endpoint structure of the HttpApi instead of erasing it to
 * `Record<string, ...>`.
 */
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
      return {
        code: renderEffectClientCode(endpoints, options),
        declaration: renderEffectClientDeclaration(endpoints),
        endpoints,
      };
    });
  });
}

export function generateEffectClientCode(options: EffectClientCodegenOptions) {
  return generateEffectClient(options).then(artifacts =>
    artifacts === null ? null : artifacts.code,
  );
}
