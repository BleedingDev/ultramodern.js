import hostEffectBff from '@api/effect/index';
import { useMatch } from '@tanstack/react-router';
import * as React from 'react';
import { RemoteErrorBoundary, lazyRemoteComponent } from './remoteLoader';
import './page.css';

const RemoteWidget = lazyRemoteComponent('remote/Widget');
const RemoteMutator = lazyRemoteComponent('remote/Mutator');
const RemotePanel = lazyRemoteComponent('remote2/Panel');

export default function MfPage() {
  const match = useMatch({ from: '/mf' });
  const msg = match.loaderData!.msg;
  const count = match.loaderData!.count;
  const [effectMessage, setEffectMessage] = React.useState('pending');

  React.useEffect(() => {
    let canceled = false;

    hostEffectBff.client.greetings
      .hello({})
      .then(data => {
        if (!canceled) {
          setEffectMessage(data.message);
        }
      })
      .catch(() => {
        if (!canceled) {
          setEffectMessage('error');
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div id="mf">
      <div id="host-loader">{msg}</div>
      <div id="host-mf-count">host-mf-count:{count}</div>
      <div id="host-effect-message">host-effect:{effectMessage}</div>
      {typeof window === 'undefined' ? (
        <>
          <div id="remote-ssr-placeholder">remote-widget:pending</div>
          <div id="remote-mutator-ssr-placeholder">remote-mutator:pending</div>
        </>
      ) : (
        <>
          <RemoteErrorBoundary fallbackId="remote-error">
            <React.Suspense fallback={<div id="remote-loading">loading</div>}>
              <RemoteWidget />
            </React.Suspense>
          </RemoteErrorBoundary>
          <RemoteErrorBoundary fallbackId="remote-mutator-error">
            <React.Suspense
              fallback={<div id="remote-mutator-loading">loading</div>}
            >
              <RemoteMutator />
            </React.Suspense>
          </RemoteErrorBoundary>
          <RemoteErrorBoundary fallbackId="remote2-error">
            <React.Suspense fallback={<div id="remote2-loading">loading</div>}>
              <RemotePanel />
            </React.Suspense>
          </RemoteErrorBoundary>
        </>
      )}
    </div>
  );
}
