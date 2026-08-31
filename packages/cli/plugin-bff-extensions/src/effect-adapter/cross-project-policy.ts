// @effect-diagnostics strictBooleanExpressions:off
import {
  collectEffectEndpoints,
  type EffectApiModule,
  extractHttpApiFromModule,
  toOperationContractSources,
} from '@modern-js/bff-effect/effect';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';
import { HttpApi } from 'effect/unstable/httpapi';

import {
  type ResolvedCrossProjectPolicy,
  resolveAdapterCrossProjectPolicy,
} from '../cross-project-policy';

export function resolveEffectAdapterCrossProjectPolicy(
  api: ServerPluginAPI,
  prefix: string,
  mod: EffectApiModule | null,
): Promise<ResolvedCrossProjectPolicy | undefined> {
  const contractSourcesPromise =
    mod === null
      ? Promise.resolve([])
      : Promise.resolve()
          .then(() => extractHttpApiFromModule(mod, HttpApi.isHttpApi))
          .then(effectApi => {
            if (effectApi === null) {
              return [];
            }
            const reflect: Parameters<typeof collectEffectEndpoints>[0] = (
              apiValue,
              handlers,
            ) => {
              if (!HttpApi.isHttpApi(apiValue)) {
                throw new Error(
                  '[BFF][Effect] Endpoint reflection received a non-HttpApi value.',
                );
              }
              HttpApi.reflect(apiValue, {
                onGroup: handlers.onGroup ?? (() => {}),
                onEndpoint: handlers.onEndpoint,
              });
            };
            return toOperationContractSources(
              collectEffectEndpoints(reflect, effectApi, prefix),
            );
          })
          .catch(error => {
            logger.warn(
              `[BFF][Effect] Failed reflect HttpApi endpoints cross-project policy: ${String(error)}`,
            );
            return [];
          });

  return contractSourcesPromise.then(contractSources => {
    const policy = resolveAdapterCrossProjectPolicy(api, contractSources);
    if (policy?.enabled === true && contractSources.length === 0) {
      logger.warn(
        '[BFF][Effect] Cross-project policy enabled but no HttpApi endpoints could be reflected; requests fail operation-contract matching unless allowUnknownOperations is enabled.',
      );
    }
    return policy;
  });
}
