import type { ModuleFederationRuntimePlugin } from '@module-federation/runtime';

import type { BackendFederationLoadEntryPluginOptions } from './types';

export function createBackendFederationLoadEntryPlugin(
  options: BackendFederationLoadEntryPluginOptions,
): ModuleFederationRuntimePlugin {
  return {
    name: 'modernjs-backend-federation-load-entry',
    async loadEntry({ remoteInfo }) {
      return options.resolveEntry({
        name: remoteInfo.name,
        entry: remoteInfo.entry,
        type: remoteInfo.type,
        entryGlobalName: remoteInfo.entryGlobalName,
        shareScope: remoteInfo.shareScope,
      });
    },
  } as ModuleFederationRuntimePlugin;
}
