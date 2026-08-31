import type { BackendFederationRuntimeOptions } from './types';

export function collectRemotes(options: BackendFederationRuntimeOptions) {
  const remotes = [...(options.remotes ?? [])];
  const configuredRemote = options.remote;
  if (configuredRemote !== undefined) {
    const existingIndex = remotes.findIndex(
      remote => remote.name === configuredRemote.name,
    );
    if (existingIndex >= 0) {
      remotes[existingIndex] = configuredRemote;
    } else {
      remotes.push(configuredRemote);
    }
  }
  return remotes;
}
