import { createRemoteAppComponent } from '@module-federation/modern-js-v3/react';
import { loadRemote } from '@module-federation/modern-js-v3/runtime';
import {
  createRemoteAppErrorFallback,
  createRemoteAppLoadingFallback,
} from './remoteAppFallback';

const RemoteAppUnavailable = createRemoteAppComponent({
  loader: () => loadRemote('AppRemote/export-app-unavailable'),
  export: 'provider' as any,
  fallback: createRemoteAppErrorFallback('app-remote-unavailable'),
  loading: createRemoteAppLoadingFallback('app-remote-unavailable'),
});

export default RemoteAppUnavailable;
