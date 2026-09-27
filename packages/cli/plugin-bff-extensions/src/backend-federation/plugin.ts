import type {
  ModuleFederation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import {
  PROVIDED_ENTRY_SCHEME,
  registerRemoteContainer,
} from './integrity-plugin';
import type {
  BackendFederationEntryExports,
  BackendFederationLoadEntryPluginOptions,
} from './types';

function toContainer(entry: BackendFederationEntryExports) {
  return {
    get(id: string) {
      return () => Promise.resolve(entry.get(id)).then(factory => factory());
    },
    init(...args: unknown[]) {
      return entry.init?.(...args);
    },
  };
}

/**
 * Serves binding:, service: and static: entries. The provider resolves each
 * remote once per runtime and registers the container with that runtime only.
 */
export function createBackendFederationLoadEntryPlugin(
  options: BackendFederationLoadEntryPluginOptions,
): ModuleFederationRuntimePlugin {
  const provided = new WeakMap<ModuleFederation, Map<string, Promise<void>>>();

  return {
    name: 'modernjs-backend-federation-load-entry',
    afterMatchRemote({ origin, remoteInfo }) {
      if (
        remoteInfo === undefined ||
        !PROVIDED_ENTRY_SCHEME.test(remoteInfo.entry)
      ) {
        return;
      }
      let entries = provided.get(origin);
      // The first provider that registers a container wins; later ones are
      // not consulted.
      if (
        entries?.has(remoteInfo.name) !== true &&
        origin.moduleCache.get(remoteInfo.name)?.remoteEntryExports !==
          undefined
      ) {
        return;
      }
      if (entries === undefined) {
        entries = new Map();
        provided.set(origin, entries);
      }
      const runtimeEntries = entries;
      let pending = runtimeEntries.get(remoteInfo.name);
      if (pending === undefined) {
        pending = Promise.resolve(
          options.resolveEntry({
            name: remoteInfo.name,
            entry: remoteInfo.entry,
            type: remoteInfo.type,
          }),
        ).then(entry => {
          if (entry !== undefined) {
            registerRemoteContainer(origin, remoteInfo, toContainer(entry));
          }
        });
        const settled = pending;
        runtimeEntries.set(remoteInfo.name, settled);
        settled.catch(() => {
          if (runtimeEntries.get(remoteInfo.name) === settled) {
            runtimeEntries.delete(remoteInfo.name);
          }
        });
      }
      return pending;
    },
  };
}
