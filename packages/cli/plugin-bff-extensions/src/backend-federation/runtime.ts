import { ModuleFederation } from '@module-federation/runtime';

import { loadBackendFederationExpose } from './entry';
import { createBackendFederationLoadEntryPlugin } from './plugin';
import { collectRemotes } from './remotes';
import type {
  BackendFederationRemote,
  BackendFederationRuntimeOptions,
} from './types';

let nextRuntimeId = 0;

function parseRemoteRequest(request: string) {
  const [remoteName, ...exposeParts] = request.split('/');
  if (
    remoteName === undefined ||
    remoteName.length === 0 ||
    exposeParts.length === 0
  ) {
    return;
  }
  return remoteName;
}

function createLocalEntryPlugin(
  options: BackendFederationRuntimeOptions,
  remotes: BackendFederationRemote[],
) {
  return createBackendFederationLoadEntryPlugin({
    resolveEntry(resolvedRemote) {
      const remote = remotes.find(
        candidate => candidate.name === resolvedRemote.name,
      );
      if (remote === undefined) {
        return;
      }
      return {
        get(expose: string) {
          return () => loadBackendFederationExpose(remote, expose, options);
        },
      };
    },
  });
}

function isolateRegisteredRemoteEntries(remotes: BackendFederationRemote[]) {
  const runtimeId = nextRuntimeId;
  nextRuntimeId += 1;
  return remotes.map(remote => ({
    ...remote,
    entry: `${remote.entry}#modernjs-backend-runtime-${runtimeId}`,
  }));
}

class BackendFederationRuntime extends ModuleFederation {
  readonly #remoteNames: ReadonlySet<string>;

  constructor(
    options: BackendFederationRuntimeOptions,
    remotes: BackendFederationRemote[],
  ) {
    super({
      name: options.hostName,
      remotes: isolateRegisteredRemoteEntries(remotes),
      shared: {},
      plugins: [createLocalEntryPlugin(options, remotes)],
    });
    this.#remoteNames = new Set(remotes.map(remote => remote.name));
  }

  override loadRemote<T>(
    request: string,
    loadOptions?: NonNullable<Parameters<ModuleFederation['loadRemote']>[1]>,
  ): Promise<T | null> {
    const remoteName = parseRemoteRequest(request);
    if (remoteName === undefined) {
      return Promise.reject(
        new Error(
          `[BFF][Effect] Invalid backend federation request ${request}.`,
        ),
      );
    }
    if (!this.#remoteNames.has(remoteName)) {
      return Promise.reject(
        new Error(
          `[BFF][Effect] Missing backend federation remote ${remoteName}.`,
        ),
      );
    }
    return super.loadRemote<T>(request, loadOptions);
  }
}

export function createBackendFederationRuntime(
  options: BackendFederationRuntimeOptions,
): ModuleFederation {
  const remotes = collectRemotes(options);
  return new BackendFederationRuntime(options, remotes);
}
