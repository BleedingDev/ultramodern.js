import { createRemoteAppComponent } from '@module-federation/modern-js-v3/react';
import { loadRemote } from '@module-federation/modern-js-v3/runtime';

type RemoteOneAppModule = typeof import('remote/App');
type RemoteTwoAppModule = typeof import('remote2/App');

async function loadRequiredRemote<T>(id: string): Promise<T> {
  const remote = await loadRemote<T>(id);
  if (remote === null) {
    throw new Error(`Module Federation remote "${id}" resolved to null.`);
  }
  return remote;
}

function RemoteRuntimeError({ error }: { error: Error }) {
  return <div data-testid="remote-runtime-error">{error.message}</div>;
}

export const RemoteOneRuntimeApp = createRemoteAppComponent<
  RemoteOneAppModule,
  'provider'
>({
  loader: () => loadRequiredRemote<RemoteOneAppModule>('remote/App'),
  export: 'provider',
  fallback: RemoteRuntimeError,
  loading: <div data-testid="remote-one-runtime-loading">loading</div>,
});

export const RemoteTwoRuntimeApp = createRemoteAppComponent<
  RemoteTwoAppModule,
  'provider'
>({
  loader: () => loadRequiredRemote<RemoteTwoAppModule>('remote2/App'),
  export: 'provider',
  fallback: RemoteRuntimeError,
  loading: <div data-testid="remote-two-runtime-loading">loading</div>,
});
