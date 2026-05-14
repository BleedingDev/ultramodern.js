import hostEffectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import * as React from 'react';
import { lazyRemoteComponent, RemoteErrorBoundary } from './remoteLoader';
import {
  REMOTE_SSR_FALLBACK_METADATA,
  serializeRemoteSsrFallbackMetadata,
} from './remoteSsrFallback';
import './page.css';

const RemoteWidget = lazyRemoteComponent('remote/Widget');
const RemoteMutator = lazyRemoteComponent('remote/Mutator');
const RemotePanel = lazyRemoteComponent('remote2/Panel');

export default function MfPage() {
  const match = useMatch({ from: '/mf' });
  const msg = match.loaderData!.msg;
  const count = match.loaderData!.count;
  const [clientReady, setClientReady] = React.useState(false);
  const [effectMessage, setEffectMessage] = React.useState('pending');

  React.useEffect(() => {
    let canceled = false;
    setClientReady(true);

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
      {!clientReady ? (
        <>
          <div
            id="remote-ssr-contract-gap"
            data-runtime-seam="tanstack-mf-server-remote-render"
            data-expected-remotes="remote/Widget,remote/Mutator,remote2/Panel"
            data-fallback-metadata-id="remote-ssr-fallback-metadata"
          >
            remote-ssr:blocked
          </div>
          <script
            id="remote-ssr-fallback-metadata"
            type="application/json"
            // The server shell emits this before hydration so clients and tests
            // can verify the exact remotes that intentionally fall back to CSR.
            dangerouslySetInnerHTML={{
              __html: serializeRemoteSsrFallbackMetadata(
                REMOTE_SSR_FALLBACK_METADATA,
              ),
            }}
          />
          {REMOTE_SSR_FALLBACK_METADATA.remotes.map(remote => (
            <div
              key={remote.id}
              id={remote.placeholderId}
              data-remote-id={remote.id}
              data-runtime-seam={remote.runtimeSeam}
              data-fallback-strategy={remote.strategy}
              data-fallback-reason={remote.reason}
            >
              {remote.id === 'remote/Widget'
                ? 'remote-widget:pending'
                : remote.id === 'remote/Mutator'
                  ? 'remote-mutator:pending'
                  : 'remote2-panel:pending'}
            </div>
          ))}
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
