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

export function resolveEffectAdapterCrossProjectPolicy(
  api: ServerPluginAPI,
  prefix: string,
  mod: EffectApiModule | null,
): Promise<ResolvedCrossProjectPolicy | undefined> {
  const contractSourcesPromise: Promise<
    ReturnType<typeof toOperationContractSources>
  > =
    mod === null
      ? Promise.resolve([])
      : Promise.resolve()
          .then(() => extractHttpApiFromModule(mod, HttpApi.isHttpApi))
          .then(effectApi => {
            if (effectApi !== null) {
              // Bridge strongly-typed HttpApi.reflect onto loose
              // reflection contract shared client generator.
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
            }
            return [];
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
