import type { ModuleFederationRuntimePlugin } from '@module-federation/runtime';

import type { BackendFederationLoadEntryPluginOptions } from './types';

export function createBackendFederationLoadEntryPlugin(
  options: BackendFederationLoadEntryPluginOptions,
): ModuleFederationRuntimePlugin {
  return {
    name: 'modernjs-backend-federation-load-entry',
    loadEntry({ remoteInfo }) {
      return Promise.resolve(
        options.resolveEntry({
          name: remoteInfo.name,
          entry: remoteInfo.entry,
          type: remoteInfo.type,
          entryGlobalName: remoteInfo.entryGlobalName,
          shareScope: remoteInfo.shareScope,
        }),
      ).then(entry => {
        if (entry === undefined) {
          return;
        }
        return {
          get(id: string) {
            return () =>
              Promise.resolve(entry.get(id)).then(factory => factory());
          },
          init(...args: unknown[]) {
            return entry.init?.(...args);
          },
        };
      });
    },
  };
}
