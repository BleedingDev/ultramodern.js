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
    remotes: remotes.map(({ name, entry, type, shareScope }) => ({
      name,
      entry,
      ...(type ? { type } : {}),
      ...(shareScope ? { shareScope } : {}),
    })),
    shared: options.shared ?? {},
    plugins: [
      ...(options.plugins ?? []),
      createBackendFederationIntegrityPlugin(options, remotes),
    ],
  });
}
