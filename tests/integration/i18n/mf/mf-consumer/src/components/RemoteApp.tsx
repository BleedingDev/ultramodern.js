import { createRemoteAppComponent } from '@module-federation/modern-js-v3/react';
import { loadRemote } from '@module-federation/modern-js-v3/runtime';
import {
  createRemoteAppErrorFallback,
  createRemoteAppLoadingFallback,
} from './remoteAppFallback';

const RemoteApp = createRemoteAppComponent({
  loader: () => loadRemote('AppRemote/export-app'),
  export: 'provider' as any,
  fallback: createRemoteAppErrorFallback('app-remote'),
  loading: createRemoteAppLoadingFallback('app-remote'),
});

export default RemoteApp;
