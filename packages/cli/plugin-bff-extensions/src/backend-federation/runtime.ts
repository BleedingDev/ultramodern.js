import { ModuleFederation } from '@module-federation/runtime';

import { createBackendFederationIntegrityPlugin } from './integrity-plugin';
import { collectRemotes } from './remotes';
import type { BackendFederationRuntimeOptions } from './types';

export function createBackendFederationRuntime(
  options: BackendFederationRuntimeOptions,
): ModuleFederation {
  const remotes = collectRemotes(options);
  return new ModuleFederation({
    name: options.hostName,
    // Remotes use the default share scope, where host shares are registered.
    remotes: remotes.map(({ name, entry, type }) => ({
      name,
      entry,
      ...(type ? { type } : {}),
    })),
    shared: options.shared ?? {},
    plugins: [
      ...(options.plugins ?? []),
      createBackendFederationIntegrityPlugin(options, remotes),
    ],
  });
}
