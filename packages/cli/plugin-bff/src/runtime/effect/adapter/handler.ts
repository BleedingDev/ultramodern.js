// @effect-diagnostics asyncFunction:off
import type { ServerPluginAPI } from '@modern-js/server-core';
import { logger } from '@modern-js/utils';

import {
  checkCrossProjectPolicyForRequest,
  type ResolvedCrossProjectPolicy,
} from '../../../utils/crossProjectServerPolicy';
import { type EffectApiModule, resolveEffectBffModuleHandler } from '../module';

export async function loadEffectAdapterHandlerFromModule(
  api: ServerPluginAPI,
  mod: EffectApiModule,
  crossProjectPolicy: ResolvedCrossProjectPolicy | undefined,
) {
  const effectConfig = api.getServerConfig()?.bff?.effect;

  return resolveEffectBffModuleHandler(mod, {
    openapi: effectConfig?.openapi,
    dataPlatform: effectConfig?.dataPlatform,
    validateRequest: request =>
      checkCrossProjectPolicyForRequest(request, crossProjectPolicy),
    onWarning: message => {
      logger.warn(message);
    },
  });
}
