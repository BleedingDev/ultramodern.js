export type RemoteSsrFallbackStrategy = 'client-hydration';

export type RemoteSsrFallbackDescriptor = {
  id: 'remote/Widget' | 'remote/Mutator' | 'remote2/Panel';
  exportName: 'default';
  placeholderId: string;
  strategy: RemoteSsrFallbackStrategy;
  runtimeSeam: 'tanstack-mf-server-remote-render';
  reason: 'mf-server-remote-resolution-unavailable';
};

export type RemoteSsrFallbackMetadata = {
  version: 1;
  routeId: 'mf/page';
  remotes: RemoteSsrFallbackDescriptor[];
};

export const REMOTE_SSR_FALLBACK_METADATA: RemoteSsrFallbackMetadata = {
  version: 1,
  routeId: 'mf/page',
  remotes: [
    {
      id: 'remote/Widget',
      exportName: 'default',
      placeholderId: 'remote-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeSeam: 'tanstack-mf-server-remote-render',
      reason: 'mf-server-remote-resolution-unavailable',
    },
    {
      id: 'remote/Mutator',
      exportName: 'default',
      placeholderId: 'remote-mutator-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeSeam: 'tanstack-mf-server-remote-render',
      reason: 'mf-server-remote-resolution-unavailable',
    },
    {
      id: 'remote2/Panel',
      exportName: 'default',
      placeholderId: 'remote2-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeSeam: 'tanstack-mf-server-remote-render',
      reason: 'mf-server-remote-resolution-unavailable',
    },
  ],
};

export function serializeRemoteSsrFallbackMetadata(
  metadata: RemoteSsrFallbackMetadata,
) {
  return JSON.stringify(metadata).replace(/</g, '\\u003c');
}
