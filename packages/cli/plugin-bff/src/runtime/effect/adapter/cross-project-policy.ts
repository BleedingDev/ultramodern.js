// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import type { ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';
import { HttpApi } from 'effect/unstable/httpapi';

import {
  type ResolvedCrossProjectPolicy,
  resolveAdapterCrossProjectPolicy,
} from '../../../utils/crossProjectServerPolicy';
import {
  collectEffectEndpoints,
  extractHttpApiFromModule,
  toOperationContractSources,
} from '../endpoint-contracts';
import type { EffectApiModule } from '../module';

export async function resolveEffectAdapterCrossProjectPolicy(
  api: ServerPluginAPI,
  prefix: string,
  mod: EffectApiModule | null,
): Promise<ResolvedCrossProjectPolicy> {
  let contractSources: ReturnType<typeof toOperationContractSources> = [];
  if (mod) {
    try {
      const effectApi = await extractHttpApiFromModule(mod, HttpApi.isHttpApi);
      if (effectApi) {
        // Bridge strongly-typed HttpApi.reflect onto loose
        // reflection contract shared client generator.
        const reflect: Parameters<typeof collectEffectEndpoints>[0] = (
          apiValue,
          handlers,
        ) =>
          HttpApi.reflect(apiValue as Parameters<typeof HttpApi.reflect>[0], {
            onGroup: handlers.onGroup ?? (() => {}),
            onEndpoint: handlers.onEndpoint,
          });
        contractSources = toOperationContractSources(
          collectEffectEndpoints(reflect, effectApi, prefix),
        );
      }
    } catch (error) {
      logger.warn(
        `[BFF][Effect] Failed reflect HttpApi endpoints cross-project policy: ${String(error)}`,
      );
    }
  }

  const policy = resolveAdapterCrossProjectPolicy(api, contractSources);
  if (policy?.enabled && contractSources.length === 0) {
    logger.warn(
      '[BFF][Effect] Cross-project policy enabled but no HttpApi endpoints could reflected; operation-contract matching disabled server (envelope operation-context checks still apply).',
    );
  }
  return policy;
}
