// @effect-diagnostics asyncFunction:off

import type { ModuleFederation } from '@module-federation/runtime';

import { loadBackendFederationExpose } from './entry';
import { collectRemotes } from './remotes';
import type { BackendFederationRuntimeOptions } from './types';
import { normalizeExpose } from './utils';

function exposeForRemoteRequest(expose: string) {
  return `./${normalizeExpose(expose)}`;
}

function parseRemoteRequest(request: string) {
  const [remoteName, ...exposeParts] = request.split('/');
  if (!remoteName || exposeParts.length === 0) {
    throw new Error(
      `[BFF][Effect] Invalid backend federation request ${request}.`,
    );
  }
  return {
    remoteName,
    expose: exposeForRemoteRequest(exposeParts.join('/')),
  };
}

export function createBackendFederationRuntime(
  options: BackendFederationRuntimeOptions,
): ModuleFederation {
  const remotes = collectRemotes(options);

  return {
    async loadRemote<T>(request: string): Promise<T> {
      const { remoteName, expose } = parseRemoteRequest(request);
      const remote = remotes.find(candidate => candidate.name === remoteName);
      if (!remote) {
        throw new Error(
          `[BFF][Effect] Missing backend federation remote ${remoteName}.`,
        );
      }
      return loadBackendFederationExpose(remote, expose, options) as Promise<T>;
    },
  } as ModuleFederation;
}
