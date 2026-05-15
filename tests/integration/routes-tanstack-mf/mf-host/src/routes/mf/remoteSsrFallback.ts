export type RemoteSsrFallbackStrategy = 'client-hydration';
export type RemoteSsrFallbackContract = 'typed-ssr-fallback-client-hydration';
export type RemoteSsrFallbackClassification =
  | 'remote-unavailable'
  | 'timeout'
  | 'network'
  | 'contract'
  | 'version-skew';

export type RemoteSsrFallbackDescriptor = {
  id: 'remote/Widget' | 'remote/Mutator' | 'remote2/Panel';
  exportName: 'default';
  placeholderId: string;
  strategy: RemoteSsrFallbackStrategy;
  runtimeBoundary: 'tanstack-mf-client-hydration';
  reason: 'remote-unavailable';
  classification: 'remote-unavailable';
  telemetryEvent: 'mf.ssr.remote.fallback';
};

export type RemoteSsrFallbackMetadata = {
  version: 1;
  routeId: 'mf/page';
  contract: RemoteSsrFallbackContract;
  hydrationOwner: 'client';
  fallbackClasses: RemoteSsrFallbackClassification[];
  remotes: RemoteSsrFallbackDescriptor[];
};

export const REMOTE_SSR_FALLBACK_CONTRACT: RemoteSsrFallbackContract =
  'typed-ssr-fallback-client-hydration';

export const REMOTE_SSR_FALLBACK_CLASSES: RemoteSsrFallbackClassification[] = [
  'remote-unavailable',
  'timeout',
  'network',
  'contract',
  'version-skew',
];

export const REMOTE_SSR_FALLBACK_METADATA: RemoteSsrFallbackMetadata = {
  version: 1,
  routeId: 'mf/page',
  contract: REMOTE_SSR_FALLBACK_CONTRACT,
  hydrationOwner: 'client',
  fallbackClasses: REMOTE_SSR_FALLBACK_CLASSES,
  remotes: [
    {
      id: 'remote/Widget',
      exportName: 'default',
      placeholderId: 'remote-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeBoundary: 'tanstack-mf-client-hydration',
      reason: 'remote-unavailable',
      classification: 'remote-unavailable',
      telemetryEvent: 'mf.ssr.remote.fallback',
    },
    {
      id: 'remote/Mutator',
      exportName: 'default',
      placeholderId: 'remote-mutator-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeBoundary: 'tanstack-mf-client-hydration',
      reason: 'remote-unavailable',
      classification: 'remote-unavailable',
      telemetryEvent: 'mf.ssr.remote.fallback',
    },
    {
      id: 'remote2/Panel',
      exportName: 'default',
      placeholderId: 'remote2-ssr-placeholder',
      strategy: 'client-hydration',
      runtimeBoundary: 'tanstack-mf-client-hydration',
      reason: 'remote-unavailable',
      classification: 'remote-unavailable',
      telemetryEvent: 'mf.ssr.remote.fallback',
    },
  ],
};

export function serializeRemoteSsrFallbackMetadata(
  metadata: RemoteSsrFallbackMetadata,
) {
  return JSON.stringify(metadata).replace(/</g, '\\u003c');
}
