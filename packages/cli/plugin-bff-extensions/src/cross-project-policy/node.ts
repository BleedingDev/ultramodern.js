import '@modern-js/server-runtime-extensions/server-config';
import type { ServerPluginAPI } from '@modern-js/server-core';
import {
  type OperationContractSource,
  resolveCrossProjectPolicy,
  resolveOperationProducer,
} from '@modern-js/server-runtime-extensions/bff-policy/node';

import type { ResolvedCrossProjectPolicy } from './evaluation';

export const resolveAdapterCrossProjectPolicy = (
  api: ServerPluginAPI,
  handlers: OperationContractSource[],
  producer?: ReturnType<typeof resolveOperationProducer>,
): ResolvedCrossProjectPolicy | undefined => {
  const bff = api.getServerConfig()?.bff;
  const { apiDirectory, appDirectory } = api.getServerContext() as {
    apiDirectory?: string;
    appDirectory?: string;
  };

  return resolveCrossProjectPolicy({
    crossProjectPolicy: bff?.crossProjectPolicy,
    handlers,
    isCrossProjectServer: bff?.isCrossProjectServer,
    ...(producer ??
      resolveOperationProducer({
        directories: [apiDirectory, appDirectory],
        requestId: bff?.requestId || 'default',
      })),
  });
};
