// @effect-diagnostics asyncFunction:off globalFetch:off strictBooleanExpressions:off

import {
  evaluateBackendFederationCommonJsEntry,
  loadVerifiedBackendFederationEntry,
} from '@modern-js/server-runtime-extensions/backend-federation-security';
import {
  Module,
  type ModuleFederation,
  type ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import type {
  BackendFederationEntryExports,
  BackendFederationRemote,
  BackendFederationRuntimeOptions,
} from './types';

type RemoteInfo = ConstructorParameters<typeof Module>[0]['remoteInfo'];

export const PROVIDED_ENTRY_SCHEME = /^(?:binding|service|static):/u;

function decodeDataUrl(remote: BackendFederationRemote) {
  const commaIndex = remote.entry.indexOf(',');
  if (commaIndex < 0) {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} has an invalid data URL entry.`,
    );
  }
  return new TextEncoder().encode(
    decodeURIComponent(remote.entry.slice(commaIndex + 1)),
  );
}

// Node caches ES modules by URL, so every runtime importing the same file: or
// data: module shares one container. Only evaluated CommonJS containers (the
// verified network path) are isolated per runtime.
async function importContainer(remote: BackendFederationRemote) {
  const namespace = await import(/* webpackIgnore: true */ remote.entry);
  return (namespace.default ?? namespace) as BackendFederationEntryExports;
}

/** One load path per entry scheme; anything else names the remote and fails. */
function loadContainer(
  remote: BackendFederationRemote,
  options: BackendFederationRuntimeOptions,
): Promise<BackendFederationEntryExports> {
  const verified = Boolean(
    remote.verification || options.entryPolicy?.expected,
  );
  const scheme = /^[a-z][a-z0-9+.-]*:/iu.exec(remote.entry)?.[0].toLowerCase();
  if (scheme === 'https:' || scheme === 'http:') {
    if (!verified) {
      throw new Error(
        `[BFF][Effect] Backend federation remote ${remote.name} requires verified entry bytes before network execution.`,
      );
    }
    return loadVerifiedBackendFederationEntry({
      ...options.entryPolicy,
      remote,
      ...(remote.verification ? { verification: remote.verification } : {}),
    });
  }
  if (verified) {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} declares entry verification, but only http(s) entries are fetched and verified.`,
    );
  }
  if (scheme === 'data:' && remote.type !== 'module') {
    return Promise.resolve(
      evaluateBackendFederationCommonJsEntry(
        remote,
        decodeDataUrl(remote),
        options.entryPolicy?.evaluateCommonJs,
      ),
    );
  }
  if (scheme === 'data:' || scheme === 'file:') {
    return importContainer(remote);
  }
  throw new Error(
    `[BFF][Effect] Backend federation remote ${remote.name} uses unsupported entry ${remote.entry}. Use a verified http(s) entry, a data: or file: entry, or a binding:, service: or static: entry served by createBackendFederationLoadEntryPlugin().`,
  );
}

export function registerRemoteContainer(
  origin: ModuleFederation,
  remoteInfo: RemoteInfo,
  container: BackendFederationEntryExports,
) {
  const module = new Module({ host: origin, remoteInfo });
  module.remoteEntryExports = container as InstanceType<
    typeof Module
  >['remoteEntryExports'];
  origin.moduleCache.set(remoteInfo.name, module);
}

/**
 * Loads each configured remote once per runtime and registers the resulting
 * container with that runtime only, so Module Federation initializes it with
 * the runtime's own share scope. Registered last, it replaces any container a
 * caller plugin supplied for a scheme it owns.
 */
export function createBackendFederationIntegrityPlugin(
  options: BackendFederationRuntimeOptions,
  remotes: readonly BackendFederationRemote[],
): ModuleFederationRuntimePlugin {
  const loading = new Map<string, Promise<void>>();

  const register = async (origin: ModuleFederation, remoteInfo: RemoteInfo) => {
    const remote = remotes.find(
      candidate => candidate.name === remoteInfo.name,
    );
    if (remote === undefined) {
      throw new Error(
        `[BFF][Effect] Missing backend federation remote ${remoteInfo.name}.`,
      );
    }
    if (PROVIDED_ENTRY_SCHEME.test(remote.entry)) {
      if (
        origin.moduleCache.get(remote.name)?.remoteEntryExports === undefined
      ) {
        throw new Error(
          `[BFF][Effect] Backend federation remote ${remote.name} has no entry provider for ${remote.entry}. Pass createBackendFederationLoadEntryPlugin() in plugins.`,
        );
      }
      return;
    }
    const container = await loadContainer(remote, options);
    if (typeof container?.get !== 'function') {
      throw new Error(
        `[BFF][Effect] Backend federation remote ${remote.name} entry must expose get().`,
      );
    }
    registerRemoteContainer(origin, remoteInfo, container);
  };

  return {
    name: 'modernjs-backend-federation-integrity',
    afterMatchRemote({ origin, remoteInfo }) {
      if (remoteInfo === undefined) {
        return;
      }
      let pending = loading.get(remoteInfo.name);
      if (pending === undefined) {
        pending = register(origin, remoteInfo);
        loading.set(remoteInfo.name, pending);
        pending.catch(() => {
          if (loading.get(remoteInfo.name) === pending) {
            loading.delete(remoteInfo.name);
          }
        });
      }
      return pending;
    },
  };
}
