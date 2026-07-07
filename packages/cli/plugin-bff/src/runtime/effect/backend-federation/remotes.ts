import type { BackendFederationRuntimeOptions } from './types';

export function collectRemotes(options: BackendFederationRuntimeOptions) {
  const remotes = [...(options.remotes ?? [])];
  if (options.remote) {
    const existingIndex = remotes.findIndex(
      remote => remote.name === options.remote?.name,
    );
    if (existingIndex >= 0) {
      remotes[existingIndex] = options.remote;
    } else {
      remotes.push(options.remote);
    }
  }
  return remotes;
}
