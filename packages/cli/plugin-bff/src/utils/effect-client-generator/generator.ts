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
export async function generateEffectClient(
  options: EffectClientCodegenOptions,
): Promise<GeneratedEffectClientArtifacts | null> {
  const api = await loadEffectApi({
    appDir: options.appDir,
    resourcePath: options.resourcePath,
    onDependency: options.onDependency,
  });
  if (!api) {
    logger.warn(
      `[BFF][Effect] Failed to generate client for ${options.resourcePath}: unable to resolve exported HttpApi.`,
    );
    return null;
  }

  const httpApiRuntime = await getHttpApiRuntime();
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
}

export async function generateEffectClientCode(
  options: EffectClientCodegenOptions,
) {
  const artifacts = await generateEffectClient(options);
  return artifacts ? artifacts.code : null;
}
